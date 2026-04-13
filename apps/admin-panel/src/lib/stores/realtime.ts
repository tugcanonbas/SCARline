import { writable, type Writable } from 'svelte/store';

type SocketState = 'idle' | 'connecting' | 'open' | 'closed';
type TelemetryPayload = Record<string, unknown>;
type EventPayload = Record<string, unknown>;
type WidgetPayload = Record<string, unknown>;

export function createRealtimeStore() {
  const telemetry = writable<Record<string, TelemetryPayload>>({});
  const events = writable<EventPayload[]>([]);
  const widgets = writable<WidgetPayload[]>([]);
  const systemHealth = writable<Record<string, unknown>[]>([]);
  const sensorStatus = writable<Record<string, unknown>[]>([]);
  const socketState = writable<SocketState>('idle');

  let socket: WebSocket | null = null;

  function connect(
    token: string | null,
    channels: string[],
    filters: {
      studyId?: string;
      sessionId?: string;
    } = {}
  ) {
    if (!token || socket) {
      return;
    }

    socketState.set('connecting');
    const base = (globalThis.location?.origin ?? '').replace(/^http/, 'ws');
    socket = new WebSocket(`${base}/ws?token=${encodeURIComponent(token)}`);

    socket.onopen = () => {
      socketState.set('open');
      socket?.send(JSON.stringify({ action: 'subscribe', channels, filters }));
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as {
        channel?: string;
        data?: Record<string, unknown>;
      };

      if (message.channel === 'session.telemetry') {
        mergeTelemetry(telemetry, message.data ?? {});
      } else if (message.channel === 'session.events') {
        pushMessage(events, message.data);
      } else if (message.channel === 'widget.updates') {
        pushMessage(widgets, message.data);
      } else if (message.channel === 'system.health') {
        pushMessage(systemHealth, message.data);
      } else if (message.channel === 'sensor.status') {
        pushMessage(sensorStatus, message.data);
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
    systemHealth,
    sensorStatus,
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

function mergeTelemetry(
  store: Writable<Record<string, Record<string, unknown>>>,
  payload: Record<string, unknown> | undefined
) {
  if (!payload) {
    return;
  }

  const studyId = String(payload.studyId ?? payload.study_id ?? 'global');
  const sessionId = String(payload.sessionId ?? payload.runId ?? payload.session_id ?? 'global');
  const modality = String(payload.modality ?? payload.eventType ?? payload.routingKey ?? 'telemetry');
  const key = `${studyId}:${sessionId}:${modality}`;

  store.update((current) => ({
    ...current,
    [key]: payload,
    __latest: payload
  }));
}
