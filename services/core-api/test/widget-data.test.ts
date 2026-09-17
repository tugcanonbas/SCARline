import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Pool } from "pg";
import type { FastifyBaseLogger } from "fastify";
import { RealtimeHub } from "../src/realtime/hub.js";
import { configuredWidgetRuntime } from "../src/overlay/widget-runtime-state.js";
import { projectWidgetData, receiveWidgetData } from "../src/overlay/live-data.js";
import { loadOverlayRuntimeSnapshot } from "../src/overlay/runtime.js";
import { applyManualWidgetRuntimeCommand } from "../src/overlay/runtime-control.js";
import { InteractionDatabase, ids, scope } from "./fixtures/widget-interactions.js";

const now = Date.parse("2026-09-13T10:00:00Z");
function metadata(key: string) { return JSON.parse(readFileSync(new URL(`../../../widgets/components/${key}/widget.json`, import.meta.url), "utf8")); }
function project(pool: Pool, key = "hr", at = now, bindingsConfig: Record<string, unknown> = {}, condition = {}) {
  const configured = configuredWidgetRuntime(metadata(key), condition, ids.call, key);
  return projectWidgetData(pool, { ...configured, studyId: ids.study, sessionId: ids.session,
    sessionConditionId: ids.sessionCondition, bindingsConfig }, at);
}
function batch(key: string, samples: Record<string, unknown>[], extra = {}) {
  return { timestamp: new Date(now).toISOString(), producer: "io-client", payload: {
    sessionConditionId: ids.sessionCondition, deviceId: ids.call, sensorId: ids.music,
    sourceKey: "driver:heart_rate", channelKey: key, sequenceStart: 0, sampleRate: 1,
    sourceTimestamp: new Date(now - (samples.length - 1) * 1000).toISOString(),
    droppedSamples: 0, samples, ...extra,
  } };
}

test("live health and driving defaults never contain example measurements, while previews do", () => {
  for (const key of ["hr", "ecg", "bp", "spo2", "resp", "speedometer", "sensor-health"]) {
    const live = configuredWidgetRuntime(metadata(key), {}, ids.call, key);
    const preview = configuredWidgetRuntime(metadata(key), {}, ids.call, key, true);
    for (const binding of live.metadata.bindings.filter((binding) => binding.source === "live")) {
      assert.equal(live.bindings[binding.key], null, `${key}/${binding.key}`);
      if (binding.preview !== undefined) assert.deepEqual(preview.bindings[binding.key], binding.preview);
    }
  }
});

test("I/O batches yield actual heart-rate history, timestamps and observed min/max", () => {
  const pool = {} as Pool;
  receiveWidgetData(pool, batch("heart_rate", [{ heartRateBpm: 67 }, { heartRateBpm: 89 }, { heartRateBpm: 74 }]), ids.study, ids.session, now);
  const result = project(pool);
  assert.equal(result.bindings["vitals.heart_rate"], 74);
  assert.equal(result.bindings["vitals.heart_rate_min"], 67);
  assert.equal(result.bindings["vitals.heart_rate_max"], 89);
  assert.deepEqual(result.bindingData["vitals.heart_rate"]?.history, [
    { timestamp: now - 2000, value: 67 }, { timestamp: now - 1000, value: 89 }, { timestamp: now, value: 74 },
  ]);
  assert.equal(result.bindingData["vitals.heart_rate"]?.sourceKey, "driver:heart_rate / heart_rate");
});

test("duplicate, late and foreign-condition batches cannot duplicate or replace a reading", () => {
  const pool = {} as Pool;
  const input = batch("heart_rate", [{ heartRateBpm: 74 }]);
  receiveWidgetData(pool, input, ids.study, ids.session, now);
  receiveWidgetData(pool, input, ids.study, ids.session, now + 1);
  receiveWidgetData(pool, batch("heart_rate", [{ heartRateBpm: 180 }], { sessionConditionId: ids.condition }), ids.study, ids.session, now);
  receiveWidgetData(pool, { timestamp: new Date(now - 1000).toISOString(), heartRateBpm: 300 }, ids.study, ids.preview, now);
  assert.deepEqual(project(pool).bindingData["vitals.heart_rate"]?.history, [{ timestamp: now, value: 74 }]);
});

test("stale and disconnected values clear without a fake zero or preview fallback", () => {
  const pool = {} as Pool;
  receiveWidgetData(pool, batch("heart_rate", [{ heartRateBpm: 74 }]), ids.study, ids.session, now);
  assert.equal(project(pool, "hr", now + 5001).bindings["vitals.heart_rate"], null);
  assert.equal(project(pool, "hr", now + 5001).bindingData["vitals.heart_rate"]?.status, "stale");
  receiveWidgetData(pool, { timestamp: new Date(now + 1).toISOString(), payload: { sourceKey: "driver:heart_rate", status: "disconnected" } }, null, null, now + 1);
  assert.equal(project(pool, "hr", now + 2).bindingData["vitals.heart_rate"]?.status, "disconnected");
});

