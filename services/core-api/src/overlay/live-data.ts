import { IoSensorBatchPayloadSchema, type WidgetBindingData, type WidgetMetadata } from "@scarline/contracts";
import type { Pool } from "pg";

type Point = { timestamp: number; value: number | null };
type Signal = { value: unknown; timestamp: number; receivedAt: number; history: Point[] };
type Stream = { sourceKey: string; channel: string; conditionId: string | null; connected: boolean; simulated: boolean;
  sequence: number; signals: Map<string, Signal>; receivedAt: number };
type SessionData = { streams: Map<string, Stream>; touchedAt: number };
const stores = new WeakMap<Pool, Map<string, SessionData>>();
const devices = new WeakMap<Pool, Map<string, { connected: boolean; timestamp: number }>>();
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const HISTORY_MS = 60_000;
const MAX_POINTS = 4_096;

function store(pool: Pool): Map<string, SessionData> {
  let value = stores.get(pool);
  if (!value) { value = new Map(); stores.set(pool, value); }
  return value;
}

export function clearLiveWidgetData(pool: Pool, studyId: string, sessionId: string): void {
  store(pool).delete(`${studyId}:${sessionId}`);
}

/** Cache received samples before renderer fanout. No generated measurements or database writes. */
export function receiveWidgetData(pool: Pool, data: unknown, studyId: string | null,
  sessionId: string | null, receivedAt = Date.now()): void {
  const envelope = record(data);
  const payload = Object.hasOwn(envelope, "payload") ? record(envelope.payload) : envelope;
  const timestamp = time(payload.sourceTimestamp ?? envelope.timestamp, receivedAt);
  if (timestamp === null) return;
  if (typeof payload.sourceKey === "string" && typeof payload.status === "string" && !Array.isArray(payload.samples)) {
    let statuses = devices.get(pool);
    if (!statuses) { statuses = new Map(); devices.set(pool, statuses); }
    if ((statuses.get(payload.sourceKey)?.timestamp ?? -Infinity) <= timestamp) {
      statuses.set(payload.sourceKey, { connected: payload.status === "connected", timestamp });
      if (statuses.size > 256) statuses.delete(statuses.keys().next().value!);
    }
  }
  if (studyId === null || sessionId === null) return;
  const sessions = store(pool);
  for (const [key, value] of sessions) if (receivedAt - value.touchedAt > 10 * 60_000) sessions.delete(key);
  const key = `${studyId}:${sessionId}`;
  let session = sessions.get(key);
  if (!session) {
    session = { streams: new Map(), touchedAt: receivedAt };
    sessions.set(key, session);
    if (sessions.size > 32) sessions.delete(sessions.keys().next().value!);
  }
  session.touchedAt = receivedAt;
  const source = record(record(envelope.metadata).source);
  const sourceKey = String(payload.sourceKey ?? source.instanceId ?? source.component ?? envelope.producer ?? "Event source");
  const conditionId = typeof payload.sessionConditionId === "string" ? payload.sessionConditionId : null;
  const channel = String(payload.channelKey ?? envelope.routingKey ?? "telemetry");
  const streamKey = `${conditionId ?? ""}:${sourceKey}:${channel}`;
  let stream = session.streams.get(streamKey);
  if (!stream) {
    stream = { sourceKey, channel, conditionId, connected: true, simulated: sourceKey === "driver:mock",
      sequence: -1, signals: new Map(), receivedAt };
    session.streams.set(streamKey, stream);
    if (session.streams.size > 64) session.streams.delete(session.streams.keys().next().value!);
  }
  if (Array.isArray(payload.samples)) {
    const batch = IoSensorBatchPayloadSchema.safeParse(payload);
    if (!batch.success) return;
    const value = batch.data;
    // A redelivered or overlapping batch must not duplicate or rewind the plot.
    for (let i = 0; i < value.samples.length; i++) {
      if (value.sequenceStart + i <= stream.sequence) continue;
      const sampleTime = value.sampleTimestamps?.[i] ? Date.parse(value.sampleTimestamps[i]!) : timestamp + i * 1_000 / value.sampleRate;
      ingest(stream, value.samples[i]!, sampleTime, receivedAt,
        value.channelKey, i === 0 && (value.droppedSamples > 0 || (stream.sequence >= 0 && value.sequenceStart > stream.sequence + 1)));
    }
    stream.sequence = Math.max(stream.sequence, value.sequenceStart + value.samples.length - 1);
  } else {
    ingest(stream, payload, timestamp, receivedAt, channel, false);
  }
}

