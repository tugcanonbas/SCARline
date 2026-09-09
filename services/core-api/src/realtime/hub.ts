import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  OverlayHostCommandSchema,
  OverlayDisplaySchema,
  OverlayHostEventSchema,
  OverlayWindowStatusPayloadSchema,
  WebSocketClientMessageSchema,
  type MessageEnvelope,
  type OverlayRuntimeScope,
  type OverlayRuntimeSnapshot,
  type WebSocketChannel,
} from "@scarline/contracts";

import type { AuthenticatedPrincipal } from "../auth/service.js";
import { loadOverlayRuntimeSnapshot } from "../overlay/runtime.js";

interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: { toString(): string }) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}

interface Subscription {
  readonly channel: WebSocketChannel;
  readonly studyId: string | null;
  readonly sessionId: string | null;
}

interface UserConnection {
  readonly socket: SocketLike;
  readonly principal: AuthenticatedPrincipal;
  readonly subscriptions: Subscription[];
}

interface OverlayRendererConnection {
  readonly socket: SocketLike;
  readonly scope: OverlayRuntimeScope;
  readonly snapshot: OverlayRuntimeSnapshot;
}

interface OverlayHostConnection {
  readonly socket: SocketLike;
  hostId: string | null;
}

interface OverlayHostRecord {
  readonly hostId: string;
  socket: SocketLike | null;
  connectedAt: string;
  disconnectedAt: string | null;
  lastSeenAt: string;
  status: Extract<ReturnType<typeof OverlayHostEventSchema.parse>, { type: "overlay.status" }> | null;
}

interface PendingOverlayCommand {
  readonly commandId: string;
  readonly hostId: string;
  readonly socket: SocketLike;
  readonly sentAt: string;
  readonly resolve: (result: OverlayCommandDispatchResult) => void;
  readonly reject: (error: OverlayCommandError) => void;
  readonly timer: NodeJS.Timeout;
}

export interface OverlayCommandDispatchResult {
  readonly commandId: string;
  readonly hostId: string;
  readonly accepted: true;
  readonly error: null;
  readonly sentAt: string;
  readonly completedAt: string;
}

export class OverlayCommandError extends Error {
  readonly code: "OVERLAY_UNAVAILABLE" | "OVERLAY_HOST_SELECTION_REQUIRED" | "OVERLAY_HOST_NOT_CONNECTED" | "OVERLAY_COMMAND_REJECTED" | "OVERLAY_DISCONNECTED" | "OVERLAY_COMMAND_TIMEOUT" | "INVALID_OVERLAY_COMMAND";
  readonly hostId: string | null;
  readonly commandId: string | null;

  constructor(
    code: OverlayCommandError["code"],
    message: string,
    input: { hostId?: string | null; commandId?: string | null } = {},
  ) {
    super(message);
    this.name = "OverlayCommandError";
    this.code = code;
    this.hostId = input.hostId ?? null;
    this.commandId = input.commandId ?? null;
  }
}

export class RealtimeHub {
  readonly #pool: Pool;
  readonly #logger: FastifyBaseLogger;
  readonly #users = new Set<UserConnection>();
  readonly #overlayConnections = new Set<OverlayHostConnection>();
  readonly #overlayHosts = new Map<string, OverlayHostRecord>();
  readonly #pendingOverlayCommands = new Map<string, PendingOverlayCommand>();
  readonly #renderers = new Set<OverlayRendererConnection>();
  readonly #components = new Map<string, { component: string; instanceId: string | null; status: string; adapters: string[]; updatedAt: string; metadata: Record<string, unknown> }>();
  #selectedOverlayHostId: string | null = null;
  #overlaySelectionExplicit = false;

  constructor(pool: Pool, logger: FastifyBaseLogger) {
    this.#pool = pool;
    this.#logger = logger;
  }