test("null, strings, non-finite readings and invalid timestamps never become measurements", () => {
  for (const value of [null, "88", NaN, Infinity]) {
    const pool = {} as Pool;
    receiveWidgetData(pool, { timestamp: new Date(now).toISOString(), payload: { heartRateBpm: value } }, ids.study, ids.session, now);
    assert.equal(project(pool).bindings["vitals.heart_rate"], null);
  }
  const pool = {} as Pool;
  receiveWidgetData(pool, { timestamp: "invalid", payload: { heartRateBpm: 88 } }, ids.study, ids.session, now);
  assert.equal(project(pool).bindings["vitals.heart_rate"], null);
});

test("ECG requires ECG samples, uses their rate, and never synthesizes a trace from BPM", () => {
  const pool = {} as Pool;
  receiveWidgetData(pool, batch("heart_rate", [{ heartRateBpm: 74 }]), ids.study, ids.session, now);
  assert.equal(project(pool, "ecg").bindings["vitals.ecg_samples"], null);
  receiveWidgetData(pool, batch("ecg", [{ ecgSamples: [0.3, -1, 2, 0], sampleRate: 100 }], { sourceKey: "driver:ecg" }), ids.study, ids.session, now);
  assert.deepEqual(project(pool, "ecg").bindings["vitals.ecg_samples"], [
    { timestamp: now - 30, value: .3 }, { timestamp: now - 20, value: -1 }, { timestamp: now - 10, value: 2 }, { timestamp: now, value: 0 },
  ]);
  assert.equal(project(pool, "ecg").bindings["vitals.ecg_status"], null);
});

test("irregular sample timestamps and dropped sample gaps are retained", () => {
  const pool = {} as Pool;
  receiveWidgetData(pool, batch("heart_rate", [{ heartRateBpm: 71 }, { heartRateBpm: 73 }], {
    sampleTimestamps: [new Date(now - 4700).toISOString(), new Date(now).toISOString()],
  }), ids.study, ids.session, now);
  receiveWidgetData(pool, batch("heart_rate", [{ heartRateBpm: 72 }], {
    sequenceStart: 5, sourceTimestamp: new Date(now + 200).toISOString(),
  }), ids.study, ids.session, now + 200);
  assert.deepEqual(project(pool, "hr", now + 200).bindingData["vitals.heart_rate"]?.history?.map((point) => point.value), [71, 73, null, 72]);
});

test("ambiguous sensors require an explicit source mapping instead of mixing measurements", () => {
  const pool = {} as Pool;
  receiveWidgetData(pool, batch("heart_rate", [{ heartRateBpm: 74 }]), ids.study, ids.session, now);
  receiveWidgetData(pool, batch("heart_rate", [{ heartRateBpm: 91 }], { sourceKey: "second-monitor" }), ids.study, ids.session, now);
  assert.equal(project(pool).bindingData["vitals.heart_rate"]?.status, "ambiguous");
  assert.equal(project(pool).bindings["vitals.heart_rate"], null);
  const selected = project(pool, "hr", now, { "vitals.heart_rate": { path: "vitals.heart_rate", sourceKey: "second-monitor" } });
  assert.equal(selected.bindings["vitals.heart_rate"], 91);
});

test("speed gauge derives from actual speed and limit, including zero and missing limits", () => {
  const pool = {} as Pool;
  receiveWidgetData(pool, { timestamp: new Date(now).toISOString(), payload: { speed: 50, speedLimit: 100 } }, ids.study, ids.session, now);
  assert.equal(project(pool, "speedometer").bindings["vehicle.speed_arc_offset"], 94.25);
  receiveWidgetData(pool, { timestamp: new Date(now + 1).toISOString(), payload: { speed: 0, speedLimit: null } }, ids.study, ids.session, now + 1);
  const result = project(pool, "speedometer", now + 1);
  assert.equal(result.bindings["vehicle.speed"], 0);
  assert.equal(result.bindings["vehicle.speed_arc_offset"], null);
});

