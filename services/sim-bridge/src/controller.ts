import { randomUUID } from "node:crypto";

import {
  AdapterToBridgeMessageSchema,
  BridgeToAdapterMessageSchema,
  CarlaSessionConfigurationSchema,
  MessageEnvelopeSchema,
  RealtimeVehicleControlSchema,
  SimBridgeLifecycleCommandSchema,
  SimBridgeSimulatorCommandSchema,
  type AdapterCommandResultMessage,
  type AdapterRegisterMessage,
  type AdapterToBridgeMessage,
  type BridgeToAdapterMessage,
  type MessageEnvelope,
  type SimBridgeCommandAcknowledgement,
  type SimulatorSessionConfiguration,
} from "@scarline/contracts";
import type { FastifyBaseLogger } from "fastify";
import type { RawData, WebSocket } from "ws";

import type { SimBridgeConfig } from "./config.js";
import { CommandJournal, commandDigest } from "./journal.js";
import type { RegisteredAdapter } from "./registry.js";
import { AdapterRegistry } from "./registry.js";
import type { SimBridgeRabbitConnection } from "./rabbitmq.js";

interface NormalizedCommand {
  readonly commandId: string;
  readonly sessionId: string;
  readonly studyId: string;
  readonly deadlineAt: string;
  readonly terminal: boolean;
  readonly selectsAvailableAdapter: boolean;
  readonly configuration: SimulatorSessionConfiguration | null;
  readonly messageFor: (adapter: RegisteredAdapter) => BridgeToAdapterMessage;
}

interface PendingAdapterCommand {
  readonly adapterAssignedId: string;
  readonly adapterId: string;
  readonly message: BridgeToAdapterMessage;
  readonly timeout: NodeJS.Timeout;
  readonly resolve: (result: AdapterCommandResultMessage) => void;
}

const SUCCESS_RESULT_CODE = "COMPLETED";

export class SimBridgeController {
  readonly #config: SimBridgeConfig;
  readonly #logger: FastifyBaseLogger;
  readonly #rabbit: SimBridgeRabbitConnection;
  readonly #journal: CommandJournal;
  readonly #registry = new AdapterRegistry();
  readonly #instanceId = randomUUID();
  readonly #pending = new Map<string, PendingAdapterCommand>();
  readonly #reconnectTimers = new Map<string, NodeJS.Timeout>();
  #heartbeatTimer: NodeJS.Timeout | undefined;
  #staleTimer: NodeJS.Timeout | undefined;

  constructor(
    config: SimBridgeConfig,
    logger: FastifyBaseLogger,
    rabbit: SimBridgeRabbitConnection,
    journal = new CommandJournal(config.commandJournalPath),
  ) {
    this.#config = config;
    this.#logger = logger;
    this.#rabbit = rabbit;
    this.#journal = journal;
  }

  get isReady(): boolean {
    return this.#journal.isLoaded && this.#rabbit.isReady;
  }

  get adapters(): ReturnType<AdapterRegistry["summaries"]> {
    return this.#registry.summaries();
  }

