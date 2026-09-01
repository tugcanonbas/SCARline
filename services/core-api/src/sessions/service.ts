import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Pool, PoolClient } from "pg";

import {
  canTransitionSession,
  IoSessionConfigurationSchema,
  SimulatorSessionConfigurationSchema,
  SimulatorCommandNameSchema,
  SimulatorAdapterCapabilitySchema,
  type MessageEnvelope,
  type SessionStatus,
} from "@scarline/contracts";

import { ApiProblem } from "../errors.js";
import {
  claimInboxMessage,
  createEnvelope,
  enqueueMessage,
} from "../infrastructure/outbox.js";
import type { RabbitConnection } from "../infrastructure/rabbitmq.js";
import type { RealtimeHub } from "../realtime/hub.js";
import {
  SessionLayoutOpenError,
  type SessionOverlayService,
} from "../overlay/session-layout.js";
import type { ManagedCoreApiService } from "../runtime.js";
import { evaluateTriggerExpression } from "../triggers/evaluator.js";

export type LifecycleAction = "ready" | "start" | "pause" | "resume" | "advance" | "complete" | "abort" | "fail";

const ACTION_TARGET: Record<Exclude<LifecycleAction, "advance">, SessionStatus> = {
  ready: "ready",
  start: "running",
  pause: "paused",
  resume: "running",
  complete: "completed",
  abort: "aborted",
  fail: "failed",
};

interface SessionRow {
  id: string;
  study_id: string;
  participant_id: string;
  status: SessionStatus;
  started_at?: Date | null;
  data_policy?: {
    persistence?: { mode?: string; sampleEveryN?: number; retentionDays?: number | null };
    realtime?: { maximumHz?: number | null };
  };
}

interface PendingOverlayFinalization {
  readonly commandId: string;
  readonly action: "start" | "advance";
  readonly session: SessionRow;
  readonly conditionId: string;
  readonly hostId: string | null;
  readonly resultPayload: Record<string, unknown>;
}

interface PendingOverlayCleanup {
  readonly commandId: string;
  readonly action: "complete" | "abort" | "fail";
  readonly session: SessionRow;
}

export class SessionLifecycleService implements ManagedCoreApiService {
  readonly #pool: Pool;
  readonly #rabbit: RabbitConnection;
  readonly #logger: FastifyBaseLogger;
  readonly #timeoutSeconds: number;
  readonly #hub: RealtimeHub;
  readonly #overlays: SessionOverlayService;
  #timeoutTimer: NodeJS.Timeout | undefined;
  #retentionTimer: NodeJS.Timeout | undefined;
  readonly #lastRealtimeDelivery = new Map<string, number>();