test("sensor health describes only observed channels and expires silent streams", () => {
  const pool = {} as Pool;
  assert.equal(project(pool, "sensor-health").bindings["sensor.streaming_label"], "Waiting for sensor samples");
  receiveWidgetData(pool, batch("heart_rate", [{ heartRateBpm: 74 }]), ids.study, ids.session, now);
  assert.equal(project(pool, "sensor-health").bindings["sensor.streaming_label"], "1/1 observed channels streaming");
  assert.equal(project(pool, "sensor-health", now + 5001).bindings["sensor.streaming_label"], "0/1 observed channels streaming");
});

test("all mock health channels retain distinct values, histories and simulated provenance", () => {
  const pool = {} as Pool;
  const channels = {
    heart_rate: [{ heartRateBpm: 68 }, { heartRateBpm: 83 }],
    blood_pressure: [{ systolic: 118, diastolic: 76 }, { systolic: 124, diastolic: 81 }],
    spo2: [{ spo2Percent: 96 }, { spo2Percent: 99 }],
    respiration: [{ respirationRateRpm: 14 }, { respirationRateRpm: 19 }],
    eye_tracking: [{ gaze: { x: .4, y: .5 } }, { gaze: { x: .6, y: .5 } }],
    ecg: [{ value: -.2 }, { value: .7 }],
    steering: [{ steer: .1, throttle: .4, brake: 0 }, { steer: -.1, throttle: .4, brake: 0 }],
  };
  for (const [channel, samples] of Object.entries(channels)) receiveWidgetData(pool,
    batch(channel, samples, { sourceKey: "driver:mock" }), ids.study, ids.session, now);
  const expected: Record<string, Record<string, number>> = {
    hr: { "vitals.heart_rate": 83 }, bp: { "vitals.blood_pressure_systolic": 124, "vitals.blood_pressure_diastolic": 81 },
    spo2: { "vitals.spo2": 99 }, resp: { "vitals.respiration_rate": 19 },
    ecg: { "vitals.heart_rate": 83, "vitals.blood_pressure_systolic": 124, "vitals.blood_pressure_diastolic": 81,
      "vitals.spo2": 99, "vitals.respiration_rate": 19 },
  };
  for (const [widget, values] of Object.entries(expected)) {
    const result = project(pool, widget);
    for (const [key, value] of Object.entries(values)) {
      assert.equal(result.bindings[key], value, `${widget}/${key}`);
      assert.equal(result.bindingData[key]?.status, "receiving");
      assert.equal(result.bindingData[key]?.simulated, true);
      assert.equal(result.bindingData[key]?.history?.length, 2);
    }
  }
  const health = project(pool, "sensor-health");
  assert.equal(health.bindings["sensor.streaming_label"], "7/7 observed channels streaming");
  assert.match(String(health.bindings["sensor.summary_3"]), /eye tracking/);
  assert.match(String(health.bindings["sensor.summary_3"]), /steering/);
});

test("reload restores timestamped data; researcher overrides win until reset without returning examples", async () => {
  const db = new InteractionDatabase();
  db.widgets[0]!.widget_key = "hr"; db.widgets[0]!.metadata = metadata("hr");
  const at = Date.now();
  receiveWidgetData(db.pool, batch("heart_rate", [{ heartRateBpm: 76 }], { sourceTimestamp: new Date(at).toISOString() }), ids.study, ids.session, at);
  assert.equal((await loadOverlayRuntimeSnapshot(db.pool, scope)).widgets[0]?.bindings["vitals.heart_rate"], 76);
  await applyManualWidgetRuntimeCommand(db.pool, ids.session, { instanceId: ids.call, action: "update", bindingValues: { "vitals.heart_rate": 55 } }, ids.study);
  const manual = (await loadOverlayRuntimeSnapshot(db.pool, scope)).widgets[0]!;
  assert.equal(manual.bindings["vitals.heart_rate"], 55);
  assert.equal(manual.bindingData["vitals.heart_rate"]?.source, "study");
  const reset = await applyManualWidgetRuntimeCommand(db.pool, ids.session, { instanceId: ids.call, action: "reset", bindingValues: {} }, ids.study);
  assert.equal(reset.bindingValues["vitals.heart_rate"], 76);
});

