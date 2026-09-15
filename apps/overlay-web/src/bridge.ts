type Listener<T> = (value: T) => void;

const bindings = new Map<string, unknown>();
const bindingListeners = new Map<string, Set<Listener<unknown>>>();
const triggerListeners = new Set<Listener<Record<string, unknown>>>();
const stateListeners = new Set<Listener<string>>();
let state = "visible";
let revision = -1;
let metadata: Record<string, unknown> = {};
let playbackTimer: number | undefined;
let dataConnected = true;

const SCARline = Object.freeze({
  ready(): void {
    parent.postMessage({ channel: "scarline.widget.v1", type: "ready" }, "*");
  },
  getBinding(key: string): unknown {
    return bindings.get(key);
  },
  getState(): string {
    return state;
  },
  getMetadata(): Record<string, unknown> {
    return metadata;
  },
  onBinding(key: string, listener: Listener<unknown>): () => void {
    const listeners = bindingListeners.get(key) ?? new Set<Listener<unknown>>();
    listeners.add(listener);
    bindingListeners.set(key, listeners);
    return () => listeners.delete(listener);
  },
  onTrigger(listener: Listener<Record<string, unknown>>): () => void {
    triggerListeners.add(listener);
    return () => triggerListeners.delete(listener);
  },
  onStateChange(listener: Listener<string>): () => void {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  },
  send(action: string, payload: Record<string, unknown> = {}): void {
    if (state === "hidden") return;
    parent.postMessage({ channel: "scarline.widget.v1", type: "action", action, payload }, "*");
  },
});

Object.defineProperty(window, "SCARline", { value: SCARline, writable: false, configurable: false });

const blocked = () => Promise.reject(new Error("Widget network access is disabled."));
Object.defineProperty(window, "fetch", { value: blocked, writable: false });
Object.defineProperty(window, "XMLHttpRequest", { value: class BlockedXMLHttpRequest { constructor() { throw new Error("Widget network access is disabled."); } }, writable: false });
Object.defineProperty(window, "WebSocket", { value: class BlockedWebSocket { constructor() { throw new Error("Widget network access is disabled."); } }, writable: false });
Object.defineProperty(window, "EventSource", { value: class BlockedEventSource { constructor() { throw new Error("Widget network access is disabled."); } }, writable: false });

window.addEventListener("message", (event) => {
  if (event.source !== parent || !isRecord(event.data) || event.data.channel !== "scarline.host.v1") return;
  if (event.data.type === "bindings" && isRecord(event.data.bindings)) {
    if (typeof event.data.revision === "number") {
      if (event.data.revision < revision) return;
      revision = event.data.revision;
    }
    updateBindings(event.data.bindings, false, event.data.bindingData);
  } else if (event.data.type === "trigger" && isRecord(event.data.trigger)) {
    const trigger = event.data.trigger;
    if (typeof trigger.revision === "number") {
      if (trigger.revision < revision) return;
      revision = trigger.revision;
    }
    const payload = isRecord(trigger.payload) ? trigger.payload : {};
    const values = trigger.bindingValues ?? payload.bindingValues;
    const action = trigger.action ?? payload.action;
    const nextState = trigger.state ?? payload.state
      ?? (action === "hide" ? "hidden" : action === "highlight" ? "highlighted" : action === "show" ? "visible" : undefined);
    if (isVisualState(nextState)) state = nextState;
    updateBindings(isRecord(values) ? values : {}, action === "reset" || trigger.replaceBindings === true, trigger.bindingData);
    // Listeners must see the same complete binding/state snapshot as getBinding/getState.
    for (const listener of triggerListeners) listener(trigger);
    if (isVisualState(nextState)) for (const listener of stateListeners) listener(state);
  } else if (event.data.type === "state" && isVisualState(event.data.state)) {
    state = event.data.state;
    for (const listener of stateListeners) listener(state);
  } else if (event.data.type === "metadata" && isRecord(event.data.metadata)) {
    metadata = event.data.metadata;
  } else if (event.data.type === "connection") {
    dataConnected = event.data.connected === true;
    refreshDataStatus();
  } else if (event.data.type === "styles" && isRecord(event.data.styles)) {
    for (const [key, value] of Object.entries(event.data.styles)) {
      if (key.startsWith("--") && (typeof value === "string" || typeof value === "number")) {
        document.documentElement.style.setProperty(key, String(value));
      }
    }
  }
});

