import { websocketChannelSchema, type WebSocketChannel } from '@scarline/contracts';

interface SocketLike {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  send: (payload: string) => void;
}

interface ClientState {
  socket: SocketLike;
  channels: Set<WebSocketChannel>;
  userId: string;
}

export class WebSocketHub {
  private readonly clients = new Set<ClientState>();

  register(socket: SocketLike, userId: string): ClientState {
    const state: ClientState = {
      socket,
      channels: new Set(),
      userId
    };

    this.clients.add(state);
    socket.on('close', () => {
      this.clients.delete(state);
    });

    return state;
  }

  updateSubscriptions(client: ClientState, action: 'subscribe' | 'unsubscribe', channels: string[]): void {
    const parsed = websocketChannelSchema.array().parse(channels);
    if (action === 'subscribe') {
      parsed.forEach((channel) => client.channels.add(channel));
      return;
    }

    parsed.forEach((channel) => client.channels.delete(channel));
  }

  broadcast(channel: WebSocketChannel, data: Record<string, unknown>): void {
    const payload = JSON.stringify({
      type: 'event',
      channel,
      data
    });

    for (const client of this.clients) {
      if (client.channels.has(channel)) {
        client.socket.send(payload);
      }
    }
  }
}
