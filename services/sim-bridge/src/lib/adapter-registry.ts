export interface AdapterSocket {
  send: (message: string) => void;
}

export interface AdapterState {
  assignedId: string;
  adapterId: string;
  simulatorType: string;
  simulatorVersion: string;
  capabilities: string[];
  status: string;
  socket: AdapterSocket;
  lastHeartbeatAt: string;
  activeSessionId: string | null;
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, AdapterState>();

  register(adapter: AdapterState): void {
    this.adapters.set(adapter.assignedId, adapter);
  }

  remove(assignedId: string): void {
    this.adapters.delete(assignedId);
  }

  updateHeartbeat(assignedId: string): void {
    const adapter = this.adapters.get(assignedId);
    if (!adapter) {
      return;
    }

    adapter.lastHeartbeatAt = new Date().toISOString();
  }

  bindSession(assignedId: string, sessionId: string): void {
    this.clearSession(sessionId);

    const adapter = this.adapters.get(assignedId);
    if (!adapter) {
      return;
    }

    adapter.activeSessionId = sessionId;
  }

  clearSession(sessionId: string): void {
    for (const adapter of this.adapters.values()) {
      if (adapter.activeSessionId === sessionId) {
        adapter.activeSessionId = null;
      }
    }
  }

  resolveForSession(sessionId: string): AdapterState | null {
    for (const adapter of this.adapters.values()) {
      if (adapter.activeSessionId === sessionId) {
        return adapter;
      }
    }

    return null;
  }

  resolveAvailable(): AdapterState | null {
    for (const adapter of this.adapters.values()) {
      if (adapter.simulatorType === 'carla' && adapter.activeSessionId === null) {
        return adapter;
      }
    }

    for (const adapter of this.adapters.values()) {
      if (adapter.activeSessionId === null) {
        return adapter;
      }
    }

    return null;
  }

  list(): Omit<AdapterState, 'socket'>[] {
    return Array.from(this.adapters.values()).map(({ socket: _socket, ...rest }) => rest);
  }
}