  constructor(pool: Pool, rabbit: RabbitConnection, logger: FastifyBaseLogger, timeoutSeconds: number, hub: RealtimeHub, overlays: SessionOverlayService) {
    this.#pool = pool;
    this.#rabbit = rabbit;
    this.#logger = logger;
    this.#timeoutSeconds = timeoutSeconds;
    this.#hub = hub;
    this.#overlays = overlays;
    rabbit.registerCoreCommandConsumer((message) => this.#handleCommand(message));
    rabbit.registerCoreEventConsumer((message) => this.#handleEvent(message));
  }

  start(): void {
    this.#timeoutTimer = setInterval(() => void this.#expireCommands(), 1_000);
    this.#timeoutTimer.unref();
    this.#retentionTimer = setInterval(() => void this.#applyRetention(), 60 * 60 * 1_000);
    this.#retentionTimer.unref();
    void this.#applyRetention();
  }

  stop(): void {
    if (this.#timeoutTimer !== undefined) clearInterval(this.#timeoutTimer);
    if (this.#retentionTimer !== undefined) clearInterval(this.#retentionTimer);
    this.#timeoutTimer = undefined;
    this.#retentionTimer = undefined;
  }

  async queueCommand(input: {
    sessionId: string;
    action: LifecycleAction;
    requestedBy: string;
    reason?: string | null;
    rendererMode?: "desktop" | "browser";
    hostId?: string | null;
  }): Promise<{ commandId: string; status: "queued" }> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<SessionRow>("SELECT * FROM sessions WHERE id=$1 FOR UPDATE", [input.sessionId]);
      const session = result.rows[0];
      if (session === undefined) throw new ApiProblem(404, "SESSION_NOT_FOUND", "Session not found.");
      await this.#assertTransition(client, session, input.action);
      const existing = await client.query(
        "SELECT 1 FROM lifecycle_commands WHERE session_id=$1 AND status IN ('queued','processing') LIMIT 1",
        [input.sessionId],
      );
      if (existing.rowCount === 1) {
        throw new ApiProblem(409, "SESSION_COMMAND_PENDING", "The session already has a pending lifecycle command.");
      }
      const commandId = randomUUID();
      await client.query(
        `INSERT INTO lifecycle_commands(id,session_id,requested_by,action,reason,deadline_at)
         VALUES($1,$2,$3,$4,$5,NOW()+($6*INTERVAL '1 second'))`,
        [commandId, input.sessionId, input.requestedBy, input.action, input.reason ?? null, this.#timeoutSeconds],
      );
      await enqueueMessage(client, createEnvelope({
        routingKey: "commands.core-api.session-lifecycle",
        studyId: session.study_id,
        sessionId: session.id,
        correlationId: commandId,
        payload: {
          commandId,
          action: input.action,
          reason: input.reason ?? null,
          rendererMode: input.rendererMode ?? "desktop",
          hostId: input.hostId ?? null,
        },
      }));
      await enqueueMessage(client, createEnvelope({
        routingKey: `events.${session.study_id}.${session.id}.lifecycle.command-queued`,
        studyId: session.study_id,
        sessionId: session.id,
        correlationId: commandId,
        payload: { commandId, action: input.action, status: "queued" },
      }));
      await client.query("COMMIT");
      return { commandId, status: "queued" };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async #assertTransition(client: PoolClient, session: SessionRow, action: LifecycleAction): Promise<void> {
    if (action === "ready") {
      const study = await client.query<{ status: string }>("SELECT status FROM studies WHERE id=$1", [session.study_id]);
      if (!study.rows[0] || !["ready", "running"].includes(study.rows[0].status)) {
        throw new ApiProblem(409, "STUDY_NOT_READY", "The study must be ready before a session can become ready.");
      }
    }
    if (action === "advance") {
      if (session.status !== "running") {
        throw new ApiProblem(409, "INVALID_SESSION_TRANSITION", "Only a running session can advance conditions.");
      }
      const remaining = await client.query(
        "SELECT 1 FROM session_conditions WHERE session_id=$1 AND status='pending' LIMIT 1",
        [session.id],
      );
      if (remaining.rowCount !== 1) throw new ApiProblem(409, "NO_NEXT_CONDITION", "The session has no next condition.");
      return;
    }
    const target = ACTION_TARGET[action];
    if (!canTransitionSession(session.status, target)) {
      throw new ApiProblem(409, "INVALID_SESSION_TRANSITION", `Cannot ${action} a ${session.status} session.`);
    }
  }

  async #handleCommand(message: MessageEnvelope): Promise<void> {
    if (message.routingKey !== "commands.core-api.session-lifecycle") return;
    const commandId = String(message.payload.commandId ?? "");
    const action = String(message.payload.action ?? "") as LifecycleAction;
    if (!commandId || !["ready", "start", "pause", "resume", "advance", "complete", "abort", "fail"].includes(action)) {
      throw new Error("Invalid lifecycle command payload");
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      if (!(await claimInboxMessage(client, message.id, "core-api.lifecycle-command"))) {
        await client.query("COMMIT");
        return;
      }
      const commandResult = await client.query<{ session_id: string; status: string; deadline_at: Date }>(
        "SELECT session_id,status,deadline_at FROM lifecycle_commands WHERE id=$1 FOR UPDATE",
        [commandId],
      );
      const command = commandResult.rows[0];
      if (command === undefined || !["queued", "processing"].includes(command.status)) {
        await client.query("COMMIT");
        return;
      }
      const sessionResult = await client.query<SessionRow>("SELECT * FROM sessions WHERE id=$1 FOR UPDATE", [command.session_id]);
      const session = sessionResult.rows[0];
      if (session === undefined) throw new Error("Lifecycle command references a missing session");
      await this.#assertTransition(client, session, action);
      await client.query("UPDATE lifecycle_commands SET status='processing' WHERE id=$1", [commandId]);

      const payload: Record<string, unknown> = {
        commandId,
        action,
        from: session.status,
        to: action === "advance" ? session.status : ACTION_TARGET[action],
        reason: message.payload.reason ?? null,
        rendererMode: message.payload.rendererMode === "browser" ? "browser" : "desktop",
        hostId: typeof message.payload.hostId === "string" ? message.payload.hostId : null,
      };
      if (action === "ready") payload.snapshots = await this.#buildSnapshots(client, session.id);
      const requiredComponents = await this.#requiredComponents(client, session.id, action);
      await client.query(
        "UPDATE lifecycle_commands SET required_components=$2,result_payload=$3::jsonb WHERE id=$1",
        [commandId, requiredComponents, JSON.stringify(payload)],
      );
      await enqueueMessage(client, createEnvelope({
        routingKey: `events.${session.study_id}.${session.id}.lifecycle.command-processing`,
        studyId: session.study_id,
        sessionId: session.id,
        correlationId: commandId,
        payload: { commandId, action, status: "processing" },
      }));
      if (action === "complete" || action === "abort") {
        if (requiredComponents.length > 0) {
          await this.#enqueueDownstreamCommands(
            client,
            session,
            commandId,
            action,
            requiredComponents,
            command.deadline_at.toISOString(),
          );
        }
        await this.#enqueueLifecycleEvent(client, session, commandId, action, payload);
      } else if (requiredComponents.length === 0) {
        await this.#enqueueLifecycleEvent(client, session, commandId, action, payload);
      } else {
        await this.#enqueueDownstreamCommands(
          client,
          session,
          commandId,
          action,
          requiredComponents,
          command.deadline_at.toISOString(),
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      await this.#failCommand(commandId, error);
    } finally {
      client.release();
    }
  }

  async #buildSnapshots(client: PoolClient, sessionId: string): Promise<Record<string, unknown>[]> {
    const conditions = await client.query<{ id: string; condition_id: string; sequence: number }>(
      `SELECT id,condition_id,sequence FROM session_conditions
       WHERE session_id=$1 ORDER BY sequence`,
      [sessionId],
    );
    const snapshots: Record<string, unknown>[] = [];
    const simulatorTypes: string[] = [];
    let needsRequiredIoClient = false;
    for (const item of conditions.rows) {
      const resolved = await client.query<{ snapshot: Record<string, unknown> }>(
        `SELECT jsonb_build_object(
          'condition',to_jsonb(c),
          'simulator',to_jsonb(sc),
          'devices',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'assignment',to_jsonb(cd),'device',to_jsonb(d),
            'sensors',COALESCE((SELECT jsonb_agg(jsonb_build_object('configuration',to_jsonb(csc),'sensor',to_jsonb(ds)))
              FROM condition_sensor_configurations csc JOIN device_sensors ds ON ds.id=csc.sensor_id
              WHERE csc.condition_device_id=cd.id AND ds.is_active),'[]'::jsonb)
          ) ORDER BY d.name) FROM condition_devices cd JOIN devices d ON d.id=cd.device_id WHERE cd.condition_id=c.id),'[]'::jsonb),
          'layouts',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'layout',to_jsonb(l),'widgets',COALESCE((SELECT jsonb_agg(to_jsonb(wi) ORDER BY wi."order") FROM widget_instances wi WHERE wi.layout_id=l.id),'[]'::jsonb)
          ) ORDER BY l.name) FROM layouts l WHERE l.condition_id=c.id),'[]'::jsonb),
          'triggers',COALESCE((SELECT jsonb_agg(to_jsonb(tr) ORDER BY tr.priority,tr.name) FROM trigger_rules tr WHERE tr.condition_id=c.id AND tr.enabled),'[]'::jsonb)
        ) AS snapshot
        FROM conditions c JOIN simulator_configurations sc ON sc.condition_id=c.id
        WHERE c.id=$1 AND c.archived_at IS NULL`,
        [item.condition_id],
      );
      const snapshot = resolved.rows[0]?.snapshot;
      if (snapshot === undefined) {
        throw new ApiProblem(409, "SESSION_NOT_READY", "Every selected condition needs an active simulator configuration.");
      }
      const simulator = snapshot.simulator as { simulator_type?: unknown } | undefined;
      if (typeof simulator?.simulator_type === "string") simulatorTypes.push(simulator.simulator_type);
      const devices = Array.isArray(snapshot.devices) ? snapshot.devices : [];
      if (devices.some((value) => {
        const assignment = (value as { assignment?: { enabled?: unknown; configuration?: { required?: unknown } } }).assignment;
        return assignment?.enabled === true && assignment.configuration?.required === true;
      })) needsRequiredIoClient = true;
      snapshots.push({ sessionConditionId: item.id, sequence: item.sequence, ...snapshot });
    }
    const missing = this.#hub.missingSimulatorCapabilities(simulatorTypes);
    if (missing.length > 0) {
      throw new ApiProblem(409, "SIMULATOR_NOT_READY", `Required simulator capabilities are unavailable: ${missing.join(", ")}.`);
    }
    if (needsRequiredIoClient && !this.#hub.isComponentAvailable("io-client")) {
      throw new ApiProblem(409, "IO_CLIENT_NOT_READY", "An enabled condition device requires an available IO client.");
    }
    return snapshots;
  }

  async #enqueueDownstreamCommands(
    client: PoolClient,
    session: SessionRow,
    commandId: string,
    action: LifecycleAction,
    components: string[],
    deadlineAt: string,
  ): Promise<void> {
    const configuration = action === "start" || action === "advance"
      ? await this.#nextSimulatorConfiguration(client, session)
      : undefined;
    const ioConfiguration = action === "start" || action === "advance"
      ? await this.#nextIoConfiguration(client, session)
      : undefined;
    for (const component of components) {
      const payload: Record<string, unknown> = {
        commandId,
        action,
        sessionId: session.id,
        deadlineAt,
      };
      if (component === "sim-bridge" && configuration !== undefined) {
        payload.configuration = configuration;
      }
      if (component === "io-client" && ioConfiguration !== undefined) {
        payload.configuration = ioConfiguration;
      }
      await enqueueMessage(client, createEnvelope({
        routingKey: `commands.${component}.session-${action}`,
        studyId: session.study_id,
        sessionId: session.id,
        correlationId: commandId,
        payload,
      }));
    }
  }

  async #nextSimulatorConfiguration(
    client: PoolClient,
    session: SessionRow,
  ): Promise<Record<string, unknown>> {
    const result = await client.query<{
      id: string;
      sequence: number;
      configuration_snapshot: Record<string, unknown>;
    }>(
      `SELECT id,sequence,configuration_snapshot FROM session_conditions
       WHERE session_id=$1 AND status='pending' ORDER BY sequence LIMIT 1`,
      [session.id],
    );
    const row = result.rows[0];
    const simulator = row?.configuration_snapshot.simulator as
      | { simulator_type?: unknown; configuration?: unknown }
      | undefined;
    return SimulatorSessionConfigurationSchema.parse({
      studyId: session.study_id,
      sessionId: session.id,
      sessionConditionId: row?.id,
      sequence: row?.sequence,
      simulatorType: simulator?.simulator_type,
      configuration: simulator?.configuration,
    });
  }