  async start(): Promise<void> {
    await this.#journal.load();
    await this.#rabbit.start();
    const bridge = this.#config.project.sim_bridge;
    this.#heartbeatTimer = setInterval(
      () => void this.publishHeartbeat().catch((error) =>
        this.#logger.warn({ err: error }, "Component heartbeat could not be published"),
      ),
      bridge.adapter_heartbeat_interval_seconds * 1_000,
    );
    this.#heartbeatTimer.unref();
    this.#staleTimer = setInterval(
      () => this.#sweepStaleAdapters(),
      Math.max(1_000, Math.floor(bridge.adapter_stale_timeout_seconds * 500)),
    );
    this.#staleTimer.unref();
    await this.publishHeartbeat().catch((error) =>
      this.#logger.warn({ err: error }, "Initial component heartbeat could not be published"),
    );
  }

  async stop(): Promise<void> {
    if (this.#heartbeatTimer !== undefined) clearInterval(this.#heartbeatTimer);
    if (this.#staleTimer !== undefined) clearInterval(this.#staleTimer);
    this.#heartbeatTimer = undefined;
    this.#staleTimer = undefined;
    for (const timer of this.#reconnectTimers.values()) clearTimeout(timer);
    this.#reconnectTimers.clear();
    for (const pending of this.#pending.values()) clearTimeout(pending.timeout);
    this.#pending.clear();
    this.#registry.closeAll();
    await this.#rabbit.close();
  }

  attachSocket(socket: WebSocket): void {
    let assignedId: string | null = null;
    let messageQueue = Promise.resolve();
    socket.on("message", (raw) => {
      messageQueue = messageQueue
        .then(async () => {
          const newAssignedId = await this.#handleSocketMessage(socket, raw, assignedId);
          if (newAssignedId !== null) assignedId = newAssignedId;
        })
        .catch((error) => {
          this.#logger.warn({ err: error }, "Simulator adapter message was rejected");
          this.#sendError(socket, null, "INVALID_MESSAGE", error instanceof Error ? error.message : "Invalid adapter message");
          socket.close(1008, "Invalid adapter message");
        });
    });
    socket.on("close", () => {
      if (assignedId !== null) this.#handleDisconnect(assignedId, socket);
    });
    socket.on("error", (error) => this.#logger.warn({ err: error, assignedId }, "Simulator adapter socket error"));
  }

  async handleCommand(envelope: MessageEnvelope): Promise<void> {
    const command = this.#normalizeCommand(envelope);
    const digest = commandDigest(envelope);
    const existing = await this.#journal.begin(command.commandId, digest, command.configuration);
    if (existing.acknowledgement !== null) {
      await this.#publishAcknowledgement(envelope, existing.acknowledgement);
      return;
    }
    if (Date.parse(command.deadlineAt) <= Date.now()) {
      const acknowledgement = command.terminal
        ? this.#ack(command.commandId, "completed", null, "Simulator cleanup command expired before delivery.")
        : this.#ack(command.commandId, "failed", "Simulator command expired before delivery.", null);
      await this.#finishAndPublish(envelope, acknowledgement);
      return;
    }

    const adapter = command.configuration === null
      ? this.#registry.forSession(command.sessionId)
      : command.selectsAvailableAdapter
        ? this.#registry.forSession(command.sessionId)
          ?? this.#registry.available(command.configuration.simulatorType)
        : this.#registry.forSession(command.sessionId);
    if (adapter === undefined || adapter.socket === null) {
      const message = adapter === undefined
        ? "No compatible simulator adapter is available for this session."
        : "The session adapter is disconnected.";
      const acknowledgement = command.terminal
        ? this.#ack(command.commandId, "completed", null, `${message} Local binding was cleared.`)
        : this.#ack(command.commandId, "failed", message, null);
      if (adapter !== undefined && command.terminal) await this.#clearBinding(adapter);
      await this.#finishAndPublish(envelope, acknowledgement);
      return;
    }

    await this.#journal.assignAdapter(command.commandId, adapter.adapterId);
    let adapterMessage: BridgeToAdapterMessage;
    try {
      adapterMessage = command.messageFor(adapter);
    } catch (error) {
      await this.#finishAndPublish(
        envelope,
        this.#ack(
          command.commandId,
          "failed",
          error instanceof Error ? error.message : "Simulator command is not supported.",
          null,
        ),
      );
      return;
    }
    const result = await this.#execute(adapter, adapterMessage, command.deadlineAt);
    if (!result.success && command.terminal) {
      await this.#clearBinding(adapter);
      await this.#publishCleanupWarning(command, adapter, result.message);
      await this.#finishAndPublish(
        envelope,
        this.#ack(command.commandId, "completed", null, `Simulator cleanup failed: ${result.message}`),
      );
      return;
    }
    if (!result.success) {
      await this.#finishAndPublish(
        envelope,
        this.#ack(command.commandId, "failed", `${result.code}: ${result.message}`, null),
      );
      return;
    }

    if (command.configuration !== null) {
      this.#registry.bind(adapter.assignedId, command.configuration);
      await this.#journal.setBinding(adapter.adapterId, command.configuration);
    } else if (command.terminal) {
      await this.#clearBinding(adapter);
    }
    await this.#finishAndPublish(
      envelope,
      this.#ack(command.commandId, "completed", null, null),
    );
  }

  async publishHeartbeat(): Promise<void> {
    await this.#rabbit.publish(this.#envelope({
      routingKey: "events.system.global.component.heartbeat",
      studyId: null,
      sessionId: null,
      correlationId: null,
      payload: {
        status: "ready",
        adapters: this.#registry.adapterTypes(),
        connectedAdapters: this.#registry.summaries().filter((adapter) => adapter.connected).length,
      },
    }));
  }

  async handleRealtimeControl(input: unknown): Promise<void> {
    const control = RealtimeVehicleControlSchema.parse(input);
    if (Date.now() - Date.parse(control.timestamp) > this.#config.project.simulator.carla.control_timeout_milliseconds) return;
    const adapter = this.#registry.forSession(control.sessionId);
    if (adapter?.socket === null || adapter === undefined) return;
    const active = adapter.activeConfiguration;
    if (
      active === null
      || active.studyId !== control.studyId
      || active.sessionConditionId !== control.sessionConditionId
      || active.simulatorType !== "carla"
    ) return;
    const configuration = CarlaSessionConfigurationSchema.safeParse(active.configuration);
    if (!configuration.success || configuration.data.controlMode !== "io") return;
    this.#send(adapter.socket, BridgeToAdapterMessageSchema.parse({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "adapter.vehicle_control",
      studyId: control.studyId,
      sessionId: control.sessionId,
      sessionConditionId: control.sessionConditionId,
      sourceKey: control.sourceKey,
      sequence: control.sequence,
      sourceTimestamp: control.timestamp,
      throttle: control.throttle,
      steer: control.steer,
      brake: control.brake,
    }));
  }

  async #handleSocketMessage(
    socket: WebSocket,
    raw: RawData,
    assignedId: string | null,
  ): Promise<string | null> {
    const maximumBytes = this.#config.project.sim_bridge.maximum_websocket_message_bytes;
    const buffer = Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw);
    if (buffer.byteLength > maximumBytes) throw new Error(`Adapter message exceeds ${maximumBytes} bytes.`);
    const message = AdapterToBridgeMessageSchema.parse(JSON.parse(buffer.toString("utf8")));
    if (assignedId === null) {
      if (message.type !== "adapter.register") {
        throw new Error("The first adapter message must be adapter.register.");
      }
      return this.#registerAdapter(socket, message);
    }
    if (message.type === "adapter.register") throw new Error("Adapter is already registered.");
    await this.#handleRegisteredMessage(assignedId, message);
    return null;
  }

  async #registerAdapter(socket: WebSocket, registration: AdapterRegisterMessage): Promise<string> {
    const committed = this.#journal.getBinding(registration.adapterId);
    if (registration.activeSessionId === null && committed !== undefined) {
      await this.#publishSessionFailure(
        committed,
        "Simulator adapter reconnected without the session state recorded by Sim Bridge.",
      );
      await this.#journal.clearBinding(registration.adapterId);
    }
    const recovered = registration.activeSessionId === null
      ? undefined
      : this.#journal.recoverBinding(registration.adapterId);
    const adapter = this.#registry.register(registration, socket, recovered);
    const reconnectTimer = this.#reconnectTimers.get(adapter.assignedId);
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
    this.#reconnectTimers.delete(adapter.assignedId);
    this.#send(socket, {
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "adapter.registered",
      correlationId: registration.id,
      assignedId: adapter.assignedId,
      heartbeatIntervalMilliseconds:
        this.#config.project.sim_bridge.adapter_heartbeat_interval_seconds * 1_000,
      maximumMessageBytes: this.#config.project.sim_bridge.maximum_websocket_message_bytes,
    });
    for (const pending of this.#pending.values()) {
      if (pending.adapterId === adapter.adapterId) this.#send(socket, pending.message);
    }
    await this.publishHeartbeat();
    this.#logger.info({ adapterId: adapter.adapterId, simulatorType: adapter.simulatorType }, "Simulator adapter registered");
    return adapter.assignedId;
  }

  async #handleRegisteredMessage(assignedId: string, message: Exclude<AdapterToBridgeMessage, AdapterRegisterMessage>): Promise<void> {
    const adapter = this.#registry.get(assignedId);
    if (adapter === undefined) throw new Error("Unknown simulator adapter.");
    if (message.type === "adapter.heartbeat") {
      this.#registry.heartbeat(assignedId, message.status, message.activeSessionId);
      return;
    }
    if (message.type === "adapter.command_result") {
      const pending = this.#pending.get(message.commandId);
      if (pending === undefined || pending.adapterAssignedId !== assignedId) return;
      clearTimeout(pending.timeout);
      this.#pending.delete(message.commandId);
      pending.resolve(message);
      return;
    }
    const configuration = adapter.activeConfiguration;
    if (configuration === null) throw new Error("Adapter emitted session data while it was not bound.");
    if (message.type === "vehicle.telemetry") {
      const minimumInterval = 1_000 / this.#config.project.sim_bridge.telemetry_maximum_hz;
      const now = Date.now();
      if (now - adapter.lastTelemetryAt < minimumInterval) return;
      adapter.lastTelemetryAt = now;
      await this.#publishSessionEvent(configuration, "driving", "vehicle.telemetry", {
        sessionConditionId: configuration.sessionConditionId,
        modality: "driving",
        speed: message.speed,
        throttle: message.throttle,
        steer: message.steer,
        brake: message.brake,
      }, message.id);
      return;
    }
    if (message.type === "simulator.collision") {
      await this.#publishSessionEvent(configuration, "driving", "simulator.collision", {
        sessionConditionId: configuration.sessionConditionId,
        otherActor: message.otherActor,
        impulse: message.impulse,
      }, message.id);
      return;
    }
    if (message.type === "simulator.lane_invasion") {
      await this.#publishSessionEvent(configuration, "driving", "simulator.lane-invasion", {
        sessionConditionId: configuration.sessionConditionId,
        markings: message.markings,
      }, message.id);
      return;
    }
    if (message.type === "simulator.state") {
      await this.#publishSessionEvent(configuration, "simulator", "simulator.state", {
        sessionConditionId: configuration.sessionConditionId,
        state: message.state,
        details: message.details,
      }, message.id);
      return;
    }
    if (message.type === "simulator.gnss") {
      await this.#publishSessionEvent(configuration, "location", "simulator.gnss", {
        sessionConditionId: configuration.sessionConditionId,
        sensorId: message.sensorId,
        latitude: message.latitude,
        longitude: message.longitude,
        altitude: message.altitude,
      }, message.id);
      return;
    }
    if (message.type === "simulator.imu") {
      await this.#publishSessionEvent(configuration, "motion", "simulator.imu", {
        sessionConditionId: configuration.sessionConditionId,
        sensorId: message.sensorId,
        accelerometer: message.accelerometer,
        gyroscope: message.gyroscope,
        compass: message.compass,
      }, message.id);
      return;
    }
    if (message.type === "simulator.sensor_artifact") {
      await this.#publishSessionEvent(configuration, "simulator", "simulator.sensor-artifact", {
        sessionConditionId: configuration.sessionConditionId,
        sensorId: message.sensorId,
        kind: message.kind,
        frame: message.frame,
        reference: message.reference,
        metadata: message.metadata,
      }, message.id);
      return;
    }
    await this.#publishSessionEvent(configuration, "error", "adapter.error", {
      sessionConditionId: configuration.sessionConditionId,
      code: message.code,
      message: message.message,
      fatal: message.fatal,
      details: message.details,
    }, message.id);
    if (message.fatal) {
      await this.#publishSessionFailure(configuration, `${message.code}: ${message.message}`);
      await this.#clearBinding(adapter);
    }
  }

  #normalizeCommand(envelope: MessageEnvelope): NormalizedCommand {
    const studyId = envelope.metadata.studyId;
    const sessionId = envelope.metadata.sessionId;
    if (studyId === null || sessionId === null) throw new Error("Simulator commands require study and session metadata.");
    if (envelope.routingKey === "commands.sim-bridge.simulator-command") {
      const command = SimBridgeSimulatorCommandSchema.parse(envelope.payload);
      if (command.sessionId !== sessionId) throw new Error("Simulator command session metadata does not match its payload.");
      return {
        commandId: command.commandId,
        sessionId,
        studyId,
        deadlineAt: command.deadlineAt,
        terminal: false,
        selectsAvailableAdapter: false,
        configuration: null,
        messageFor: (adapter) => {
          if (command.requiredCapability !== null && !adapter.capabilities.includes(command.requiredCapability)) {
            throw new Error(`Adapter does not provide required capability ${command.requiredCapability}.`);
          }
          return BridgeToAdapterMessageSchema.parse({
            version: 1,
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            type: "adapter.simulator_command",
            commandId: command.commandId,
            studyId,
            sessionId,
            sessionConditionId: command.sessionConditionId,
            command: command.command,
            parameters: command.parameters,
            requiredCapability: command.requiredCapability,
            deadlineAt: command.deadlineAt,
          });
        },
      };
    }
    const suffix = envelope.routingKey.replace("commands.sim-bridge.session-", "");
    const command = SimBridgeLifecycleCommandSchema.parse(envelope.payload);
    if (suffix !== command.action || command.sessionId !== sessionId) {
      throw new Error("Lifecycle routing key, metadata, and payload do not match.");
    }
    if ("configuration" in command && (
      command.configuration.studyId !== studyId
      || command.configuration.sessionId !== sessionId
    )) {
      throw new Error("Lifecycle simulator configuration does not match message metadata.");
    }
    const configuration = "configuration" in command ? command.configuration : null;
    return {
      commandId: command.commandId,
      sessionId,
      studyId,
      deadlineAt: command.deadlineAt,
      terminal: command.action === "complete" || command.action === "abort",
      selectsAvailableAdapter: command.action === "start",
      configuration,
      messageFor: () => {
        const common = {
          version: 1 as const,
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          commandId: command.commandId,
          studyId,
          sessionId,
          deadlineAt: command.deadlineAt,
        };
        if (command.action === "start") {
          return BridgeToAdapterMessageSchema.parse({
            ...common,
            type: "adapter.bind_session",
            sessionConditionId: command.configuration.sessionConditionId,
            sequence: command.configuration.sequence,
            simulatorType: command.configuration.simulatorType,
            configuration: command.configuration.configuration,
          });
        }
        if (command.action === "advance") {
          return BridgeToAdapterMessageSchema.parse({
            ...common,
            type: "adapter.advance_session",
            sessionConditionId: command.configuration.sessionConditionId,
            sequence: command.configuration.sequence,
            simulatorType: command.configuration.simulatorType,
            configuration: command.configuration.configuration,
          });
        }
        if (command.action === "pause") return BridgeToAdapterMessageSchema.parse({ ...common, type: "adapter.pause_session" });
        if (command.action === "resume") return BridgeToAdapterMessageSchema.parse({ ...common, type: "adapter.resume_session" });
        return BridgeToAdapterMessageSchema.parse({ ...common, type: "adapter.unbind_session", reason: command.action });
      },
    };
  }

  async #execute(
    adapter: RegisteredAdapter,
    message: BridgeToAdapterMessage,
    deadlineAt: string,
  ): Promise<AdapterCommandResultMessage> {
    const commandId = "commandId" in message ? message.commandId : null;
    if (commandId === null) throw new Error("Only adapter command messages can be executed.");
    const socket = adapter.socket;
    if (socket === null) return this.#syntheticResult(commandId, false, "ADAPTER_DISCONNECTED", "Simulator adapter is disconnected.", adapter);
    const configuredTimeout = this.#config.project.sim_bridge.adapter_command_timeout_seconds * 1_000;
    const remaining = Math.max(1, Date.parse(deadlineAt) - Date.now());
    return new Promise<AdapterCommandResultMessage>((resolve) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(commandId);
        resolve(this.#syntheticResult(commandId, false, "ADAPTER_TIMEOUT", "Simulator adapter command timed out.", adapter));
      }, Math.min(configuredTimeout, remaining));
      timeout.unref();
      this.#pending.set(commandId, {
        adapterAssignedId: adapter.assignedId,
        adapterId: adapter.adapterId,
        message,
        timeout,
        resolve,
      });
      try {
        this.#send(socket, message);
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(commandId);
        resolve(this.#syntheticResult(
          commandId,
          false,
          "ADAPTER_SEND_FAILED",
          error instanceof Error ? error.message : "Could not send adapter command.",
          adapter,
        ));
      }
    });
  }

  #handleDisconnect(assignedId: string, socket: WebSocket): void {
    const adapter = this.#registry.disconnect(assignedId, socket);
    if (adapter === undefined || this.#reconnectTimers.has(assignedId)) return;
    const timeout = setTimeout(() => {
      this.#reconnectTimers.delete(assignedId);
      const removed = this.#registry.remove(assignedId);
      if (removed === undefined || removed.socket !== null) return;
      for (const [commandId, pending] of this.#pending) {
        if (pending.adapterId !== removed.adapterId) continue;
        clearTimeout(pending.timeout);
        this.#pending.delete(commandId);
        pending.resolve(this.#syntheticResult(
          commandId,
          false,
          "ADAPTER_DISCONNECTED",
          "Simulator adapter did not reconnect within the configured grace period.",
          removed,
        ));
      }
      if (removed.activeConfiguration !== null) {
        void this.#publishSessionFailure(
          removed.activeConfiguration,
          "Simulator adapter disconnected during an active session.",
        ).then(() => this.#journal.clearBinding(removed.adapterId)).catch((error) =>
          this.#logger.error({ err: error }, "Could not publish simulator disconnect failure"),
        );
      }
      void this.publishHeartbeat().catch(() => undefined);
    }, this.#config.project.sim_bridge.adapter_reconnect_grace_seconds * 1_000);
    timeout.unref();
    this.#reconnectTimers.set(assignedId, timeout);
  }

  #sweepStaleAdapters(): void {
    const staleMilliseconds = this.#config.project.sim_bridge.adapter_stale_timeout_seconds * 1_000;
    for (const adapter of this.#registry.stale(staleMilliseconds)) {
      adapter.socket?.close(4001, "Adapter heartbeat expired");
    }
  }

  async #clearBinding(adapter: RegisteredAdapter): Promise<void> {
    this.#registry.unbind(adapter.assignedId);
    await this.#journal.clearBinding(adapter.adapterId);
  }

  async #finishAndPublish(envelope: MessageEnvelope, acknowledgement: SimBridgeCommandAcknowledgement): Promise<void> {
    await this.#journal.finish(acknowledgement.commandId, acknowledgement);
    await this.#publishAcknowledgement(envelope, acknowledgement);
  }

  async #publishAcknowledgement(
    command: MessageEnvelope,
    acknowledgement: SimBridgeCommandAcknowledgement,
  ): Promise<void> {
    const studyId = command.metadata.studyId;
    const sessionId = command.metadata.sessionId;
    if (studyId === null || sessionId === null) throw new Error("Command acknowledgement requires session scope.");
    await this.#rabbit.publish(this.#envelope({
      routingKey: `events.${studyId}.${sessionId}.command.ack`,
      studyId,
      sessionId,
      correlationId: acknowledgement.commandId,
      payload: acknowledgement,
    }));
  }

  async #publishSessionEvent(
    configuration: SimulatorSessionConfiguration,
    modality: string,
    eventType: string,
    payload: Record<string, unknown>,
    correlationId: string | null,
  ): Promise<void> {
    await this.#rabbit.publish(this.#envelope({
      routingKey: `events.${configuration.studyId}.${configuration.sessionId}.${modality}.${eventType}`,
      studyId: configuration.studyId,
      sessionId: configuration.sessionId,
      correlationId,
      payload,
    }));
  }

  async #publishCleanupWarning(command: NormalizedCommand, adapter: RegisteredAdapter, message: string): Promise<void> {
    await this.#rabbit.publish(this.#envelope({
      routingKey: `events.${command.studyId}.${command.sessionId}.error.simulator-cleanup-warning`,
      studyId: command.studyId,
      sessionId: command.sessionId,
      correlationId: command.commandId,
      payload: { commandId: command.commandId, adapterId: adapter.adapterId, message },
    }));
  }

  async #publishSessionFailure(configuration: SimulatorSessionConfiguration, reason: string): Promise<void> {
    await this.#rabbit.publish(this.#envelope({
      routingKey: `events.${configuration.studyId}.${configuration.sessionId}.lifecycle.session-fail`,
      studyId: configuration.studyId,
      sessionId: configuration.sessionId,
      correlationId: null,
      payload: {
        action: "fail",
        from: "running",
        to: "failed",
        reason,
        sessionConditionId: configuration.sessionConditionId,
      },
    }));
  }

  #ack(
    commandId: string,
    status: "completed" | "failed",
    error: string | null,
    warning: string | null,
  ): SimBridgeCommandAcknowledgement {
    return { commandId, component: "sim-bridge", status, error, warning };
  }

  #syntheticResult(
    commandId: string,
    success: boolean,
    code: string,
    message: string,
    adapter: RegisteredAdapter,
  ): AdapterCommandResultMessage {
    return {
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "adapter.command_result",
      commandId,
      success,
      code: success ? SUCCESS_RESULT_CODE : code,
      message,
      details: {},
      activeSessionId: adapter.activeConfiguration?.sessionId ?? null,
    };
  }

  #envelope(input: {
    routingKey: string;
    studyId: string | null;
    sessionId: string | null;
    correlationId: string | null;
    payload: Record<string, unknown>;
  }): MessageEnvelope {
    return MessageEnvelopeSchema.parse({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      routingKey: input.routingKey,
      producer: "sim-bridge",
      payload: input.payload,
      metadata: {
        studyId: input.studyId,
        sessionId: input.sessionId,
        correlationId: input.correlationId,
        source: { component: "sim-bridge", instanceId: this.#instanceId },
      },
    });
  }

  #send(socket: WebSocket, message: BridgeToAdapterMessage): void {
    socket.send(JSON.stringify(BridgeToAdapterMessageSchema.parse(message)));
  }

  #sendError(socket: WebSocket, correlationId: string | null, code: string, message: string): void {
    this.#send(socket, {
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "bridge.error",
      correlationId,
      code,
      message: message.slice(0, 2_000),
    });
  }
}