function updateBindings(values: Record<string, unknown>, replace = false, details?: unknown): void {
  if (isRecord(details)) {
    const restored = Object.fromEntries(Object.entries(details).map(([key, detail]) => [key,
      isRecord(detail) && detail.source === "live" && detail.status === "receiving"
        && !Array.isArray(detail.history) && Array.isArray(values[key])
        ? { ...detail, history: values[key] } : detail]));
    metadata.bindingData = { ...(replace ? {} : isRecord(metadata.bindingData) ? metadata.bindingData : {}), ...restored };
  }
  const changed = new Set([...Object.keys(values), ...(replace ? bindings.keys() : [])]);
  if (replace) bindings.clear();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) bindings.delete(key);
    else bindings.set(key, value);
  }
  for (const key of changed) {
    for (const listener of bindingListeners.get(key) ?? []) listener(bindings.get(key));
  }
  refreshDataStatus();
  if (playbackTimer !== undefined) window.clearInterval(playbackTimer);
  playbackTimer = undefined;
  if (bindings.get("media.is_playing") === true && Number(bindings.get("media.playback_started_at")) > 0) {
    refreshPlayback();
    if (bindings.get("media.is_playing") === true) playbackTimer = window.setInterval(refreshPlayback, 250);
  }
}

function refreshDataStatus(): void {
  const details = isRecord(metadata.bindingData) ? metadata.bindingData : {};
  let changed = false;
  for (const [key, input] of Object.entries(details)) {
    if (!isRecord(input) || input.source !== "live" || input.status === "disconnected") continue;
    const expired = typeof input.timestamp === "number" && typeof input.staleAfterMs === "number"
      && Date.now() - input.timestamp > input.staleAfterMs;
    if (!dataConnected || (input.status === "receiving" && expired)) {
      details[key] = { ...input, status: dataConnected ? "stale" : "disconnected" };
      bindings.set(key, null);
      for (const listener of bindingListeners.get(key) ?? []) listener(null);
      changed = true;
    }
  }
  if (changed) for (const listener of triggerListeners) listener({ dataStatusChanged: true });
}
window.setInterval(refreshDataStatus, 500);

function refreshPlayback(): void {
  const base = bindings.get("media.position_seconds");
  const duration = bindings.get("media.duration_seconds");
  const startedAt = bindings.get("media.playback_started_at");
  if (typeof base !== "number" || typeof duration !== "number" || typeof startedAt !== "number"
    || !Number.isFinite(base) || !Number.isFinite(duration) || !Number.isFinite(startedAt) || duration < 0 || base < 0) return;
  const position = Math.min(duration, base + Math.max(0, Date.now() - startedAt) / 1_000);
  const whole = Math.floor(position);
  const values = { "media.progress_ratio": duration > 0 ? position / duration * 100 : 0,
    "media.progress_label": `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`,
    "media.is_playing": position < duration };
  for (const [key, value] of Object.entries(values)) {
    if (bindings.get(key) === value) continue;
    bindings.set(key, value);
    for (const listener of bindingListeners.get(key) ?? []) listener(value);
  }
  if (position >= duration && playbackTimer !== undefined) {
    window.clearInterval(playbackTimer);
    playbackTimer = undefined;
  }
}

function isVisualState(value: unknown): value is "visible" | "hidden" | "highlighted" {
  return value === "visible" || value === "hidden" || value === "highlighted";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

declare global {
  interface Window { SCARline: typeof SCARline }
}

export {};