  attachUser(socket: SocketLike, principal: AuthenticatedPrincipal): void {
    const connection: UserConnection = { socket, principal, subscriptions: [] };
    this.#users.add(connection);
    socket.on("message", (data) => void this.#handleUserMessage(connection, data.toString()));
    socket.on("close", () => this.#users.delete(connection));
    socket.on("error", (error) => this.#logger.warn({ err: error, userId: principal.id }, "User WebSocket error"));
  }

  attachOverlay(socket: SocketLike): void {
    const connection: OverlayHostConnection = { socket, hostId: null };
    this.#overlayConnections.add(connection);
    socket.on("message", (data) => {
      try {
        const parsed = OverlayHostEventSchema.parse(JSON.parse(data.toString()));
        if (connection.hostId !== null && connection.hostId !== parsed.hostId) {
          this.#logger.warn({ expectedHostId: connection.hostId, receivedHostId: parsed.hostId }, "Overlay host changed identity on an existing connection");
          socket.close(1008, "Overlay host identity changed");
          return;
        }
        if (connection.hostId === null) this.#registerOverlayHost(connection, parsed.hostId);
        const record = this.#overlayHosts.get(parsed.hostId);
        if (record === undefined || record.socket !== socket) return;
        record.lastSeenAt = parsed.occurredAt;
        if (parsed.type === "overlay.status") {
          record.status = parsed;
          if (this.#selectedOverlayHostId === record.hostId) {
            void this.#publishOverlayWindowStatus(record, parsed);
          }
        } else if (parsed.type === "overlay.window.changed") {
          void this.#updateOverlayWindow(record, parsed);
        } else {
          this.#completeOverlayCommand(parsed);
        }
      } catch (error) {
        this.#logger.warn({ err: error, hostId: connection.hostId }, "Invalid overlay control message ignored");
      }
    });
    socket.on("close", () => {
      this.#overlayConnections.delete(connection);
      const disconnectedAt = new Date().toISOString();
      if (connection.hostId !== null) {
        const record = this.#overlayHosts.get(connection.hostId);
        if (record?.socket === socket) {
          record.socket = null;
          record.disconnectedAt = disconnectedAt;
        }
      }
      this.#rejectPendingForSocket(socket, "OVERLAY_DISCONNECTED", "The desktop overlay disconnected before acknowledging the command.");
      this.#refreshAutomaticOverlaySelection();
    });
    socket.on("error", (error) => this.#logger.warn({ err: error, hostId: connection.hostId }, "Overlay WebSocket error"));
  }

  async attachRenderer(socket: SocketLike, scope: OverlayRuntimeScope): Promise<void> {
    const status = this.overlayStatus as { displays?: unknown };
    const snapshot = await loadOverlayRuntimeSnapshot(
      this.#pool,
      scope,
      OverlayDisplaySchema.array().parse(Array.isArray(status.displays) ? status.displays : []),
    );
    const connection: OverlayRendererConnection = { socket, scope, snapshot };
    this.#renderers.add(connection);
    socket.send(JSON.stringify({ type: "overlay.runtime.ready", scope }));
    for (const widget of snapshot.widgets) {
      if (Object.keys(widget.bindings).length > 0) {
        socket.send(JSON.stringify({
          type: "overlay.runtime.bindings",
          instanceId: widget.instanceId,
          bindings: widget.bindings,
        }));
      }
      socket.send(JSON.stringify({
        type: "overlay.runtime.state",
        instanceId: widget.instanceId,
        state: widget.state,
      }));
    }
    socket.on("close", () => this.#renderers.delete(connection));
    socket.on("error", (error) => {
      this.#logger.warn({ err: error, scope }, "Overlay renderer WebSocket error");
      this.#renderers.delete(connection);
    });
  }

  get overlayStatus(): Record<string, unknown> {
    const connectedHosts = this.#connectedOverlayHosts();
    const selected = this.#selectedOverlayHostId === null
      ? null
      : this.#overlayHosts.get(this.#selectedOverlayHostId) ?? null;
    return {
      connected: connectedHosts.length > 0,
      selectedHostId: selected?.socket === null ? null : selected?.hostId ?? null,
      selectionRequired: connectedHosts.length > 1 && selected === null,
      hosts: [...this.#overlayHosts.values()]
        .sort((left, right) => left.hostId.localeCompare(right.hostId))
        .map((record) => ({
          hostId: record.hostId,
          connected: record.socket !== null && record.socket.readyState === 1,
          connectedAt: record.connectedAt,
          disconnectedAt: record.disconnectedAt,
          lastSeenAt: record.lastSeenAt,
          ready: record.status?.ready ?? false,
          displays: record.status?.displays ?? [],
          windows: record.status?.windows ?? [],
        })),
      displays: selected?.status?.displays ?? [],
      windows: selected?.status?.windows ?? [],
    };
  }

  selectOverlayHost(hostId: string): void {
    const record = this.#overlayHosts.get(hostId);
    if (record === undefined || record.socket === null || record.socket.readyState !== 1) {
      throw new OverlayCommandError(
        "OVERLAY_HOST_NOT_CONNECTED",
        `Desktop overlay host ${hostId} is not connected.`,
        { hostId },
      );
    }
    this.#selectedOverlayHostId = hostId;
    this.#overlaySelectionExplicit = true;
  }

  updateComponent(input: { component: string; instanceId?: string | null; status?: string; adapters?: string[]; metadata?: Record<string, unknown> }): void {
    const key = `${input.component}:${input.instanceId ?? "default"}`;
    this.#components.set(key, {
      component: input.component,
      instanceId: input.instanceId ?? null,
      status: input.status ?? "ready",
      adapters: input.adapters ?? [],
      updatedAt: new Date().toISOString(),
      metadata: input.metadata ?? {},
    });
  }

  get componentStatus(): Record<string, unknown>[] {
    const staleBefore = Date.now() - 15_000;
    return [...this.#components.values()].map((item) => ({
      ...item,
      available: item.status === "ready" && Date.parse(item.updatedAt) >= staleBefore,
    }));
  }

  missingSimulatorCapabilities(simulatorTypes: string[]): string[] {
    const available = this.componentStatus as Array<{ component: string; available: boolean; adapters: string[] }>;
    const bridges = available.filter((item) => item.component === "sim-bridge" && item.available);
    if (bridges.length === 0) return ["sim-bridge"];
    const adapters = new Set(bridges.flatMap((item) => item.adapters));
    return [...new Set(simulatorTypes)].filter((type) => !adapters.has(type)).map((type) => `${type}-adapter`);
  }

  isComponentAvailable(component: string): boolean {
    return (this.componentStatus as Array<{ component: string; available: boolean }>).some(
      (item) => item.component === component && item.available,
    );
  }

  get isOverlayConnected(): boolean {
    return this.#connectedOverlayHosts().length > 0 || this.#renderers.size > 0;
  }

  get isDesktopOverlayConnected(): boolean {
    return this.#connectedOverlayHosts().length > 0;
  }

  hasRendererMode(mode: "desktop" | "browser", studyId?: string): boolean {
    return [...this.#renderers].some((connection) =>
      connection.scope.rendererMode === mode
      && (studyId === undefined || connection.scope.studyId === studyId));
  }

  async sendOverlayCommand(
    command: Record<string, unknown>,
    timeoutMs = 5_000,
  ): Promise<OverlayCommandDispatchResult> {
    const requestedHostId = typeof command.hostId === "string" ? command.hostId : null;
    const record = this.#resolveOverlayHost(requestedHostId);
    const candidate = {
      type: command.type,
      commandId: command.commandId ?? randomUUID(),
      hostId: record.hostId,
      issuedAt: command.issuedAt ?? new Date().toISOString(),
      ...(command.type === "overlay.window.open" || command.type === "overlay.window.update"
        ? { window: command.window }
        : command.type === "overlay.window.close"
          ? { instanceId: command.instanceId }
          : {}),
    };
    const parsed = OverlayHostCommandSchema.safeParse(candidate);
    if (!parsed.success) {
      this.#logger.warn({ issues: parsed.error.issues, type: command.type }, "Invalid overlay host command ignored");
      throw new OverlayCommandError(
        "INVALID_OVERLAY_COMMAND",
        "The overlay command payload is invalid.",
        { hostId: record.hostId },
      );
    }
    const socket = record.socket!;
    const sentAt = new Date().toISOString();
    return new Promise<OverlayCommandDispatchResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingOverlayCommands.delete(parsed.data.commandId);
        const error = new OverlayCommandError(
          "OVERLAY_COMMAND_TIMEOUT",
          `Desktop overlay host ${record.hostId} did not acknowledge the command before timeout.`,
          { hostId: record.hostId, commandId: parsed.data.commandId },
        );
        this.#logger.warn({ hostId: record.hostId, commandId: parsed.data.commandId, commandType: parsed.data.type }, "Overlay command timed out");
        reject(error);
      }, timeoutMs);
      this.#pendingOverlayCommands.set(parsed.data.commandId, {
        commandId: parsed.data.commandId,
        hostId: record.hostId,
        socket,
        sentAt,
        resolve,
        reject,
        timer,
      });
      try {
        socket.send(JSON.stringify(parsed.data));
        this.#logger.info({ hostId: record.hostId, commandId: parsed.data.commandId, commandType: parsed.data.type }, "Overlay command sent");
      } catch (error) {
        clearTimeout(timer);
        this.#pendingOverlayCommands.delete(parsed.data.commandId);
        reject(new OverlayCommandError(
          "OVERLAY_DISCONNECTED",
          error instanceof Error ? error.message : "The desktop overlay disconnected while sending the command.",
          { hostId: record.hostId, commandId: parsed.data.commandId },
        ));
      }
    });
  }

  #registerOverlayHost(connection: OverlayHostConnection, hostId: string): void {
    const now = new Date().toISOString();
    const existing = this.#overlayHosts.get(hostId);
    if (
      existing?.socket !== null
      && existing?.socket !== undefined
      && existing.socket !== connection.socket
    ) {
      this.#rejectPendingForSocket(
        existing.socket,
        "OVERLAY_DISCONNECTED",
        "The desktop overlay reconnected before acknowledging the command.",
      );
      existing.socket.close(1012, "Overlay host reconnected");
    }
    connection.hostId = hostId;
    this.#overlayHosts.set(hostId, {
      hostId,
      socket: connection.socket,
      connectedAt: now,
      disconnectedAt: null,
      lastSeenAt: now,
      status: existing?.status ?? null,
    });
    this.#refreshAutomaticOverlaySelection();
    this.#logger.info({ hostId, connectedAt: now }, "Desktop overlay host connected");
  }

  async #updateOverlayWindow(
    record: OverlayHostRecord,
    event: Extract<ReturnType<typeof OverlayHostEventSchema.parse>, { type: "overlay.window.changed" }>,
  ): Promise<void> {
    if (record.status === null) return;
    record.status = {
      ...record.status,
      occurredAt: event.occurredAt,
      windows: record.status.windows.map((window) => window.instanceId === event.instanceId
        ? {
            ...window,
            targetDisplay: event.targetDisplay,
            liveDisplay: event.targetDisplay,
            degraded: false,
            degradedReason: null,
            bounds: event.bounds,
          }
        : window),
    };
    try {
      const owner = await this.#pool.query<{ study_id: string }>(
        `SELECT c.study_id FROM widget_instances wi
          JOIN layouts l ON l.id=wi.layout_id
          JOIN conditions c ON c.id=l.condition_id
         WHERE wi.id=$1`,
        [event.instanceId],
      );
      const studyId = owner.rows[0]?.study_id;
      if (studyId !== undefined) this.broadcast("overlay.windows", event, studyId, null);
    } catch (error) {
      this.#logger.warn({ err: error, hostId: record.hostId, instanceId: event.instanceId }, "Overlay window change could not be published");
    }
  }

  async #publishOverlayWindowStatus(
    record: OverlayHostRecord,
    event: Extract<ReturnType<typeof OverlayHostEventSchema.parse>, { type: "overlay.status" }>,
  ): Promise<void> {
    const instanceIds = event.windows.map((window) => window.instanceId);
    if (instanceIds.length === 0) return;
    try {
      const owners = await this.#pool.query<{ instance_id: string; study_id: string }>(
        `SELECT wi.id AS instance_id,c.study_id
           FROM widget_instances wi
           JOIN layouts l ON l.id=wi.layout_id
           JOIN conditions c ON c.id=l.condition_id
          WHERE wi.id=ANY($1::uuid[])`,
        [instanceIds],
      );
      const studyByInstance = new Map(owners.rows.map((owner) => [owner.instance_id, owner.study_id]));
      for (const window of event.windows) {
        const studyId = studyByInstance.get(window.instanceId);
        if (studyId === undefined) continue;
        this.broadcast("overlay.windows", OverlayWindowStatusPayloadSchema.parse({
          type: "overlay.window.status",
          hostId: record.hostId,
          occurredAt: event.occurredAt,
          ...window,
        }), studyId, null);
      }
    } catch (error) {
      this.#logger.warn({ err: error, hostId: record.hostId }, "Overlay window status could not be published");
    }
  }

  #completeOverlayCommand(
    event: Extract<ReturnType<typeof OverlayHostEventSchema.parse>, { type: "overlay.command.result" }>,
  ): void {
    const pending = this.#pendingOverlayCommands.get(event.commandId);
    if (pending === undefined) {
      this.#logger.warn({ hostId: event.hostId, commandId: event.commandId }, "Unexpected overlay command result ignored");
      return;
    }
    if (pending.hostId !== event.hostId) {
      this.#logger.warn({ expectedHostId: pending.hostId, receivedHostId: event.hostId, commandId: event.commandId }, "Overlay command result host mismatch ignored");
      return;
    }
    clearTimeout(pending.timer);
    this.#pendingOverlayCommands.delete(event.commandId);
    if (!event.accepted) {
      pending.reject(new OverlayCommandError(
        "OVERLAY_COMMAND_REJECTED",
        event.error ?? `Desktop overlay host ${event.hostId} rejected the command.`,
        { hostId: event.hostId, commandId: event.commandId },
      ));
      return;
    }
    pending.resolve({
      commandId: event.commandId,
      hostId: event.hostId,
      accepted: true,
      error: null,
      sentAt: pending.sentAt,
      completedAt: event.occurredAt,
    });
  }

  #rejectPendingForSocket(
    socket: SocketLike,
    code: "OVERLAY_DISCONNECTED",
    message: string,
  ): void {
    for (const pending of this.#pendingOverlayCommands.values()) {
      if (pending.socket !== socket) continue;
      clearTimeout(pending.timer);
      this.#pendingOverlayCommands.delete(pending.commandId);
      pending.reject(new OverlayCommandError(code, message, {
        hostId: pending.hostId,
        commandId: pending.commandId,
      }));
    }
  }

  #connectedOverlayHosts(): OverlayHostRecord[] {
    return [...this.#overlayHosts.values()].filter(
      (record) => record.socket !== null && record.socket.readyState === 1,
    );
  }

  #refreshAutomaticOverlaySelection(): void {
    const connected = this.#connectedOverlayHosts();
    if (
      this.#overlaySelectionExplicit
      && this.#selectedOverlayHostId !== null
      && connected.some(({ hostId }) => hostId === this.#selectedOverlayHostId)
    ) return;
    this.#overlaySelectionExplicit = false;
    this.#selectedOverlayHostId = connected.length === 1 ? connected[0]!.hostId : null;
  }

  #resolveOverlayHost(requestedHostId: string | null): OverlayHostRecord {
    this.#refreshAutomaticOverlaySelection();
    if (requestedHostId !== null) {
      const requested = this.#overlayHosts.get(requestedHostId);
      if (requested === undefined || requested.socket === null || requested.socket.readyState !== 1) {
        throw new OverlayCommandError(
          "OVERLAY_HOST_NOT_CONNECTED",
          `Desktop overlay host ${requestedHostId} is not connected.`,
          { hostId: requestedHostId },
        );
      }
      this.#selectedOverlayHostId = requestedHostId;
      this.#overlaySelectionExplicit = true;
      return requested;
    }
    if (this.#selectedOverlayHostId !== null) {
      const selected = this.#overlayHosts.get(this.#selectedOverlayHostId);
      if (selected?.socket !== null && selected !== undefined && selected.socket.readyState === 1) return selected;
    }
    const connected = this.#connectedOverlayHosts();
    if (connected.length === 0) {
      throw new OverlayCommandError(
        "OVERLAY_UNAVAILABLE",
        "The desktop overlay is not connected.",
      );
    }
    throw new OverlayCommandError(
      "OVERLAY_HOST_SELECTION_REQUIRED",
      "Multiple desktop overlay hosts are connected. Select one before sending a command.",
    );
  }

  async broadcastEvent(message: MessageEnvelope): Promise<void> {
    const channel: WebSocketChannel = message.routingKey.includes(".lifecycle.")
      ? "session.lifecycle"
      : message.routingKey.endsWith(".telemetry")
        ? "session.telemetry"
        : message.routingKey.includes(".sensor.") ? "sensor.status" : "session.events";
    let data: unknown = message;
    if (
      channel === "session.lifecycle"
      && message.metadata.studyId !== null
      && message.metadata.sessionId !== null
    ) {
      const context = await this.#pool.query<{
        status: string;
        active_condition_id: string | null;
        active_condition_name: string | null;
        active_condition_sequence: number | null;
        condition_count: number;
        remaining_condition_count: number;
      }>(
        `SELECT se.status,
                active.id AS active_condition_id,active.condition_name AS active_condition_name,
                active.sequence AS active_condition_sequence,
                (SELECT COUNT(*)::int FROM session_conditions WHERE session_id=se.id) AS condition_count,
                (SELECT COUNT(*)::int FROM session_conditions WHERE session_id=se.id AND status='pending') AS remaining_condition_count
           FROM sessions se
           LEFT JOIN LATERAL (
             SELECT sc.id,c.name AS condition_name,sc.sequence
               FROM session_conditions sc JOIN conditions c ON c.id=sc.condition_id
              WHERE sc.session_id=se.id AND sc.status IN ('active','paused')
              ORDER BY sc.sequence LIMIT 1
           ) active ON TRUE
          WHERE se.id=$1`,
        [message.metadata.sessionId],
      );
      const commandId = message.metadata.correlationId;
      const command = commandId === null
        ? null
        : (await this.#pool.query<{
            action: string;
            status: string;
            error_message: string | null;
          }>(
            "SELECT action,status,error_message FROM lifecycle_commands WHERE id=$1",
            [commandId],
          )).rows[0] ?? null;
      const row = context.rows[0];
      data = {
        studyId: message.metadata.studyId,
        sessionId: message.metadata.sessionId,
        previousStatus: typeof message.payload.from === "string" ? message.payload.from : null,
        status: row?.status ?? message.payload.to,
        commandId,
        commandAction: command?.action ?? null,
        commandStatus: command?.status ?? null,
        commandError: command?.error_message ?? null,
        activeConditionId: row?.active_condition_id ?? null,
        activeConditionName: row?.active_condition_name ?? null,
        activeConditionSequence: row?.active_condition_sequence ?? null,
        conditionCount: row?.condition_count ?? 0,
        remainingConditionCount: row?.remaining_condition_count ?? 0,
      };
    }
    this.broadcast(channel, data, message.metadata.studyId, message.metadata.sessionId);
  }

  broadcast(channel: WebSocketChannel, data: unknown, studyId: string | null, sessionId: string | null): void {
    const serialized = JSON.stringify({ type: "data", channel, timestamp: new Date().toISOString(), data });
    for (const connection of this.#users) {
      const matches = connection.subscriptions.some((subscription) =>
        subscription.channel === channel &&
        (subscription.studyId === null || subscription.studyId === studyId) &&
        (subscription.sessionId === null || subscription.sessionId === sessionId));
      if (matches && connection.socket.readyState === 1) connection.socket.send(serialized);
    }
    this.#broadcastOverlayRuntime(channel, data, studyId, sessionId);
  }

  #broadcastOverlayRuntime(
    channel: WebSocketChannel,
    data: unknown,
    studyId: string | null,
    sessionId: string | null,
  ): void {
    for (const connection of this.#renderers) {
      if (
        connection.socket.readyState !== 1
        || connection.scope.studyId !== studyId
        || (connection.scope.sessionId !== null && connection.scope.sessionId !== sessionId)
      ) continue;
      if (channel === "session.lifecycle") {
        const lifecycle = readObject(data);
        const status = lifecycle.status;
        if (typeof status === "string") {
          connection.socket.send(JSON.stringify({ type: "overlay.runtime.session", status }));
          if (["completed", "aborted", "failed"].includes(status)) {
            for (const widget of connection.snapshot.widgets) {
              connection.socket.send(JSON.stringify({
                type: "overlay.runtime.state",
                instanceId: widget.instanceId,
                state: "hidden",
              }));
            }
            connection.socket.send(JSON.stringify({
              type: "overlay.runtime.close",
              reason: "session-terminal",
            }));
          } else if (
            lifecycle.commandAction === "advance"
            && typeof lifecycle.activeConditionId === "string"
            && connection.scope.conditionId !== lifecycle.activeConditionId
          ) {
            connection.socket.send(JSON.stringify({
              type: "overlay.runtime.close",
              reason: "condition-changed",
            }));
          }
        }
        continue;
      }
      if (channel === "session.telemetry" || channel === "sensor.status" || channel === "session.events") {
        const payload = normalizeBindingPayload(data);
        for (const widget of connection.snapshot.widgets) {
          const bindings: Record<string, unknown> = {};
          for (const binding of readBindings(widget.metadata)) {
            const configured = widget.bindingsConfig[binding] ?? binding;
            const value = safeGet(payload, String(configured));
            if (value !== undefined) bindings[binding] = value;
          }
          if (Object.keys(bindings).length > 0) {
            connection.socket.send(JSON.stringify({
              type: "overlay.runtime.bindings",
              instanceId: widget.instanceId,
              bindings,
            }));
          }
        }
        continue;
      }
      if (channel === "widget.updates") {
        const update = readObject(data);
        for (const widget of connection.snapshot.widgets) {
          if (!targetsWidget(update, widget.instanceId, widget.widgetKey)) continue;
          const state = normalizeRuntimeState(update.state ?? update.action);
          connection.socket.send(JSON.stringify({
            type: "overlay.runtime.trigger",
            instanceId: widget.instanceId,
            trigger: update,
          }));
          if (state !== null) {
            connection.socket.send(JSON.stringify({
              type: "overlay.runtime.state",
              instanceId: widget.instanceId,
              state,
            }));
          }
        }
      }
    }
  }

  async #handleUserMessage(connection: UserConnection, raw: string): Promise<void> {
    let requestId: string | null = null;
    try {
      const message = WebSocketClientMessageSchema.parse(JSON.parse(raw));
      requestId = message.requestId;
      const studyId = message.filters?.studyId ?? null;
      const sessionId = message.filters?.sessionId ?? null;
      if (message.channels.some((channel) => channel !== "system.health") && studyId === null) {
        throw new Error("A studyId filter is required for study data subscriptions");
      }
      if (studyId !== null && !connection.principal.roles.includes("admin")) {
        const access = await this.#pool.query(
          "SELECT 1 FROM study_users WHERE study_id=$1 AND user_id=$2", [studyId, connection.principal.id],
        );
        if (access.rowCount !== 1) throw new Error("Study access denied");
      }
      if (sessionId !== null) {
        const session = await this.#pool.query("SELECT 1 FROM sessions WHERE id=$1 AND study_id=$2", [sessionId, studyId]);
        if (session.rowCount !== 1) throw new Error("Session does not belong to the selected study");
      }
      for (const channel of message.channels) {
        const index = connection.subscriptions.findIndex((item) => item.channel === channel && item.studyId === studyId && item.sessionId === sessionId);
        if (message.type === "subscription.subscribe" && index === -1) connection.subscriptions.push({ channel, studyId, sessionId });
        if (message.type === "subscription.unsubscribe" && index !== -1) connection.subscriptions.splice(index, 1);
      }
      connection.socket.send(JSON.stringify({ type: "subscription.ack", requestId, action: message.type === "subscription.subscribe" ? "subscribe" : "unsubscribe", channels: message.channels }));
    } catch (error) {
      connection.socket.send(JSON.stringify({ type: "error", requestId, code: "INVALID_SUBSCRIPTION", message: error instanceof Error ? error.message : "Invalid subscription" }));
    }
  }
}