test("sensor bursts preserve every ECG sample while bounding renderer deliveries and retaining freshness", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval", "Date"], now });
  const db = new InteractionDatabase();
  db.widgets[0]!.widget_key = "ecg";
  db.widgets[0]!.metadata = metadata("ecg");
  db.widgets[1]!.widget_key = "hr";
  db.widgets[1]!.metadata = metadata("hr");
  const hub = new RealtimeHub(db.pool, { warn() {} } as unknown as FastifyBaseLogger);
  const deliveries: Array<any> = [];
  await hub.attachRenderer({ readyState: 1, on() {}, close() {}, send(raw) { deliveries.push(JSON.parse(raw)); } }, scope);
  deliveries.length = 0;
  for (let index = 0; index < 20; index++) {
    hub.broadcast("session.events", batch("ecg", Array.from({ length: 50 }, (_, i) => ({ value: index * 50 + i })), {
      sourceKey: "driver:mock", sampleRate: 500, sequenceStart: index * 50,
      sourceTimestamp: new Date(now - 2000 + index * 100).toISOString(),
    }), ids.study, ids.session);
  }
  hub.broadcast("session.events", batch("heart_rate", [{ heartRateBpm: 83 }]), ids.study, ids.session);
  assert.equal(deliveries.length, 0, "sensor ingestion must not synchronously resend full histories per batch");
  context.mock.timers.tick(100);
  assert.equal(deliveries.length, 2, "one current update per widget delivers the entire burst");
  const ecg = deliveries.find((entry) => entry.instanceId === ids.call);
  assert.equal(ecg.bindings["vitals.ecg_samples"].length, 1000);
  assert.deepEqual(ecg.bindings["vitals.ecg_samples"].map((point: any) => point.value), Array.from({ length: 1000 }, (_, i) => i));
  assert.equal(ecg.bindings["vitals.heart_rate"], 83);
  assert.equal(ecg.bindingData["vitals.ecg_samples"].status, "receiving");

  hub.broadcast("widget.updates", { instanceId: ids.call, action: "update", revision: 2,
    bindingValues: { "vitals.heart_rate": 55 }, source: "admin-panel" }, ids.study, ids.session);
  assert.equal(deliveries.at(-1).type, "overlay.runtime.trigger", "manual updates remain immediate");
  context.mock.timers.tick(1000);
  assert.equal(deliveries.findLast((entry) => entry.instanceId === ids.call).bindings["vitals.heart_rate"], 55);
  assert.equal(deliveries.at(-2).revision, 2);
  context.mock.timers.tick(1000);
  const expired = deliveries.findLast((entry) => entry.instanceId === ids.call);
  assert.equal(expired.bindings["vitals.ecg_samples"], null);
  assert.equal(expired.bindingData["vitals.ecg_samples"].status, "stale");
  assert.equal(expired.bindingData["vitals.ecg_samples"].history.length, 1000);
  hub.broadcast("session.lifecycle", { status: "completed" }, ids.study, ids.session);
  const finalCount = deliveries.length;
  context.mock.timers.tick(2000);
  assert.equal(deliveries.length, finalCount, "completed renderers receive no later sensor projection");
});

test("bounded histories do not mutate previously projected chart snapshots", () => {
  const pool = {} as Pool;
  receiveWidgetData(pool, batch("ecg", Array.from({ length: 4096 }, (_, i) => ({ value: i })), {
    sampleRate: 500, sourceTimestamp: new Date(now - 8190).toISOString(),
  }), ids.study, ids.session, now);
  const before = project(pool, "ecg");
  receiveWidgetData(pool, batch("ecg", [{ value: 4096 }], {
    sampleRate: 500, sequenceStart: 4096, sourceTimestamp: new Date(now + 2).toISOString(),
  }), ids.study, ids.session, now + 2);
  const after = project(pool, "ecg", now + 2);
  assert.equal(before.bindingData["vitals.ecg_samples"]?.history?.length, 4096);
  assert.equal(before.bindingData["vitals.ecg_samples"]?.history?.[0]?.value, 0);
  assert.equal(after.bindingData["vitals.ecg_samples"]?.history?.length, 4096);
  assert.equal(after.bindingData["vitals.ecg_samples"]?.history?.[0]?.value, 1);
});

test("layout launchers receive lifecycle closure without any widget data traffic", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval", "Date"], now });
  const db = new InteractionDatabase();
  db.widgets[0]!.widget_key = "ecg";
  db.widgets[0]!.metadata = metadata("ecg");
  const hub = new RealtimeHub(db.pool, { warn() {} } as unknown as FastifyBaseLogger);
  const deliveries: Array<any> = [];
  await hub.attachRenderer({ readyState: 1, on() {}, close() {}, send(raw) { deliveries.push(JSON.parse(raw)); } }, scope, true);
  assert.deepEqual(deliveries.map((entry) => entry.type), ["overlay.runtime.ready"]);
  deliveries.length = 0;
  hub.broadcast("session.events", batch("ecg", [{ value: .2 }]), ids.study, ids.session);
  context.mock.timers.tick(1000);
  assert.equal(deliveries.length, 0);
  hub.broadcast("session.lifecycle", { status: "completed" }, ids.study, ids.session);
  assert.deepEqual(deliveries.map((entry) => entry.type), ["overlay.runtime.session", "overlay.runtime.close"]);
});
