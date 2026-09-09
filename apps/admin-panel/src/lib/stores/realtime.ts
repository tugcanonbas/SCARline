import { writable, type Writable } from 'svelte/store';

import { appPath } from '$lib/paths';

type SocketState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
type TelemetryPayload = Record<string, unknown>;
type EventPayload = Record<string, unknown>;
type WidgetPayload = Record<string, unknown>;

export function createRealtimeStore() {
  const telemetry = writable<Record<string, TelemetryPayload>>({});
  const events = writable<EventPayload[]>([]);
  const lifecycle = writable<EventPayload[]>([]);
  const widgets = writable<WidgetPayload[]>([]);
  const overlayWindows = writable<EventPayload[]>([]);
  const systemHealth = writable<Record<string, unknown>[]>([]);
  const sensorStatus = writable<Record<string, unknown>[]>([]);
  const socketState = writable<SocketState>('idle');

  let socket: WebSocket | null = null;
  let currentChannels: string[] = [];
  let currentFilters: { studyId?: string; sessionId?: string } = {};
  let currentOrigin: string | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let intentionalClose = false;
  let ticketRequestInFlight = false;
  let connectionVersion = 0;

  function connect(
    channels: string[],
    filters: {
      studyId?: string;
      sessionId?: string;
    } = {},
    webSocketOrigin?: string
  ) {
    currentChannels = channels;
    currentFilters = filters;
    currentOrigin = webSocketOrigin;
    intentionalClose = false;

    if (socket || ticketRequestInFlight) {
      return;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    void openSocket();
  }

  async function openSocket() {
    if (intentionalClose || socket || ticketRequestInFlight) return;
    const version = ++connectionVersion;
    ticketRequestInFlight = true;
    socketState.set(reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      const ticket = await requestRealtimeTicket();
      if (intentionalClose || version !== connectionVersion) return;
      const base = currentOrigin ?? (globalThis.location?.origin ?? '').replace(/^http/, 'ws');
      const opened = new WebSocket(`${base.replace(/\/$/, '')}/ws`, [`scarline.user-ticket.${ticket}`]);
      socket = opened;

      opened.onopen = () => {
        if (socket !== opened) return;
        reconnectAttempts = 0;
        socketState.set('open');
        opened.send(JSON.stringify({
          type: 'subscription.subscribe',
          requestId: crypto.randomUUID(),
          channels: currentChannels,
          filters: currentFilters
        }));
      };

      opened.onmessage = (event) => {
        let message: {
          channel?: string;
          data?: Record<string, unknown>;
        };
        try {
          message = JSON.parse(event.data) as typeof message;
        } catch {
          return;
        }

        if (message.channel === 'session.telemetry') {
          mergeTelemetry(telemetry, message.data ?? {});
        } else if (message.channel === 'session.lifecycle') {
          pushMessage(lifecycle, message.data);
        } else if (message.channel === 'session.events') {
          pushMessage(events, message.data);
        } else if (message.channel === 'widget.updates') {
          pushMessage(widgets, message.data);
        } else if (message.channel === 'overlay.windows') {
          pushMessage(overlayWindows, message.data);
        } else if (message.channel === 'system.health') {
          pushMessage(systemHealth, message.data);
        } else if (message.channel === 'sensor.status') {
          pushMessage(sensorStatus, message.data);
        }
      };

      opened.onclose = () => {
        if (socket !== opened) return;
        socket = null;
        scheduleReconnect();
      };
    } catch {
      if (!intentionalClose && version === connectionVersion) scheduleReconnect();
    } finally {
      ticketRequestInFlight = false;
    }
  }

  function scheduleReconnect() {
    if (intentionalClose) {
      socketState.set('closed');
      return;
    }
    reconnectAttempts += 1;
    socketState.set('reconnecting');
    const delay = Math.min(1_000 * 2 ** (reconnectAttempts - 1), 15_000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void openSocket();
    }, delay);
  }

  function disconnect() {
    intentionalClose = true;
    connectionVersion += 1;
    currentChannels = [];
    currentFilters = {};
    currentOrigin = undefined;
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
    lifecycle,
    widgets,
    overlayWindows,
    systemHealth,
    sensorStatus,
    socketState,
    connect,
    disconnect
  };
}

async function requestRealtimeTicket(): Promise<string> {
  const response = await fetch(appPath('/api/realtime/ticket'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    credentials: 'same-origin'
  });
  const payload = await response.json().catch(() => null);
  const token = payload?.data?.token;
  if (!response.ok || typeof token !== 'string' || token.length === 0) {
    throw new Error('Failed to authorize realtime connection');
  }
  return token;
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
  const sessionId = String(payload.sessionId ?? payload.session_id ?? 'global');
  const modality = String(payload.modality ?? payload.eventType ?? payload.routingKey ?? 'telemetry');
  const key = `${studyId}:${sessionId}:${modality}`;

  store.update((current) => ({
    ...current,
    [key]: payload,
    __latest: payload
  }));
}
