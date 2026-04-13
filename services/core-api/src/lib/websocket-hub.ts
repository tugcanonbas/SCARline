import { websocketChannelSchema, type WebSocketChannel } from '@scarline/contracts';

interface SocketLike {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  send: (payload: string) => void;
}

interface ClientState {
  socket: SocketLike;
  channels: Set<WebSocketChannel>;
  userId: string;
  filters: {
    studyId: string | null;
    sessionId: string | null;
  };
}

export class WebSocketHub {
  private readonly clients = new Set<ClientState>();

  register(socket: SocketLike, userId: string): ClientState {
    const state: ClientState = {
      socket,
      channels: new Set(),
      userId,
      filters: {
        studyId: null,
        sessionId: null
      }
    };

    this.clients.add(state);
    socket.on('close', () => {
      this.clients.delete(state);
    });

    return state;
  }

  updateSubscriptions(
    client: ClientState,
    action: 'subscribe' | 'unsubscribe',
    channels: string[],
    filters?: {
      studyId?: string;
      sessionId?: string;
    }
  ): void {
    const parsed = websocketChannelSchema.array().parse(channels);
    client.filters.studyId = filters?.studyId ?? null;
    client.filters.sessionId = filters?.sessionId ?? null;
    if (action === 'subscribe') {
      parsed.forEach((channel) => client.channels.add(channel));
      return;
    }

    parsed.forEach((channel) => client.channels.delete(channel));
  }

  private passesFilter(client: ClientState, channel: WebSocketChannel, data: Record<string, unknown>): boolean {
    if (channel === 'system.health' || channel === 'export.progress' || channel === 'sensor.status') {
      return true;
    }

    const messageStudyId = typeof data.studyId === 'string'
      ? data.studyId
      : typeof data.study_id === 'string'
        ? data.study_id
        : null;
    const messageSessionId = typeof data.sessionId === 'string'
      ? data.sessionId
      : typeof data.runId === 'string'
        ? data.runId
        : typeof data.session_id === 'string'
          ? data.session_id
          : null;

    if (client.filters.studyId && client.filters.studyId !== messageStudyId) {
      return false;
    }
    if (client.filters.sessionId && client.filters.sessionId !== messageSessionId) {
      return false;
    }

    return true;
  }

  broadcast(channel: WebSocketChannel, data: Record<string, unknown>): void {
    const payload = JSON.stringify({
      type: 'event',
      channel,
      data
    });

    for (const client of this.clients) {
      if (client.channels.has(channel) && this.passesFilter(client, channel, data)) {
        client.socket.send(payload);
      }
    }
  }
}