function ingest(stream: Stream, payload: Record<string, unknown>, timestamp: number, receivedAt: number,
  channel: string, gap: boolean): void {
  if (timestamp > receivedAt + 5_000) return;
  const latest = Math.max(...[...stream.signals.values()].map((item) => item.timestamp), -Infinity);
  if (timestamp < latest) return;
  if (typeof payload.connected === "boolean") stream.connected = payload.connected;
  if (payload.simulated === true) stream.simulated = true;
  stream.receivedAt = receivedAt;
  const values = new Map<string, unknown>();
  flatten(payload, "", values);
  alias(values, payload, "vitals.heart_rate", ["heartRateBpm", "bpm"]);
  alias(values, payload, "vitals.spo2", ["spo2", "spo2Percent"]);
  alias(values, payload, "vitals.respiration_rate", ["respirationRate", "respirationRateRpm"]);
  alias(values, payload, "vitals.blood_pressure_systolic", ["systolic", "bloodPressureSystolic"]);
  alias(values, payload, "vitals.blood_pressure_diastolic", ["diastolic", "bloodPressureDiastolic"]);
  alias(values, payload, "vehicle.speed", ["speed"]);
  alias(values, payload, "vehicle.speed_limit", ["speedLimit", "speed_limit"]);
  if (values.has("vehicle.speedLimit")) values.set("vehicle.speed_limit", values.get("vehicle.speedLimit"));
  // SiFi packets contain samples at their own rate, independent of the I/O batch polling rate.
  if (Array.isArray(payload.ecgSamples) && finite(payload.sampleRate) && payload.sampleRate > 0) {
    const samples = payload.ecgSamples.slice(-MAX_POINTS);
    const start = timestamp - (samples.length - 1) * 1_000 / payload.sampleRate;
    samples.forEach((value, index) => append(stream, "vitals.ecg_samples", value,
      start + index * 1_000 / Number(payload.sampleRate), receivedAt, gap || Number(payload.dataLostCount) > 0,
      index === 0));
  } else if (channel === "ecg" && Object.hasOwn(payload, "value")) {
    append(stream, "vitals.ecg_samples", payload.value, timestamp, receivedAt, gap, true);
  }
  for (const [path, value] of values) {
    if (path === "vitals.ecg_samples" && Array.isArray(value)) {
      for (const point of value.slice(-MAX_POINTS)) {
        const sample = record(point);
        if (finite(sample.timestamp)) append(stream, path, finite(sample.value) ? sample.value : null,
          sample.timestamp, receivedAt, false, false);
      }
    } else append(stream, path, value, timestamp, receivedAt, gap, true);
  }
}

function append(stream: Stream, path: string, value: unknown, timestamp: number, receivedAt: number,
  gap: boolean, first: boolean): void {
  if (!Number.isFinite(timestamp) || timestamp > receivedAt + 5_000) return;
  const previous = stream.signals.get(path);
  if (previous && timestamp <= previous.timestamp) return;
  if (!previous && stream.signals.size >= 128) return;
  const history = previous?.history ?? [];
  if (gap && first && history.length) history.push({ timestamp: timestamp - 0.001, value: null });
  if (typeof value === "number" || value === null || previous?.history.length) {
    history.push({ timestamp, value: finite(value) ? value : null });
  }
  let expired = Math.max(0, history.length - MAX_POINTS);
  while (expired < history.length && history[expired]!.timestamp < timestamp - HISTORY_MS) expired++;
  if (expired) history.splice(0, expired);
  stream.signals.set(path, { value, timestamp, receivedAt, history });
}