  async #nextIoConfiguration(client: PoolClient, session: SessionRow): Promise<Record<string, unknown>> {
    const result = await client.query<{ id: string; sequence: number; configuration_snapshot: Record<string, unknown> }>(
      `SELECT id,sequence,configuration_snapshot FROM session_conditions
       WHERE session_id=$1 AND status='pending' ORDER BY sequence LIMIT 1`, [session.id],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("IO configuration requires a pending session condition");
    const rawDevices = Array.isArray(row.configuration_snapshot.devices) ? row.configuration_snapshot.devices : [];
    const devices = rawDevices.flatMap((value) => {
      const item = value as Record<string, Record<string, unknown> | unknown[]>;
      const assignment = item.assignment as Record<string, unknown> | undefined;
      const device = item.device as Record<string, unknown> | undefined;
      if (assignment?.enabled !== true || device === undefined) return [];
      const assignmentConfig = asObject(assignment.configuration);
      const deviceMetadata = asObject(device.metadata);
      const deviceConfig = asObject(device.configuration);
      const driverKey = String(assignmentConfig.driverKey ?? deviceMetadata.driverKey ?? deviceConfig.driverKey ?? "");
      if (!/^[a-z][a-z0-9_-]*$/.test(driverKey)) return [];
      const sensors = (Array.isArray(item.sensors) ? item.sensors : []).flatMap((sensorValue) => {
        const entry = sensorValue as Record<string, Record<string, unknown>>;
        const configuration = entry.configuration; const sensor = entry.sensor;
        if (!configuration || !sensor || configuration.enabled !== true) return [];
        const sensorMetadata = asObject(sensor.metadata);
        const sensorConfig = asObject(configuration.configuration);
        return [{ sensorId: sensor.id, key: sensor.key, modality: sensor.modality ?? null, unit: sensor.unit ?? null, enabled: true, sampleRate: Number(sensorConfig.sampleRate ?? sensorMetadata.sampleRate ?? 1), configuration: sensorConfig }];
      });
      return [{ assignmentId: assignment.id, deviceId: device.id, sourceKey: String(device.source_key ?? `device:${device.id}`), driverKey, required: assignmentConfig.required === true, onDisconnect: assignmentConfig.onDisconnect === "continue" ? "continue" : assignmentConfig.required === true ? "fail" : "continue", configuration: { ...deviceConfig, ...assignmentConfig }, sensors }];
    });
    return IoSessionConfigurationSchema.parse({ studyId: session.study_id, sessionId: session.id, sessionConditionId: row.id, sequence: row.sequence, devices, recording: { enabled: devices.some((device) => device.configuration.recording === true), directory: null } });
  }

