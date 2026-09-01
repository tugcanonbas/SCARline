type Listener<T> = (value: T) => void;

const bindings = new Map<string, unknown>();
const bindingListeners = new Map<string, Set<Listener<unknown>>>();
const triggerListeners = new Set<Listener<Record<string, unknown>>>();
const stateListeners = new Set<Listener<string>>();
let state = "visible";
let metadata: Record<string, unknown> = {};

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
    for (const [key, value] of Object.entries(event.data.bindings)) {
      bindings.set(key, value);
      for (const listener of bindingListeners.get(key) ?? []) listener(value);
    }
  } else if (event.data.type === "trigger" && isRecord(event.data.trigger)) {
    for (const listener of triggerListeners) listener(event.data.trigger);
  } else if (event.data.type === "state" && typeof event.data.state === "string") {
    state = event.data.state;
    for (const listener of stateListeners) listener(state);
  } else if (event.data.type === "metadata" && isRecord(event.data.metadata)) {
    metadata = event.data.metadata;
  } else if (event.data.type === "styles" && isRecord(event.data.styles)) {
    for (const [key, value] of Object.entries(event.data.styles)) {
      if (key.startsWith("--") && (typeof value === "string" || typeof value === "number")) {
        document.documentElement.style.setProperty(key, String(value));
      }
    }
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

declare global {
  interface Window { SCARline: typeof SCARline }
}

export {};
