import { writable, type Writable } from 'svelte/store';

type SocketState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
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
  let currentToken: string | null = null;
  let currentChannels: string[] = [];
  let currentFilters: { studyId?: string; sessionId?: string } = {};
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let intentionalClose = false;

  function connect(
    token: string | null,
    channels: string[],
    filters: {
      studyId?: string;
      sessionId?: string;
    } = {}
  ) {
    currentToken = token;
    currentChannels = channels;
    currentFilters = filters;
    intentionalClose = false;

    if (!token || socket) {
      return;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    socketState.set(reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    const base = (globalThis.location?.origin ?? '').replace(/^http/, 'ws');
    socket = new WebSocket(`${base}/ws?token=${encodeURIComponent(token)}`);

    socket.onopen = () => {
      reconnectAttempts = 0;
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
      socket = null;
      if (intentionalClose || !currentToken) {
        socketState.set('closed');
        return;
      }

      reconnectAttempts += 1;
      socketState.set('reconnecting');
      const delay = Math.min(1_000 * 2 ** (reconnectAttempts - 1), 15_000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect(currentToken, currentChannels, currentFilters);
      }, delay);
    };
  }

  function disconnect() {
    intentionalClose = true;
    currentToken = null;
    currentChannels = [];
    currentFilters = {};
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
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