export function projectWidgetData(pool: Pool, input: {
  studyId: string; sessionId: string | null; sessionConditionId: string | null;
  metadata: WidgetMetadata; bindingsConfig: Record<string, unknown>;
  bindings: Record<string, unknown>; bindingData: Record<string, WidgetBindingData>;
}, now = Date.now()): { bindings: Record<string, unknown>; bindingData: Record<string, WidgetBindingData> } {
  const bindings = { ...input.bindings };
  // Projection replaces live details and never mutates history points. Copying
  // thousands of unused snapshot points on every delivery stalls ingestion.
  const bindingData = Object.fromEntries(Object.entries(input.bindingData).map(([key, detail]) =>
    [key, { ...detail, ...(detail.history ? { history: detail.history.slice() } : {}) }]));
  if (input.sessionId === null) return { bindings, bindingData };
  const streams = [...(store(pool).get(`${input.studyId}:${input.sessionId}`)?.streams.values() ?? [])]
    .filter((stream) => stream.conditionId === null || stream.conditionId === input.sessionConditionId);
  for (const declaration of input.metadata.bindings) {
    const key = declaration.key;
    const prior = bindingData[key];
    if (prior?.source !== "live") continue;
    const raw = input.bindingsConfig[key];
    const config = record(raw);
    const path = typeof raw === "string" ? raw : typeof config.path === "string" ? config.path : key;
    const matches = streams.filter((stream) => stream.signals.has(path)
      && (typeof config.sourceKey !== "string" || stream.sourceKey === config.sourceKey));
    const sources = new Set(matches.map((stream) => stream.sourceKey));
    const stream = matches.sort((a, b) => b.signals.get(path)!.timestamp - a.signals.get(path)!.timestamp)[0];
    const signal = stream?.signals.get(path);
    const detail: WidgetBindingData = { ...prior, path, history: [], timestamp: null, receivedAt: null,
      sourceKey: typeof config.sourceKey === "string" ? config.sourceKey : null, status: "waiting" };
    bindings[key] = null;
    if (sources.size > 1) {
      detail.status = "ambiguous";
      detail.sourceKey = [...sources].join(", ");
    } else if (stream && signal) {
      detail.sourceKey = `${stream.sourceKey} / ${stream.channel}`;
      detail.simulated = stream.simulated;
      detail.timestamp = signal.timestamp;
      detail.receivedAt = signal.receivedAt;
      const device = devices.get(pool)?.get(stream.sourceKey);
      const disconnected = !stream.connected || (device && !device.connected && device.timestamp >= signal.timestamp);
      detail.status = disconnected ? "disconnected" : now - signal.timestamp > detail.staleAfterMs ? "stale" : "receiving";
      detail.history = signal.history.filter((point) => point.timestamp >= now - HISTORY_MS);
      const valid = declaration.type === "array" ? Array.isArray(signal.value) || key === "vitals.ecg_samples"
        : declaration.type === "number" ? finite(signal.value) : typeof signal.value === declaration.type;
      if (!valid && !disconnected) detail.status = "waiting";
      if (detail.status === "receiving") bindings[key] = key === "vitals.ecg_samples" ? detail.history : signal.value;
    }
    bindingData[key] = detail;
  }
  derive(bindings, bindingData, "vitals.heart_rate_min", ["vitals.heart_rate"], () => {
    const values = bindingData["vitals.heart_rate"]?.history?.flatMap((p) => p.value === null ? [] : [p.value]) ?? [];
    return values.length ? Math.min(...values) : null;
  });
  derive(bindings, bindingData, "vitals.heart_rate_max", ["vitals.heart_rate"], () => {
    const values = bindingData["vitals.heart_rate"]?.history?.flatMap((p) => p.value === null ? [] : [p.value]) ?? [];
    return values.length ? Math.max(...values) : null;
  });
  for (const key of ["vehicle.speed_ratio", "vehicle.speed_arc_offset"]) {
    derive(bindings, bindingData, key, ["vehicle.speed", "vehicle.speed_limit"], () => {
      const speed = bindings["vehicle.speed"], limit = bindings["vehicle.speed_limit"];
      if (!finite(speed) || !finite(limit) || limit <= 0) return null;
      return key.endsWith("ratio") ? speed / limit * 100 : 188.5 * (1 - Math.max(0, Math.min(1, speed / limit)));
    });
  }
  if (input.metadata.id === "sensor-health") sensorHealth(pool, streams, bindings, bindingData, now);
  return { bindings, bindingData };
}

