import { writable, type Writable } from 'svelte/store';

type SocketState = 'idle' | 'connecting' | 'open' | 'closed';
type TelemetryPayload = Record<string, unknown>;
type EventPayload = Record<string, unknown>;
type WidgetPayload = Record<string, unknown>;

export function createRealtimeStore() {
  const telemetry = writable<TelemetryPayload>({});
  const events = writable<EventPayload[]>([]);
  const widgets = writable<WidgetPayload[]>([]);
  const socketState = writable<SocketState>('idle');

  let socket: WebSocket | null = null;

  function connect(token: string | null, channels: string[]) {
    if (!token || socket) {
      return;
    }

    socketState.set('connecting');
    const base = (globalThis.location?.origin ?? '').replace(/^http/, 'ws');
    socket = new WebSocket(`${base}/ws?token=${encodeURIComponent(token)}`);

    socket.onopen = () => {
      socketState.set('open');
      socket?.send(JSON.stringify({ action: 'subscribe', channels }));
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as {
        channel?: string;
        data?: Record<string, unknown>;
      };

      if (message.channel === 'session.telemetry') {
        telemetry.set(message.data ?? {});
      } else if (message.channel === 'session.events') {
        pushMessage(events, message.data);
      } else if (message.channel === 'widget.updates') {
        pushMessage(widgets, message.data);
      }
    };

    socket.onclose = () => {
      socketState.set('closed');
      socket = null;
    };
  }

  function disconnect() {
    socket?.close();
    socket = null;
    socketState.set('closed');
  }

  return {
    telemetry,
    events,
    widgets,
    socketState,
    connect,
    disconnect
  };
}

function pushMessage(store: Writable<Record<string, unknown>[]>, payload: Record<string, unknown> | undefined) {
  if (!payload) {
    return;
  }

  store.update((current) => [payload, ...current].slice(0, 20));
}
