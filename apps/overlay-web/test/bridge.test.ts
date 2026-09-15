import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

async function createBridge() {
  const source = await readFile(new URL("../dist/bridge.js", import.meta.url), "utf8");
  const sent: Array<{ type: string; action?: string }> = [];
  let receive: (event: unknown) => void = () => undefined;
  const parent = { postMessage: (message: typeof sent[number]) => sent.push(message) };
  const timers: Array<() => void> = [];
  const window = { addEventListener: (_type: string, listener: typeof receive) => { receive = listener; },
    setInterval: (listener: () => void) => { timers.push(listener); return timers.length; }, clearInterval: () => {} };
  runInNewContext(source.replace(/^export \{\};?$/gm, ""), {
    window, parent, document: { documentElement: { style: { setProperty() {} } } },
  });
  const api = (window as unknown as {
    SCARline: {
      getBinding(key: string): unknown;
      getState(): string;
      getMetadata(): Record<string, unknown>;
      onBinding(key: string, listener: (value: unknown) => void): void;
      onTrigger(listener: () => void): void;
      onStateChange(listener: (state: string) => void): void;
      send(action: string): void;
    };
  }).SCARline;
  return {
    api, sent, tick: () => timers.forEach((timer) => timer()),
    send: (data: Record<string, unknown>) => receive({ source: parent, data: { channel: "scarline.host.v1", ...data } }),
  };
}

test("compact live sample arrays restore chart history and retain it when disconnected", async () => {
  const { api, send } = await createBridge();
  const timestamp = Date.now();
  const points = [{ timestamp: timestamp - 2, value: -.2 }, { timestamp, value: .7 }];
  send({ type: "connection", connected: true });
  send({ type: "bindings", bindings: { "vitals.ecg_samples": points }, bindingData: {
    "vitals.ecg_samples": { source: "live", status: "receiving", timestamp, staleAfterMs: 2000 },
  } });
  assert.equal(api.getBinding("vitals.ecg_samples"), points);
  assert.equal((api.getMetadata().bindingData as any)["vitals.ecg_samples"].history, points);
  send({ type: "connection", connected: false });
  assert.equal(api.getBinding("vitals.ecg_samples"), null);
  assert.equal((api.getMetadata().bindingData as any)["vitals.ecg_samples"].status, "disconnected");
  assert.equal((api.getMetadata().bindingData as any)["vitals.ecg_samples"].history, points);
});

test("manual trigger callbacks and binding callbacks see the complete new state", async () => {
  const { api, send } = await createBridge();
  send({ type: "bindings", bindings: { title: "Initial", playing: false } });
  api.onBinding("title", (value) => {
    assert.equal(value, "Updated");
    assert.equal(api.getBinding("playing"), true);
    assert.equal(api.getState(), "highlighted");
  });
  let triggered = false;
  api.onTrigger(() => {
    triggered = true;
    assert.equal(api.getBinding("title"), "Updated");
    assert.equal(api.getState(), "highlighted");
  });
  send({ type: "trigger", trigger: {
    action: "update", state: "highlighted", bindingValues: { title: "Updated", playing: true },
  } });
  assert.equal(triggered, true);
});

test("reset clears bindings without defaults and preserves condition-provided values and visibility", async () => {
  const { api, send } = await createBridge();
  send({ type: "trigger", trigger: { action: "show", bindingValues: { title: "Manual", speed: 88 } } });
  const removed: unknown[] = [];
  api.onBinding("title", (value) => removed.push(value));
  send({ type: "trigger", trigger: { action: "reset", state: "hidden", bindingValues: { speed: 17 } } });
  assert.deepEqual(removed, [undefined]);
  assert.equal(api.getBinding("title"), undefined);
  assert.equal(api.getBinding("speed"), 17);
  assert.equal(api.getState(), "hidden");
  // A reset without visibility must not guess that a condition-hidden widget is visible.
  send({ type: "trigger", trigger: { payload: { action: "reset", bindingValues: {} } } });
  assert.equal(api.getBinding("speed"), undefined);
  assert.equal(api.getState(), "hidden");
});

test("hidden renderer state blocks interactions until explicitly shown", async () => {
  const { api, sent, send } = await createBridge();
  const notified: string[] = [];
  api.onStateChange((state) => {
    notified.push(state);
    assert.equal(state, api.getState());
  });
  api.send("call.add");
  send({ type: "state", state: "hidden" });
  api.send("call.add");
  send({ type: "state", state: "invalid" });
  api.send("call.add");
  assert.equal(sent.length, 1);
  send({ type: "trigger", trigger: { action: "show" } });
  api.send("call.add");
  assert.deepEqual(notified, ["hidden", "visible"]);
  assert.equal(sent.length, 2);
});

test("sensor silence expires values locally while reconnecting never makes an old sample fresh", async () => {
  const { api, send, tick } = await createBridge();
  const detail = { source: "live", status: "receiving", timestamp: Date.now() - 10_000,
    staleAfterMs: 5_000, sourceKey: "monitor", path: "vitals.heart_rate", receivedAt: Date.now() };
  send({ type: "metadata", metadata: { bindingData: {} } });
  send({ type: "bindings", bindings: { "vitals.heart_rate": 88 }, bindingData: { "vitals.heart_rate": detail } });
  tick();
  assert.equal(api.getBinding("vitals.heart_rate"), null);
  assert.equal((api.getMetadata().bindingData as Record<string, { status: string }>)["vitals.heart_rate"]?.status, "stale");
  send({ type: "connection", connected: true });
  assert.equal(api.getBinding("vitals.heart_rate"), null);
  send({ type: "bindings", bindings: { "vitals.heart_rate": 89 }, bindingData: { "vitals.heart_rate": { ...detail, timestamp: Date.now() } } });
  assert.equal(api.getBinding("vitals.heart_rate"), 89);
  send({ type: "connection", connected: false });
  assert.equal(api.getBinding("vitals.heart_rate"), null);
});

test("late interaction responses cannot undo a newer researcher reset", async () => {
  const { api, send } = await createBridge();
  send({ type: "trigger", trigger: { action: "update", bindingValues: { playing: true }, revision: 1 } });
  send({ type: "trigger", trigger: { action: "reset", state: "hidden", bindingValues: {}, revision: 2 } });
  send({ type: "trigger", trigger: { action: "update", state: "visible", bindingValues: { playing: true }, revision: 1 } });
  assert.equal(api.getBinding("playing"), undefined);
  assert.equal(api.getState(), "hidden");
  send({ type: "trigger", trigger: { action: "update", replaceBindings: true, bindingValues: { title: "Restored" }, revision: 3 } });
  assert.equal(api.getBinding("playing"), undefined);
  assert.equal(api.getBinding("title"), "Restored");
  send({ type: "bindings", revision: 2, bindings: { title: "Delayed sample" } });
  assert.equal(api.getBinding("title"), "Restored");
});