function derive(bindings: Record<string, unknown>, data: Record<string, WidgetBindingData>, key: string,
  dependencies: string[], calculate: () => unknown): void {
  if (data[key]?.source !== "live" || data[key]?.timestamp !== null) return;
  const inputs = dependencies.map((name) => data[name]).filter((item) => item !== undefined);
  if (inputs.length !== dependencies.length) return;
  const unavailable = inputs.find((item) => item.status !== "receiving" && item.status !== "ready");
  const oldest = [...inputs].sort((a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity))[0]!;
  data[key] = { ...oldest, path: dependencies.join(" + "), history: [],
    source: inputs.some((item) => item.source === "study") ? "study" : oldest.source,
    simulated: inputs.some((item) => item.simulated),
    sourceKey: [...new Set(inputs.map((item) => item.sourceKey).filter(Boolean))].join(" + "),
    status: unavailable?.status ?? oldest.status };
  bindings[key] = unavailable ? null : calculate();
}

function sensorHealth(pool: Pool, streams: Stream[], bindings: Record<string, unknown>, data: Record<string, WidgetBindingData>, now: number): void {
  // Count observed channels only; discovery/connection alone never means samples are streaming.
  const observed = streams.filter((stream) => stream.sequence >= 0);
  const entries = observed.map((stream) => {
    const measurements = [...stream.signals.entries()].filter(([path, signal]) =>
      !["connected", "simulated", "sampleRate", "dataLostCount"].includes(path)
      && (finite(signal.value) || typeof signal.value === "boolean"
        || (Array.isArray(signal.value) && signal.value.some(finite))));
    const last = Math.max(...measurements.map(([, signal]) => signal.timestamp), -Infinity);
    const device = devices.get(pool)?.get(stream.sourceKey);
    const status = !stream.connected || (device && !device.connected && device.timestamp >= last)
      ? "disconnected" : !Number.isFinite(last) ? "waiting" : now - last > 5_000 ? "stale" : "streaming";
    const source = stream.simulated ? "Simulated" : stream.sourceKey;
    return { label: `${source} / ${stream.channel.replaceAll("_", " ")} · ${status}`, status, last };
  });
  const streaming = entries.filter((item) => item.status === "streaming").length;
  const labels: Record<string, string> = {
    "sensor.streaming_label": entries.length ? `${streaming}/${entries.length} observed channels streaming` : "Waiting for sensor samples",
    "sensor.issue_label": entries.length ? `${entries.length - streaming} observed channels unavailable` : "No samples received",
    ...Object.fromEntries([1, 2, 3].map((n) => [`sensor.summary_${n}`, n === 3 && entries.length > 3
      ? entries.slice(2).map((entry) => entry.label).join("\n") : entries[n - 1]?.label ?? "—"])),
  };
  for (const [key, value] of Object.entries(labels)) {
    if (data[key]?.source !== "live") continue;
    bindings[key] = value;
    data[key] = { ...data[key]!, status: "ready", sourceKey: "Observed I/O channels",
      timestamp: entries.some((item) => Number.isFinite(item.last)) ? Math.max(...entries.map((item) => item.last)) : null };
  }
}

function alias(values: Map<string, unknown>, payload: Record<string, unknown>, target: string, names: string[]): void {
  if (values.has(target)) return;
  const name = names.find((candidate) => Object.hasOwn(payload, candidate));
  if (name) values.set(target, payload[name]);
}
function flatten(value: Record<string, unknown>, prefix: string, result: Map<string, unknown>, depth = 0): void {
  if (depth > 5) return;
  for (const [key, item] of Object.entries(value).slice(0, 128)) {
    if (key.split(".").some((part) => forbidden.has(part))) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === "object" && !Array.isArray(item)) flatten(record(item), path, result, depth + 1);
    else result.set(path, item);
  }
}
function time(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  const result = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(result) && result <= fallback + 5_000 ? result : null;
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