  async #requiredComponents(client: PoolClient, sessionId: string, action: LifecycleAction): Promise<string[]> {
    if (action === "ready" || action === "fail") return [];
    const components = ["sim-bridge"];
    const devices = await client.query<{ required: boolean }>(
      `SELECT BOOL_OR(COALESCE((cd.configuration->>'required')::boolean,FALSE)) AS required
       FROM session_conditions sc JOIN condition_devices cd ON cd.condition_id=sc.condition_id
       WHERE sc.session_id=$1 AND cd.enabled`, [sessionId],
    );
    const hasDevices = devices.rowCount === 1 && devices.rows[0]?.required !== null;
    if (hasDevices && (devices.rows[0]?.required === true || this.#hub.isComponentAvailable("io-client"))) components.push("io-client");
    return components;
  }

  async #enqueueLifecycleEvent(
    client: PoolClient,
    session: SessionRow,
    commandId: string,
    action: LifecycleAction,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await enqueueMessage(client, createEnvelope({
      routingKey: `events.${session.study_id}.${session.id}.lifecycle.session-${action}`,
      studyId: session.study_id,
      sessionId: session.id,
      correlationId: commandId,
      payload,
    }));
  }

  async #handleEvent(message: MessageEnvelope): Promise<void> {
    const sessionId = message.metadata.sessionId;
    if (sessionId === null) {
      await this.#handleSystemEvent(message);
      return;
    }
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      if (!(await claimInboxMessage(client, message.id, "core-api.event-store"))) {
        await client.query("COMMIT");
        return;
      }
      const session = await client.query<SessionRow>(
        `SELECT se.*,s.data_policy FROM sessions se JOIN studies s ON s.id=se.study_id
         WHERE se.id=$1 FOR UPDATE OF se`, [sessionId],
      );
      if (session.rows[0] === undefined) {
        await client.query("COMMIT");
        return;
      }
      if (this.#shouldPersist(message, session.rows[0])) {
        await client.query(
          `INSERT INTO session_events(message_id,session_id,session_condition_id,"timestamp",event_type,modality,source_type,source_key,routing_key,payload)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(message_id) DO NOTHING`,
          [message.id, sessionId, typeof message.payload.sessionConditionId === "string" ? message.payload.sessionConditionId : null,
            message.timestamp, this.#eventType(message), typeof message.payload.modality === "string" ? message.payload.modality : null,
            message.producer, message.metadata.source?.component ?? null, message.routingKey, JSON.stringify(message.payload)],
        );
      }
      let overlayFinalization: PendingOverlayFinalization | null = null;
      let overlayCleanup: PendingOverlayCleanup | null = null;
      if (message.routingKey.endsWith(".command.ack")) {
        overlayFinalization = await this.#applyCommandAcknowledgement(client, session.rows[0], message);
      } else if (message.routingKey.includes(".lifecycle.session-")) {
        const terminalAction = await this.#applyLifecycleEvent(client, session.rows[0], message);
        if (terminalAction !== null) {
          overlayCleanup = {
            commandId: String(message.payload.commandId ?? ""),
            action: terminalAction,
            session: session.rows[0],
          };
        }
      } else if (!message.routingKey.includes(".trigger.")) {
        await this.#evaluateTriggers(client, session.rows[0], message);
      }
      await client.query("COMMIT");
      if (this.#shouldBroadcast(message, session.rows[0])) await this.#hub.broadcastEvent(message);
      if (overlayFinalization !== null) await this.#finalizeParticipantLayout(overlayFinalization);
      if (overlayCleanup !== null) await this.#cleanupParticipantLayout(overlayCleanup);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async #applyCommandAcknowledgement(client: PoolClient, session: SessionRow, message: MessageEnvelope): Promise<PendingOverlayFinalization | null> {
    const commandId = typeof message.payload.commandId === "string" ? message.payload.commandId : null;
    const component = typeof message.payload.component === "string" ? message.payload.component : message.metadata.source?.component ?? null;
    const status = typeof message.payload.status === "string" ? message.payload.status : null;
    if (commandId === null || component === null || !["completed", "failed"].includes(status ?? "")) return null;
    const command = await client.query<{
      action: LifecycleAction; status: string; required_components: string[]; acknowledged_components: string[]; result_payload: Record<string, unknown>;
    }>("SELECT action,status,required_components,acknowledged_components,result_payload FROM lifecycle_commands WHERE id=$1 AND session_id=$2 FOR UPDATE", [commandId, session.id]);
    const row = command.rows[0];
    if (row === undefined || row.status !== "processing" || !row.required_components.includes(component)) return null;
    if (status === "failed") {
      const reason = typeof message.payload.error === "string" ? message.payload.error : `${component} rejected the command`;
      await client.query("UPDATE lifecycle_commands SET status='failed',error_message=$2,completed_at=NOW() WHERE id=$1", [commandId, reason]);
      await client.query("UPDATE sessions SET status='failed',completed_at=NOW(),paused_at=NULL WHERE id=$1 AND status IN ('created','ready','running','paused')", [session.id]);
      await client.query("UPDATE session_conditions SET status='failed',completed_at=NOW() WHERE session_id=$1 AND status IN ('pending','active','paused')", [session.id]);
      await enqueueMessage(client, createEnvelope({
        routingKey: `events.${session.study_id}.${session.id}.error.command-failed`,
        studyId: session.study_id,
        sessionId: session.id,
        correlationId: commandId,
        payload: { commandId, component, error: reason },
      }));
      await enqueueMessage(client, createEnvelope({
        routingKey: `events.${session.study_id}.${session.id}.lifecycle.session-fail`,
        studyId: session.study_id,
        sessionId: session.id,
        correlationId: commandId,
        payload: { action: "fail", from: session.status, to: "failed", reason },
      }));
      await enqueueMessage(client, createEnvelope({
        routingKey: `events.${session.study_id}.${session.id}.lifecycle.command-failed`,
        studyId: session.study_id,
        sessionId: session.id,
        correlationId: commandId,
        payload: { commandId, action: row.action, status: "failed", error: reason },
      }));
      return null;
    }
    const acknowledged = [...new Set([...row.acknowledged_components, component])];
    await client.query("UPDATE lifecycle_commands SET acknowledged_components=$2 WHERE id=$1", [commandId, acknowledged]);
    if (row.required_components.every((required) => acknowledged.includes(required))) {
      if (row.action === "start" || row.action === "advance") {
        if (row.result_payload.rendererMode === "browser") {
          const payload = { ...row.result_payload, browserLaunchRequired: true };
          await client.query(
            "UPDATE lifecycle_commands SET result_payload=$2::jsonb WHERE id=$1",
            [commandId, JSON.stringify(payload)],
          );
          await this.#enqueueLifecycleEvent(client, session, commandId, row.action, payload);
          return null;
        }
        const next = await client.query<{ condition_id: string }>(
          "SELECT condition_id FROM session_conditions WHERE session_id=$1 AND status='pending' ORDER BY sequence LIMIT 1",
          [session.id],
        );
        const conditionId = next.rows[0]?.condition_id;
        if (conditionId === undefined) throw new Error("The lifecycle command has no pending condition to open.");
        return {
          commandId,
          action: row.action,
          session,
          conditionId,
          hostId: typeof row.result_payload.hostId === "string" ? row.result_payload.hostId : null,
          resultPayload: row.result_payload,
        };
      }
      await this.#enqueueLifecycleEvent(client, session, commandId, row.action, row.result_payload);
    }
    return null;
  }