const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function readObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeGet(source: unknown, path: string): unknown {
  let value = source;
  for (const segment of path.split(".")) {
    if (!segment || FORBIDDEN_PATH_SEGMENTS.has(segment)) return undefined;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function safeSet(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  if (segments.some((segment) => !segment || FORBIDDEN_PATH_SEGMENTS.has(segment))) return;
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const current = cursor[segment];
    if (current === null || typeof current !== "object" || Array.isArray(current)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;
}

function normalizeBindingPayload(data: unknown): Record<string, unknown> {
  const original = readObject(data);
  const envelopePayload = readObject(original.payload);
  const payload = Object.keys(envelopePayload).length > 0 ? envelopePayload : original;
  const normalized = structuredClone(payload);
  const vehicle = readObject(payload.vehicle);
  const speed = Number(vehicle.speed ?? payload.speed);
  const speedLimit = Number(vehicle.speedLimit ?? vehicle.speed_limit ?? payload.speedLimit);
  if (Number.isFinite(speed)) safeSet(normalized, "vehicle.speed", speed);
  if (Number.isFinite(speedLimit)) {
    safeSet(normalized, "vehicle.speed_limit", speedLimit);
    safeSet(normalized, "vehicle.speedLimit", speedLimit);
  }
  if (Number.isFinite(speed) && Number.isFinite(speedLimit) && speedLimit > 0) {
    const ratio = Math.max(0, Math.min(1.15, speed / speedLimit));
    safeSet(normalized, "vehicle.speed_ratio", Math.round(ratio * 100));
    safeSet(normalized, "vehicle.speed_arc_offset", Number((188.5 * (1 - Math.min(1, ratio))).toFixed(1)));
    safeSet(normalized, "vehicle.speed_unit", "km/h");
  }
  const heartRate = payload.heartRateBpm ?? payload.bpm;
  if (heartRate !== undefined) {
    safeSet(normalized, "vitals.heart_rate", heartRate);
    safeSet(normalized, "vitals.unit", "bpm");
  }
  const spo2 = payload.spo2 ?? payload.spo2Percent;
  if (spo2 !== undefined) {
    safeSet(normalized, "vitals.spo2", spo2);
    safeSet(normalized, "vitals.spo2_unit", "%");
  }
  return normalized;
}

function readBindings(metadata: Record<string, unknown>): string[] {
  const bindings = metadata.bindings;
  return Array.isArray(bindings)
    ? bindings.flatMap((binding) => {
        const key = readObject(binding).key;
        return typeof key === "string" ? [key] : [];
      })
    : [];
}

function targetsWidget(update: Record<string, unknown>, instanceId: string, widgetKey: string): boolean {
  const selectors = [
    update.instanceId !== undefined,
    update.widgetId !== undefined,
    Array.isArray(update.instanceIds),
    Array.isArray(update.widgetIds),
  ];
  if (!selectors.some(Boolean)) return true;
  return (update.instanceId !== undefined && String(update.instanceId) === instanceId)
    || (update.widgetId !== undefined && String(update.widgetId) === widgetKey)
    || (Array.isArray(update.instanceIds) && update.instanceIds.map(String).includes(instanceId))
    || (Array.isArray(update.widgetIds) && update.widgetIds.map(String).includes(widgetKey));
}

function normalizeRuntimeState(value: unknown): "visible" | "hidden" | "highlighted" | null {
  if (value === "show" || value === "reset" || value === "visible") return "visible";
  if (value === "hide" || value === "hidden") return "hidden";
  if (value === "highlight" || value === "highlighted") return "highlighted";
  return null;
}
