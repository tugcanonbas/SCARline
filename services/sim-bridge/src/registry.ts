import { randomUUID } from "node:crypto";

import type {
  AdapterRegisterMessage,
  SimulatorSessionConfiguration,
  SimulatorType,
} from "@scarline/contracts";
import type { WebSocket } from "ws";

export interface RegisteredAdapter {
  readonly assignedId: string;
  readonly adapterId: string;
  name: string;
  simulatorType: SimulatorType;
  simulatorVersion: string;
  capabilities: string[];
  priority: number;
  status: "ready" | "busy" | "degraded";
  socket: WebSocket | null;
  readonly registeredAt: string;
  lastHeartbeatAt: string;
  activeConfiguration: SimulatorSessionConfiguration | null;
  lastTelemetryAt: number;
}

export interface AdapterSummary {
  readonly assignedId: string;
  readonly adapterId: string;
  readonly name: string;
  readonly simulatorType: SimulatorType;
  readonly simulatorVersion: string;
  readonly capabilities: readonly string[];
  readonly priority: number;
  readonly status: string;
  readonly connected: boolean;
  readonly activeSessionId: string | null;
  readonly lastHeartbeatAt: string;
}

export class AdapterRegistry {
  readonly #adapters = new Map<string, RegisteredAdapter>();

  register(
    registration: AdapterRegisterMessage,
    socket: WebSocket,
    recoveredConfiguration?: SimulatorSessionConfiguration,
  ): RegisteredAdapter {
    if (
      registration.activeSessionId !== null
      && recoveredConfiguration?.sessionId !== registration.activeSessionId
    ) {
      throw new Error("Adapter reported an active session that the bridge cannot recover safely.");
    }
    const existing = [...this.#adapters.values()].find(
      (adapter) => adapter.adapterId === registration.adapterId,
    );
    if (existing !== undefined) {
      existing.socket?.close(1012, "Adapter reconnected");
      existing.name = registration.name;
      existing.simulatorType = registration.simulatorType;
      existing.simulatorVersion = registration.simulatorVersion;
      existing.capabilities = [...new Set(registration.capabilities)].sort();
      existing.priority = registration.priority;
      existing.status = registration.activeSessionId === null ? "ready" : "busy";
      existing.socket = socket;
      existing.lastHeartbeatAt = new Date().toISOString();
      existing.activeConfiguration = recoveredConfiguration ?? null;
      return existing;
    }
    const adapter: RegisteredAdapter = {
      assignedId: randomUUID(),
      adapterId: registration.adapterId,
      name: registration.name,
      simulatorType: registration.simulatorType,
      simulatorVersion: registration.simulatorVersion,
      capabilities: [...new Set(registration.capabilities)].sort(),
      priority: registration.priority,
      status: registration.activeSessionId === null ? "ready" : "busy",
      socket,
      registeredAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      activeConfiguration: recoveredConfiguration ?? null,
      lastTelemetryAt: 0,
    };
    this.#adapters.set(adapter.assignedId, adapter);
    return adapter;
  }

  get(assignedId: string): RegisteredAdapter | undefined {
    return this.#adapters.get(assignedId);
  }

  getByAdapterId(adapterId: string): RegisteredAdapter | undefined {
    return [...this.#adapters.values()].find((adapter) => adapter.adapterId === adapterId);
  }

  available(simulatorType: SimulatorType): RegisteredAdapter | undefined {
    return [...this.#adapters.values()]
      .filter((adapter) =>
        adapter.simulatorType === simulatorType
        && adapter.socket !== null
        && adapter.status === "ready"
        && adapter.activeConfiguration === null,
      )
      .sort((left, right) =>
        left.priority - right.priority
        || left.registeredAt.localeCompare(right.registeredAt)
        || left.adapterId.localeCompare(right.adapterId),
      )[0];
  }

  forSession(sessionId: string): RegisteredAdapter | undefined {
    return [...this.#adapters.values()].find(
      (adapter) => adapter.activeConfiguration?.sessionId === sessionId,
    );
  }

  heartbeat(
    assignedId: string,
    status: "ready" | "busy" | "degraded",
    activeSessionId: string | null,
  ): void {
    const adapter = this.#adapters.get(assignedId);
    if (adapter === undefined) throw new Error("Unknown simulator adapter.");
    const expected = adapter.activeConfiguration?.sessionId ?? null;
    if (activeSessionId !== expected) {
      throw new Error("Adapter heartbeat session does not match the bridge binding.");
    }
    adapter.lastHeartbeatAt = new Date().toISOString();
    adapter.status = status;
  }

  bind(assignedId: string, configuration: SimulatorSessionConfiguration): void {
    const adapter = this.#adapters.get(assignedId);
    if (adapter === undefined) throw new Error("Unknown simulator adapter.");
    adapter.activeConfiguration = configuration;
    adapter.status = "busy";
  }

  unbind(assignedId: string): void {
    const adapter = this.#adapters.get(assignedId);
    if (adapter === undefined) return;
    adapter.activeConfiguration = null;
    adapter.status = adapter.socket === null ? "degraded" : "ready";
  }

  disconnect(assignedId: string, socket: WebSocket): RegisteredAdapter | undefined {
    const adapter = this.#adapters.get(assignedId);
    if (adapter === undefined || adapter.socket !== socket) return undefined;
    adapter.socket = null;
    adapter.status = "degraded";
    return adapter;
  }

  remove(assignedId: string): RegisteredAdapter | undefined {
    const adapter = this.#adapters.get(assignedId);
    if (adapter !== undefined) this.#adapters.delete(assignedId);
    return adapter;
  }

  stale(staleMilliseconds: number, now = Date.now()): RegisteredAdapter[] {
    return [...this.#adapters.values()].filter(
      (adapter) => adapter.socket !== null
        && now - Date.parse(adapter.lastHeartbeatAt) > staleMilliseconds,
    );
  }

  adapterTypes(): SimulatorType[] {
    return [...new Set(
      [...this.#adapters.values()]
        .filter((adapter) => adapter.socket !== null && adapter.status !== "degraded")
        .map((adapter) => adapter.simulatorType),
    )].sort();
  }

  summaries(): AdapterSummary[] {
    return [...this.#adapters.values()]
      .map((adapter) => ({
        assignedId: adapter.assignedId,
        adapterId: adapter.adapterId,
        name: adapter.name,
        simulatorType: adapter.simulatorType,
        simulatorVersion: adapter.simulatorVersion,
        capabilities: adapter.capabilities,
        priority: adapter.priority,
        status: adapter.status,
        connected: adapter.socket !== null,
        activeSessionId: adapter.activeConfiguration?.sessionId ?? null,
        lastHeartbeatAt: adapter.lastHeartbeatAt,
      }))
      .sort((left, right) => left.adapterId.localeCompare(right.adapterId));
  }

  closeAll(): void {
    for (const adapter of this.#adapters.values()) {
      adapter.socket?.close(1001, "Sim Bridge is shutting down");
      adapter.socket = null;
      adapter.status = "degraded";
    }
  }
}