  async #finalizeParticipantLayout(input: PendingOverlayFinalization): Promise<void> {
    let resultPayload = input.resultPayload;
    let overlayFailure: Record<string, unknown> | null = null;
    try {
      const result = await this.#overlays.openDesktopLayout({
        sessionId: input.session.id,
        conditionId: input.conditionId,
        hostId: input.hostId,
      });
      resultPayload = { ...resultPayload, overlay: result };
      if (input.action === "advance") {
        const cleanup = await this.#overlays.closeDesktopSession({
          sessionId: input.session.id,
          excludeInstanceIds: result.openedInstanceIds,
        });
        resultPayload = { ...resultPayload, previousOverlayCleanup: cleanup };
        if (cleanup.failures.length > 0) {
          overlayFailure = {
            message: "The next participant layout opened, but one or more previous widget windows could not be closed.",
            component: "desktop-overlay",
            conditionId: input.conditionId,
            failedInstanceIds: cleanup.failures.map(({ instanceId }) => instanceId),
            layoutId: result.layoutId,
          };
          resultPayload = { ...resultPayload, overlayFailure };
        }
      }
    } catch (error) {
      overlayFailure = {
        message: error instanceof Error ? error.message : "The participant layout could not be opened.",
        component: "desktop-overlay",
        conditionId: input.conditionId,
        failedInstanceId: error instanceof SessionLayoutOpenError ? error.failedInstanceId : null,
        layoutId: error instanceof SessionLayoutOpenError ? error.layoutId : null,
      };
      resultPayload = { ...resultPayload, overlayFailure };
    }

    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const command = await client.query<{ status: string }>(
        "SELECT status FROM lifecycle_commands WHERE id=$1 FOR UPDATE",
        [input.commandId],
      );
      if (command.rows[0]?.status !== "processing") {
        await client.query("COMMIT");
        return;
      }
      await client.query(
        `UPDATE lifecycle_commands
            SET result_payload=$2::jsonb,
                error_message=$3,
                completed_at=NULL
          WHERE id=$1`,
        [input.commandId, JSON.stringify(resultPayload), overlayFailure?.message ?? null],
      );
      await this.#enqueueLifecycleEvent(
        client,
        input.session,
        input.commandId,
        input.action,
        resultPayload,
      );
      if (overlayFailure !== null) {
        await enqueueMessage(client, createEnvelope({
          routingKey: `events.${input.session.study_id}.${input.session.id}.error.overlay-open-failed`,
          studyId: input.session.study_id,
          sessionId: input.session.id,
          correlationId: input.commandId,
          payload: { commandId: input.commandId, action: input.action, ...overlayFailure },
        }));
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      await this.#failCommand(input.commandId, error);
    } finally {
      client.release();
    }
  }

  async #cleanupParticipantLayout(input: PendingOverlayCleanup): Promise<void> {
    try {
      const cleanup = await this.#overlays.closeDesktopSession({ sessionId: input.session.id });
      if (input.commandId) {
        await this.#pool.query(
          `UPDATE lifecycle_commands
              SET result_payload=result_payload || jsonb_build_object('overlayCleanup',$2::jsonb)
            WHERE id=$1`,
          [input.commandId, JSON.stringify(cleanup)],
        );
      }
      if (cleanup.failures.length > 0) {
        const message = "The session ended, but one or more desktop widget windows could not be closed.";
        await enqueueMessage(this.#pool, createEnvelope({
          routingKey: `events.${input.session.study_id}.${input.session.id}.error.overlay-close-failed`,
          studyId: input.session.study_id,
          sessionId: input.session.id,
          correlationId: input.commandId || null,
          payload: {
            commandId: input.commandId || null,
            action: input.action,
            component: "desktop-overlay",
            message,
            failures: cleanup.failures,
          },
        }));
      }
    } catch (error) {
      this.#logger.warn({
        err: error,
        sessionId: input.session.id,
        commandId: input.commandId || null,
      }, "Terminal participant overlay cleanup failed");
    }
  }

  async #handleSystemEvent(message: MessageEnvelope): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      if (!(await claimInboxMessage(client, message.id, "core-api.system-event"))) {
        await client.query("COMMIT");
        return;
      }
      if (message.routingKey.endsWith(".component.heartbeat")) {
        this.#hub.updateComponent({
          component: message.metadata.source?.component ?? message.producer,
          instanceId: message.metadata.source?.instanceId ?? null,
          status: typeof message.payload.status === "string" ? message.payload.status : "ready",
          adapters: Array.isArray(message.payload.adapters) ? message.payload.adapters.filter((value): value is string => typeof value === "string") : [],
          metadata: message.payload,
        });
      } else if (message.routingKey.endsWith(".device.discovered")) {
        const sourceKey = typeof message.payload.sourceKey === "string" ? message.payload.sourceKey : null;
        const name = typeof message.payload.name === "string" ? message.payload.name : sourceKey;
        const type = typeof message.payload.type === "string" ? message.payload.type : "unknown";
        if (sourceKey !== null && name !== null) {
          const discovered = await client.query<{ id: string }>(
            `INSERT INTO devices(name,type,source_key,status,metadata,last_seen_at)
             VALUES($1,$2,$3,$4,$5::jsonb,NOW())
             ON CONFLICT(source_key) WHERE source_key IS NOT NULL DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,status=CASE WHEN devices.status='disabled' THEN devices.status ELSE EXCLUDED.status END,metadata=EXCLUDED.metadata,last_seen_at=NOW()
             RETURNING id`,
            [name, type, sourceKey, typeof message.payload.status === "string" ? message.payload.status : "connected", JSON.stringify({ ...asObject(message.payload.metadata), driverKey: message.payload.driverKey })],
          );
          const channels = Array.isArray(message.payload.channels) ? message.payload.channels : [];
          for (const value of channels) {
            const channel = asObject(value);
            if (typeof channel.key !== "string" || typeof channel.name !== "string") continue;
            await client.query(
              `INSERT INTO device_sensors(device_id,key,name,modality,unit,metadata,is_active)
               VALUES($1,$2,$3,$4,$5,$6::jsonb,TRUE)
               ON CONFLICT(device_id,key) DO UPDATE SET name=EXCLUDED.name,modality=EXCLUDED.modality,unit=EXCLUDED.unit,metadata=EXCLUDED.metadata,is_active=TRUE`,
              [discovered.rows[0]!.id, channel.key, channel.name, typeof channel.modality === "string" ? channel.modality : null, typeof channel.unit === "string" ? channel.unit : null, JSON.stringify({ sampleRate: channel.sampleRate, configurationSchema: channel.configurationSchema })],
            );
          }
          const channelKeys = channels.flatMap((value) => typeof asObject(value).key === "string" ? [String(asObject(value).key)] : []);
          await client.query("UPDATE device_sensors SET is_active=FALSE WHERE device_id=$1 AND is_active AND NOT(key=ANY($2::text[]))", [discovered.rows[0]!.id, channelKeys]);
        }
      } else if (message.routingKey.endsWith(".device.status")) {
        const sourceKey = typeof message.payload.sourceKey === "string" ? message.payload.sourceKey : null;
        const status = typeof message.payload.status === "string" ? message.payload.status : null;
        if (sourceKey !== null && status !== null) {
          await client.query(
            "UPDATE devices SET status=$2,status_message=$3,last_seen_at=NOW() WHERE source_key=$1 AND status<>'disabled'",
            [sourceKey, status, typeof message.payload.message === "string" ? message.payload.message : null],
          );
        }
      }
      await client.query("COMMIT");
      await this.#hub.broadcastEvent(message);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  #eventType(message: MessageEnvelope): string {
    return message.routingKey.split(".").slice(-2).join(".").slice(0, 100);
  }

  #isCriticalEvent(message: MessageEnvelope): boolean {
    return [".lifecycle.", ".trigger.", ".annotation.", ".error."].some((part) => message.routingKey.includes(part))
      || message.payload.level === "error" || message.payload.severity === "error";
  }

  #shouldPersist(message: MessageEnvelope, session: SessionRow): boolean {
    if (this.#isCriticalEvent(message)) return true;
    const policy = session.data_policy?.persistence;
    if (policy?.mode !== "sampled") return true;
    const every = Math.max(1, policy.sampleEveryN ?? 1);
    const numeric = Number.parseInt(message.id.replaceAll("-", "").slice(-8), 16);
    return numeric % every === 0;
  }

  #shouldBroadcast(message: MessageEnvelope, session: SessionRow): boolean {
    if (this.#isCriticalEvent(message)) return true;
    const maximumHz = session.data_policy?.realtime?.maximumHz;
    if (maximumHz === null || maximumHz === undefined) return true;
    const key = `${session.id}:${message.metadata.source?.component ?? message.producer}:${String(message.payload.modality ?? "event")}`;
    const now = Date.now();
    const previous = this.#lastRealtimeDelivery.get(key) ?? 0;
    if (now - previous < 1_000 / maximumHz) return false;
    this.#lastRealtimeDelivery.set(key, now);
    return true;
  }

  async #evaluateTriggers(client: PoolClient, session: SessionRow, message: MessageEnvelope): Promise<void> {
    const active = await client.query<{ id: string; condition_id: string }>(
      "SELECT id,condition_id FROM session_conditions WHERE session_id=$1 AND status='active' LIMIT 1",
      [session.id],
    );
    const sessionCondition = active.rows[0];
    if (sessionCondition === undefined) return;
    const triggers = await client.query<{
      id: string; expression: unknown; action_type: string; action_config: Record<string, unknown>; cooldown_ms: number;
    }>(
      `SELECT tr.id,tr.expression,tr.action_type,tr.action_config,tr.cooldown_ms
       FROM trigger_rules tr LEFT JOIN trigger_rule_state st ON st.trigger_rule_id=tr.id AND st.session_id=$2
       WHERE tr.condition_id=$1 AND tr.enabled
         AND (st.last_fired_at IS NULL OR st.last_fired_at + (tr.cooldown_ms*INTERVAL '1 millisecond') <= NOW())
       ORDER BY tr.priority,tr.name`,
      [sessionCondition.condition_id, session.id],
    );
    const context = {
      routingKey: message.routingKey,
      producer: message.producer,
      timestamp: message.timestamp,
      payload: normalizeTriggerPayload(message.payload),
      metadata: message.metadata,
      session: {
        elapsedSeconds: session.started_at === null || session.started_at === undefined
          ? 0
          : Math.max(0, (Date.now() - session.started_at.getTime()) / 1_000),
      },
    };
    for (const trigger of triggers.rows) {
      if (!evaluateTriggerExpression(trigger.expression, context)) continue;
      await client.query(
        `INSERT INTO trigger_rule_state(trigger_rule_id,session_id,last_fired_at,fire_count) VALUES($1,$2,NOW(),1)
         ON CONFLICT(trigger_rule_id,session_id) DO UPDATE SET last_fired_at=NOW(),fire_count=trigger_rule_state.fire_count+1`,
        [trigger.id, session.id],
      );
      await this.#executeTriggerAction(client, session, sessionCondition.id, trigger, message);
      await enqueueMessage(client, createEnvelope({
        routingKey: `events.${session.study_id}.${session.id}.trigger.rule-fired`,
        studyId: session.study_id,
        sessionId: session.id,
        correlationId: message.id,
        payload: { triggerRuleId: trigger.id, sessionConditionId: sessionCondition.id, actionType: trigger.action_type, sourceEventId: message.id },
      }));
    }
  }

  async #executeTriggerAction(
    client: PoolClient,
    session: SessionRow,
    sessionConditionId: string,
    trigger: { id: string; action_type: string; action_config: Record<string, unknown> },
    source: MessageEnvelope,
  ): Promise<void> {
    if (trigger.action_type === "widget.update") {
      this.#hub.broadcast("widget.updates", { ...trigger.action_config, triggerRuleId: trigger.id, sourceEventId: source.id }, session.study_id, session.id);
      return;
    }
    if (trigger.action_type === "overlay.command") {
      await this.#hub.sendOverlayCommand({
        ...trigger.action_config,
        triggerRuleId: trigger.id,
        sessionId: session.id,
      });
      return;
    }
    if (trigger.action_type === "simulator.command") {
      const command = SimulatorCommandNameSchema.parse(trigger.action_config.command);
      const parameters = typeof trigger.action_config.parameters === "object"
        && trigger.action_config.parameters !== null
        && !Array.isArray(trigger.action_config.parameters)
        ? trigger.action_config.parameters
        : {};
      const requiredCapability = trigger.action_config.requiredCapability === undefined
        ? null
        : SimulatorAdapterCapabilitySchema.parse(trigger.action_config.requiredCapability);
      const commandId = randomUUID();
      await enqueueMessage(client, createEnvelope({
        routingKey: "commands.sim-bridge.simulator-command",
        studyId: session.study_id,
        sessionId: session.id,
        correlationId: commandId,
        payload: {
          commandId,
          sessionId: session.id,
          sessionConditionId,
          command,
          parameters,
          requiredCapability,
          triggerRuleId: trigger.id,
          deadlineAt: new Date(Date.now() + this.#timeoutSeconds * 1_000).toISOString(),
        },
      }));
      return;
    }
    if (trigger.action_type === "session-condition.advance") {
      const pending = await client.query(
        "SELECT 1 FROM lifecycle_commands WHERE session_id=$1 AND status IN ('queued','processing') LIMIT 1", [session.id],
      );
      const next = await client.query("SELECT 1 FROM session_conditions WHERE session_id=$1 AND status='pending' LIMIT 1", [session.id]);
      if (pending.rowCount === 0 && next.rowCount === 1 && session.status === "running") {
        const commandId = randomUUID();
        await client.query(
          `INSERT INTO lifecycle_commands(id,session_id,action,reason,deadline_at)
           VALUES($1,$2,'advance',$3,NOW()+($4*INTERVAL '1 second'))`,
          [commandId, session.id, `Triggered by ${trigger.id}`, this.#timeoutSeconds],
        );
        await enqueueMessage(client, createEnvelope({
          routingKey: "commands.core-api.session-lifecycle",
          studyId: session.study_id,
          sessionId: session.id,
          correlationId: commandId,
          payload: { commandId, action: "advance", reason: `Triggered by ${trigger.id}` },
        }));
      }
    }
  }

  async #applyLifecycleEvent(
    client: PoolClient,
    session: SessionRow,
    message: MessageEnvelope,
  ): Promise<"complete" | "abort" | "fail" | null> {
    const commandId = String(message.payload.commandId ?? "");
    const action = String(message.payload.action ?? "") as LifecycleAction;
    if (action === "ready") {
      const snapshots = Array.isArray(message.payload.snapshots) ? message.payload.snapshots : [];
      for (const value of snapshots) {
        const snapshot = value as Record<string, unknown>;
        await client.query(
          "UPDATE session_conditions SET configuration_snapshot=$2::jsonb WHERE id=$1 AND session_id=$3 AND status='pending'",
          [snapshot.sessionConditionId, JSON.stringify(snapshot), session.id],
        );
      }
      await client.query("UPDATE sessions SET status='ready' WHERE id=$1", [session.id]);
    } else if (action === "start") {
      await client.query("UPDATE sessions SET status='running',started_at=COALESCE(started_at,NOW()),paused_at=NULL,started_by_user_id=COALESCE(started_by_user_id,(SELECT requested_by FROM lifecycle_commands WHERE id=$2)) WHERE id=$1", [session.id, commandId]);
      await client.query(`UPDATE session_conditions SET status='active',started_at=COALESCE(started_at,NOW()) WHERE id=(SELECT id FROM session_conditions WHERE session_id=$1 AND status='pending' ORDER BY sequence LIMIT 1)`, [session.id]);
      await client.query("UPDATE studies SET status='running' WHERE id=$1 AND status='ready'", [session.study_id]);
    } else if (action === "pause") {
      await client.query("UPDATE sessions SET status='paused',paused_at=NOW() WHERE id=$1", [session.id]);
      await client.query("UPDATE session_conditions SET status='paused' WHERE session_id=$1 AND status='active'", [session.id]);
    } else if (action === "resume") {
      await client.query("UPDATE sessions SET status='running',paused_at=NULL WHERE id=$1", [session.id]);
      await client.query("UPDATE session_conditions SET status='active' WHERE session_id=$1 AND status='paused'", [session.id]);
    } else if (action === "advance") {
      await client.query("UPDATE session_conditions SET status='completed',completed_at=NOW() WHERE session_id=$1 AND status='active'", [session.id]);
      await client.query(`UPDATE session_conditions SET status='active',started_at=COALESCE(started_at,NOW()) WHERE id=(SELECT id FROM session_conditions WHERE session_id=$1 AND status='pending' ORDER BY sequence LIMIT 1)`, [session.id]);
    } else {
      const target = ACTION_TARGET[action as Exclude<LifecycleAction, "advance">];
      const conditionTarget = action === "complete" ? "completed" : target;
      await client.query("UPDATE sessions SET status=$2,completed_at=NOW(),paused_at=NULL WHERE id=$1", [session.id, target]);
      await client.query(
        `UPDATE session_conditions SET status=CASE WHEN status='pending' AND $2='completed' THEN 'skipped' ELSE $2 END,completed_at=NOW()
         WHERE session_id=$1 AND status IN ('pending','active','paused')`,
        [session.id, conditionTarget],
      );
    }
    if (commandId) {
      await client.query(
        `UPDATE lifecycle_commands
            SET status=CASE WHEN result_payload ? 'overlayFailure' THEN 'failed' ELSE 'completed' END,
                completed_at=NOW()
          WHERE id=$1 AND status='processing'`,
        [commandId],
      );
    }
    return action === "complete" || action === "abort" || action === "fail" ? action : null;
  }

  async #failCommand(commandId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.#pool.query(
      "UPDATE lifecycle_commands SET status='failed',error_message=$2,completed_at=NOW() WHERE id=$1 AND status IN ('queued','processing')",
      [commandId, message.slice(0, 2_000)],
    ).catch((databaseError) => this.#logger.error({ err: databaseError, commandId }, "Could not mark lifecycle command failed"));
  }

  async #expireCommands(): Promise<void> {
    try {
      const expired = await this.#pool.query<{
        id: string;
        session_id: string;
        study_id: string;
        previous_status: SessionStatus;
        action: LifecycleAction;
      }>(
        `UPDATE lifecycle_commands lc SET status='timed_out',error_message='Lifecycle command timed out',completed_at=NOW()
         FROM sessions se WHERE lc.session_id=se.id AND lc.status IN ('queued','processing') AND lc.deadline_at<NOW()
         RETURNING lc.id,lc.session_id,se.study_id,se.status AS previous_status,lc.action`,
      );
      for (const row of expired.rows) {
        if (row.action === "complete" || row.action === "abort") {
          const warning = "Simulator cleanup acknowledgement timed out; terminal session state was preserved.";
          await this.#pool.query(
            `UPDATE lifecycle_commands SET status='completed',error_message=NULL,
               result_payload=result_payload || jsonb_build_object('cleanupWarning',$2),completed_at=NOW()
             WHERE id=$1`,
            [row.id, warning],
          );
          await this.#pool.query(
            "UPDATE sessions SET status=$2,completed_at=NOW(),paused_at=NULL WHERE id=$1",
            [row.session_id, row.action === "complete" ? "completed" : "aborted"],
          );
          await this.#pool.query(
            `UPDATE session_conditions SET
               status=CASE WHEN $2='completed' AND status='pending' THEN 'skipped' ELSE $2 END,
               completed_at=NOW()
             WHERE session_id=$1 AND status IN ('pending','active','paused')`,
            [row.session_id, row.action === "complete" ? "completed" : "aborted"],
          );
          await enqueueMessage(this.#pool, createEnvelope({
            routingKey: `events.${row.study_id}.${row.session_id}.error.simulator-cleanup-warning`,
            studyId: row.study_id,
            sessionId: row.session_id,
            correlationId: row.id,
            payload: { commandId: row.id, component: "sim-bridge", message: warning },
          }));
          await enqueueMessage(this.#pool, createEnvelope({
            routingKey: `events.${row.study_id}.${row.session_id}.lifecycle.session-${row.action}`,
            studyId: row.study_id,
            sessionId: row.session_id,
            correlationId: row.id,
            payload: {
              commandId: row.id,
              action: row.action,
              from: row.previous_status,
              to: row.action === "complete" ? "completed" : "aborted",
              reason: warning,
            },
          }));
          continue;
        }
        await this.#pool.query(
          `UPDATE sessions SET status='failed',completed_at=NOW(),paused_at=NULL
           WHERE id=$1 AND status IN ('created','ready','running','paused')`,
          [row.session_id],
        );
        await this.#pool.query(
          `UPDATE session_conditions SET status='failed',completed_at=NOW()
           WHERE session_id=$1 AND status IN ('pending','active','paused')`,
          [row.session_id],
        );
        await enqueueMessage(this.#pool, createEnvelope({
          routingKey: `events.${row.study_id}.${row.session_id}.error.command-timeout`,
          studyId: row.study_id,
          sessionId: row.session_id,
          correlationId: row.id,
          payload: { commandId: row.id, error: "Lifecycle command timed out" },
        }));
        await enqueueMessage(this.#pool, createEnvelope({
          routingKey: `events.${row.study_id}.${row.session_id}.lifecycle.command-timed-out`,
          studyId: row.study_id,
          sessionId: row.session_id,
          correlationId: row.id,
          payload: {
            commandId: row.id,
            action: row.action,
            status: "timed_out",
            error: "Lifecycle command timed out",
          },
        }));
        await enqueueMessage(this.#pool, createEnvelope({
          routingKey: `events.${row.study_id}.${row.session_id}.lifecycle.session-fail`,
          studyId: row.study_id,
          sessionId: row.session_id,
          correlationId: row.id,
          payload: { action: "fail", from: row.previous_status, to: "failed", reason: "Lifecycle command timed out" },
        }));
      }
    } catch (error) {
      this.#logger.error({ err: error }, "Lifecycle command timeout check failed");
    }
  }

  async #applyRetention(): Promise<void> {
    try {
      await this.#pool.query(
        `DELETE FROM session_events e USING sessions se,studies s
         WHERE e.session_id=se.id AND se.study_id=s.id
           AND (s.data_policy#>>'{persistence,retentionDays}') IS NOT NULL
           AND e."timestamp" < NOW() - ((s.data_policy#>>'{persistence,retentionDays}')::int * INTERVAL '1 day')
           AND COALESCE(e.routing_key,'') NOT LIKE '%.lifecycle.%'
           AND COALESCE(e.routing_key,'') NOT LIKE '%.trigger.%'
           AND COALESCE(e.routing_key,'') NOT LIKE '%.annotation.%'
           AND COALESCE(e.routing_key,'') NOT LIKE '%.error.%'
           AND COALESCE(e.payload->>'level','') <> 'error'
           AND COALESCE(e.payload->>'severity','') <> 'error'`,
      );
    } catch (error) {
      this.#logger.error({ err: error }, "Session event retention cleanup failed");
    }
  }
}

function normalizeTriggerPayload(payload:Record<string,unknown>):Record<string,unknown>{
  const normalized=structuredClone(payload);
  const currentVehicle=normalized.vehicle;
  const vehicle=currentVehicle!==null&&typeof currentVehicle==="object"&&!Array.isArray(currentVehicle)
    ? currentVehicle as Record<string,unknown>
    : {};
  if(vehicle.speed===undefined&&payload.speed!==undefined)vehicle.speed=payload.speed;
  if(vehicle.speedLimit===undefined&&payload.speedLimit!==undefined)vehicle.speedLimit=payload.speedLimit;
  normalized.vehicle=vehicle;
  return normalized;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
