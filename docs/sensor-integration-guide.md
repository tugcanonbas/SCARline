# SCARline Sensor Integration Guide

> **Audience:** External developers building widgets, dashboards, or analytics pipelines that consume real-time sensor data from the SCARline research platform.
>
> **Version:** 1.0 · June 2026

---

## 1. Overview

SCARline's sensor layer provides real-time physiological and vehicular telemetry for automotive UX/HCI studies. The I/O Client (`python/io-client`) hosts hardware drivers that capture sensor data and publish it as structured JSON events through RabbitMQ.

The following sensors are currently supported:

| Sensor | Driver | Technology |
|--------|--------|------------|
| Facial telemetry (blink, EAR, MAR, yawn, head pose, gaze, eyebrow) | `BlinkDetectionDriver` | MediaPipe FaceMesh + OpenCV |
| Gaze estimation + pupil diameter | `GazeDriver` | MediaPipe FaceMesh iris landmarks |
| Heart rate (BPM, RR-interval) | `HeartRateDriver` | BLE via Bleak / serial fallback |
| ECG waveform | `ECGDriver` | SiFi Bridge BLE (BioPoint / BioArmband) |
| Steering wheel, pedals, buttons | `LogitechG29Driver` | Linux evdev |
| USB camera frames | `UsbCameraDriver` | OpenCV |

All events are published to the `scarline.events` topic exchange via [aio-pika](https://aio-pika.readthedocs.io/). Consumers can subscribe using RabbitMQ topic wildcards or connect through the SCARline WebSocket hub at `ws://localhost:8088/ws`.

---

## 2. Connecting to the Broker

### Exchange

| Property | Value |
|----------|-------|
| Exchange name | `scarline.events` |
| Exchange type | `topic` |
| Durable | `true` |

### Subscribing with wildcards

Bind your queue to `scarline.events` with the routing key pattern:

```
events.*.*.sensor.io.*
```

This captures all IO sensor events across all studies and sessions. For steering events specifically (which use the `driving` modality), add:

```
events.*.*.driving.io.*
```

### Envelope format

Every message published by the I/O Client is wrapped in a standard envelope. The envelope fields are:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` (UUID v4) | Unique message identifier |
| `timestamp` | `string` (ISO 8601) | Publication time, e.g. `"2026-06-16T13:00:00.000Z"` |
| `routingKey` | `string` | Full topic routing key |
| `producer` | `string` | Always `"io-client"` for production, `"io-client-demo"` for demo scripts |
| `type` | `"event"` | Message classification (always `"event"` for sensor data) |
| `payload` | `object` | Sensor-specific payload — see §3 |
| `metadata.studyId` | `string \| null` | Study UUID, or `null` for system events |
| `metadata.runId` | `string \| null` | Session/run UUID, or `null` for system events |
| `metadata.correlationId` | `string \| null` | Optional correlation UUID |

**Example envelope:**

```json
{
  "id": "a3f1c2d4-5678-9abc-def0-1234567890ab",
  "timestamp": "2026-06-16T13:00:00.000Z",
  "routingKey": "events.study-01.run-01.sensor.io.blink",
  "producer": "io-client",
  "type": "event",
  "payload": { "...sensor fields..." },
  "metadata": {
    "studyId": "study-01",
    "runId": "run-01",
    "correlationId": null
  }
}
```

---

## 3. Event Catalog

### 3.1 `io.blink` — Facial Telemetry

**Routing key:** `events.{studyId}.{runId}.sensor.io.blink`
**Driver:** `BlinkDetectionDriver` (MediaPipe FaceMesh)
**Sample rate:** Configurable, default 10 Hz

| Field | Type | Range/Unit | Description |
|-------|------|------------|-------------|
| `earLeft` | `number \| null` | 0.0–0.5 | Eye Aspect Ratio for left eye |
| `earRight` | `number \| null` | 0.0–0.5 | Eye Aspect Ratio for right eye |
| `earAvg` | `number \| null` | 0.0–0.5 | Average EAR across both eyes |
| `blinkDetected` | `boolean` | — | `true` on the frame a blink is confirmed |
| `blinkCount` | `number` | ≥ 0, integer | Cumulative blink count since driver start |
| `eyesClosed` | `boolean` | — | `true` when `earAvg < ear_threshold` |
| `connected` | `boolean` | — | `true` if webcam + MediaPipe are active |
| `mar` | `number \| undefined` | 0.0–1.0+ | Mouth Aspect Ratio (vertical/horizontal) |
| `yawnDetected` | `boolean \| undefined` | — | `true` when `mar > 0.6` |
| `headPose` | `object \| undefined` | — | Head orientation estimates |
| `headPose.pitch` | `number` | normalized | Vertical tilt (negative = nodding down) |
| `headPose.yaw` | `number` | normalized | Horizontal rotation |
| `headPose.roll` | `number` | degrees | Head tilt angle |
| `gazePoint` | `object \| undefined` | — | Normalized gaze direction |
| `gazePoint.x` | `number` | 0.0–1.0 | Horizontal gaze (0 = left, 1 = right) |
| `gazePoint.y` | `number` | 0.0–1.0 | Vertical gaze (0 = up, 1 = down) |
| `eyebrowDistance` | `number \| undefined` | normalized | Distance between inner eyebrow landmarks |
| `sensorMetadata` | `object` | — | Driver metadata injected by I/O Client |
| `sensorMetadata.driver` | `string` | — | Driver ID, e.g. `"blink"` |
| `sensorMetadata.connected` | `boolean` | — | Driver connection state |
| `sensorMetadata.driverClass` | `string` | — | `"mediapipe-facemesh"` |
| `sensorMetadata.capabilities` | `string[]` | — | `["blink", "ear_ratio"]` |

**Example payload:**

```json
{
  "earLeft": 0.2814,
  "earRight": 0.2756,
  "earAvg": 0.2785,
  "blinkDetected": false,
  "blinkCount": 42,
  "eyesClosed": false,
  "connected": true,
  "mar": 0.1823,
  "yawnDetected": false,
  "headPose": { "pitch": -0.0412, "yaw": 0.0087, "roll": 1.2340 },
  "gazePoint": { "x": 0.5124, "y": 0.4831 },
  "eyebrowDistance": 0.0743,
  "sensorMetadata": {
    "driver": "blink",
    "connected": true,
    "driverClass": "mediapipe-facemesh",
    "capabilities": ["blink", "ear_ratio"],
    "ear_threshold": 0.21,
    "consec_frames": 2
  }
}
```

---

### 3.2 `io.eye_tracker` — Gaze Estimation

**Routing key:** `events.{studyId}.{runId}.sensor.io.eye_tracker`
**Driver:** `GazeDriver` (MediaPipe FaceMesh iris landmarks)
**Sample rate:** Configurable, default 10 Hz

| Field | Type | Range/Unit | Description |
|-------|------|------------|-------------|
| `gaze` | `object` | — | Normalized gaze coordinates |
| `gaze.x` | `number \| null` | 0.0–1.0 | Horizontal iris position within eye socket |
| `gaze.y` | `number \| null` | 0.0–1.0 | Vertical iris position within eye socket |
| `pupilDiameter` | `number \| null` | normalized | Average iris horizontal diameter (both eyes) |
| `connected` | `boolean` | — | `true` if webcam + MediaPipe are active |
| `sensorMetadata` | `object` | — | Driver metadata |
| `sensorMetadata.driver` | `string` | — | `"gaze"` |
| `sensorMetadata.connected` | `boolean` | — | Driver connection state |
| `sensorMetadata.driverClass` | `string` | — | `"mediapipe-facemesh"` |
| `sensorMetadata.capabilities` | `string[]` | — | `["gaze_estimation", "pupil_diameter"]` |

**Example payload:**

```json
{
  "gaze": { "x": 0.4892, "y": 0.5210 },
  "pupilDiameter": 0.023415,
  "connected": true,
  "sensorMetadata": {
    "driver": "gaze",
    "connected": true,
    "driverClass": "mediapipe-facemesh",
    "capabilities": ["gaze_estimation", "pupil_diameter"]
  }
}
```

---

### 3.3 `io.heart_rate` — Heart Rate

**Routing key:** `events.{studyId}.{runId}.sensor.io.heart_rate`
**Driver:** `HeartRateDriver` (BLE via Bleak / serial fallback)
**Sample rate:** Configurable, default 1 Hz

> **Canonical field name:** The BPM field is `heartRateBpm` (not `heartRate`).

| Field | Type | Range/Unit | Description |
|-------|------|------------|-------------|
| `heartRateBpm` | `number \| null` | 30–220 BPM | Heart rate in beats per minute |
| `rrIntervalMs` | `number \| null` | ms | R-R interval duration in milliseconds |
| `connected` | `boolean` | — | `true` if BLE or serial device is active |
| `sensorMetadata` | `object` | — | Driver metadata |
| `sensorMetadata.driver` | `string` | — | `"heart_rate"` |
| `sensorMetadata.connected` | `boolean` | — | Driver connection state |
| `sensorMetadata.driverClass` | `string` | — | `"heart_rate"` |
| `sensorMetadata.backend` | `string` | — | `"bleak"` or `"serial"` |

**Example payload:**

```json
{
  "heartRateBpm": 72,
  "rrIntervalMs": 833.0,
  "connected": true,
  "sensorMetadata": {
    "driver": "heart_rate",
    "connected": true,
    "driverClass": "heart_rate",
    "backend": "bleak"
  }
}
```

---

### 3.4 `io.ecg` — ECG Waveform

**Routing key:** `events.{studyId}.{runId}.sensor.io.ecg`
**Driver:** `ECGDriver` (SiFi Bridge BLE)
**Sample rate:** Configurable, default 500 Hz

| Field | Type | Range/Unit | Description |
|-------|------|------------|-------------|
| `ecgSamples` | `number[] \| null` | µV | Array of ECG amplitude samples for this packet |
| `sampleRate` | `number \| null` | Hz | Sampling frequency (250, 500, or 1000) |
| `dataLostCount` | `number \| null` | integer | Cumulative count of lost ECG packets |
| `connected` | `boolean` | — | `true` if SiFi Bridge device is active |
| `sensorMetadata` | `object` | — | Driver metadata |
| `sensorMetadata.driver` | `string` | — | `"ecg"` |
| `sensorMetadata.connected` | `boolean` | — | Driver connection state |
| `sensorMetadata.driverClass` | `string` | — | `"ecg"` |
| `sensorMetadata.backend` | `string` | — | `"sifi-bridge"` |

**Example payload:**

```json
{
  "ecgSamples": [0.12, 0.15, 0.42, 0.87, 1.24, 0.91, 0.33, 0.14, 0.09, 0.11],
  "sampleRate": 500,
  "dataLostCount": 0,
  "connected": true,
  "sensorMetadata": {
    "driver": "ecg",
    "connected": true,
    "driverClass": "ecg",
    "backend": "sifi-bridge"
  }
}
```

---

### 3.5 `io.steering` — Logitech G29

**Routing key:** `events.{studyId}.{runId}.driving.io.steering`
**Driver:** `LogitechG29Driver` (Linux evdev)
**Sample rate:** Configurable, default 100 Hz

> **Canonical field name:** The steering field is `steer` when the device is connected. In degraded mode the driver publishes `steeringAngle: null` instead. Consumers should read `p.steer ?? p.steeringAngle`.

| Field | Type | Range/Unit | Description |
|-------|------|------------|-------------|
| `steer` | `number` | -1.0 to 1.0 | Normalized steering angle (-1 = full left, +1 = full right) |
| `throttle` | `number` | 0.0–1.0 | Throttle pedal position (0 = released, 1 = fully pressed) |
| `brake` | `number` | 0.0–1.0 | Brake pedal position |
| `clutch` | `number` | 0.0–1.0 | Clutch pedal position |
| `gear` | `number` | integer | Current gear (1 = first) |
| `buttons` | `Record<string, boolean>` | — | Map of button code → pressed state |
| `sensorMetadata` | `object` | — | Driver metadata |
| `sensorMetadata.driver` | `string` | — | `"logitech_g29"` |
| `sensorMetadata.connected` | `boolean` | — | Driver connection state |
| `sensorMetadata.device_path` | `string` | — | Linux input device path, e.g. `"/dev/input/event0"` |

**Example payload (connected):**

```json
{
  "steer": -0.1234,
  "throttle": 0.45,
  "brake": 0.0,
  "clutch": 0.0,
  "gear": 3,
  "buttons": {},
  "sensorMetadata": {
    "driver": "logitech_g29",
    "connected": true,
    "device_path": "/dev/input/event0"
  }
}
```

**Example payload (degraded — no device):**

```json
{
  "steeringAngle": null,
  "throttle": null,
  "brake": null,
  "connected": false,
  "sensorMetadata": {
    "driver": "logitech_g29",
    "connected": false,
    "device_path": "/dev/input/event0"
  }
}
```

---

### 3.6 `io.driver_status` — Sensor Health Events

**Routing key:** `events.{studyId}.{runId}.sensor.io.driver_status`
**Publisher:** I/O Client main loop (every 10 seconds per active driver)

| Field | Type | Range/Unit | Description |
|-------|------|------------|-------------|
| `driverId` | `string` | — | Unique driver identifier (e.g. `"blink"`, `"heart_rate"`) |
| `sensorType` | `string` | — | Sensor category (e.g. `"blink"`, `"ecg"`, `"steering_wheel"`) |
| `displayName` | `string` | — | Human-readable sensor name |
| `connected` | `boolean` | — | `true` if hardware is responsive |
| `sampleRate` | `number` | Hz | Configured sample rate |
| `message` | `string \| null` | — | Status message or error description |
| `checkedAt` | `string` | ISO 8601 | Timestamp of last health check |
| `capabilities` | `string[]` | — | List of driver capabilities |
| `configSchema` | `Record<string, unknown>` | — | JSON schema of configurable fields |
| `degraded` | `boolean` | — | `true` if driver is running without hardware |

**Example payload:**

```json
{
  "driverId": "blink",
  "sensorType": "blink",
  "displayName": "MediaPipe Blink Detection",
  "connected": true,
  "sampleRate": 10,
  "message": null,
  "checkedAt": "2026-06-16T13:00:10.000Z",
  "capabilities": ["blink", "ear_ratio"],
  "configSchema": {
    "camera_index": { "type": "integer", "default": 0, "description": "Webcam device index" },
    "ear_threshold": { "type": "float", "default": 0.21, "description": "EAR threshold for blink detection" },
    "consec_frames": { "type": "integer", "default": 2, "description": "Consecutive frames below threshold to register blink" },
    "sample_rate": { "type": "integer", "default": 10, "description": "Frames per second to process" }
  },
  "degraded": false
}
```

---

## 4. Derived Metrics

### 4.1 EAR — Eye Aspect Ratio

The Eye Aspect Ratio measures eye openness. It is computed per-frame from six MediaPipe FaceMesh landmarks per eye using the formula:

```
EAR = (||p2 - p6|| + ||p3 - p5||) / (2 × ||p1 - p4||)
```

**How to consume:** Read `earAvg` from `io.blink` events. Typical open-eye values range from 0.20–0.35. A blink is detected when `earAvg < 0.21` persists for ≥ 2 consecutive frames.

```js
const ear = payload.earAvg;
const isClosed = ear != null && ear < 0.21;
```

### 4.2 MAR — Mouth Aspect Ratio

The Mouth Aspect Ratio measures mouth openness as the ratio of vertical lip distance to horizontal lip distance.

**How to consume:** Read `mar` from `io.blink` events. A yawn is flagged when `mar > 0.6`.

```js
const mar = payload.mar ?? 0;
const isYawning = mar > 0.6;
```

### 4.3 Fatigue Index — `computeFatigueIndex`

The Fatigue Index is a composite score (0–100) derived from EAR, MAR, yawn detection, and head pitch. The formula below is the exact implementation from `tools/dashboards/combined.html`:

```js
function computeFatigueIndex(payload) {
  let score = 0;

  // EAR component — weight 40
  // Lower EAR = more closed eyes = more fatigue
  if (payload.ear != null) {
    const earNorm = Math.max(0, Math.min(1, (0.30 - payload.ear) / 0.30));
    score += earNorm * 40;
  }

  // MAR component — weight 30
  // Higher MAR = wider mouth = more likely yawning
  if (payload.mar != null) {
    const marNorm = Math.max(0, Math.min(1, payload.mar / 0.6));
    score += marNorm * 30;
  }

  // Yawn detection — flat +15
  if (payload.yawnDetected === true) score += 15;

  // Head pitch component — weight 15
  // Negative pitch = head nodding down = drowsiness indicator
  if (payload.headPose?.pitch != null) {
    const pitchNorm = Math.max(0, Math.min(1, -payload.headPose.pitch / 0.3));
    score += pitchNorm * 15;
  }

  return Math.round(Math.min(100, score));
}
```

Before calling this function, alias the EAR field:

```js
payload.ear = payload.earAvg;
```

**Score interpretation:**

| Range | Label | Severity |
|-------|-------|----------|
| 0–39 | ALERT | Normal attentiveness |
| 40–69 | DROWSY | Moderate drowsiness |
| 70–100 | FATIGUED | High fatigue risk |

### 4.4 Steering (normalized)

The G29 driver publishes the steering angle as a normalized float. Read it with a fallback for degraded mode:

```js
const steer = p.steer ?? p.steeringAngle ?? 0;
const degrees = steer * 450; // Convert to approximate wheel degrees
```

### 4.5 BPM Display

The heart rate driver publishes beats-per-minute in the `heartRateBpm` field. Handle null gracefully:

```js
const bpm = payload.heartRateBpm;
display.textContent = bpm != null ? Math.round(bpm) : "—";
```

---

## 5. Building a Widget — Complete Example

The following snippet connects to the SCARline WebSocket hub, subscribes to sensor telemetry, and displays a live Fatigue Index.

```html
<div id="fatigue-display" style="font-family: monospace; text-align: center;">
  <div id="fatigue-score" style="font-size: 3rem; font-weight: bold;">0</div>
  <div id="fatigue-label" style="font-size: 1.2rem;">ALERT</div>
</div>

<script>
// --- SCARline Fatigue Widget ---
// Connects to the SCARline WebSocket and computes a live Fatigue Index
// from io.blink events.

const WS_URL = "ws://localhost:8088/ws";
const scoreEl = document.getElementById("fatigue-score");
const labelEl = document.getElementById("fatigue-label");

function computeFatigueIndex(p) {
  let score = 0;
  if (p.ear != null) {
    score += Math.max(0, Math.min(1, (0.30 - p.ear) / 0.30)) * 40;
  }
  if (p.mar != null) {
    score += Math.max(0, Math.min(1, p.mar / 0.6)) * 30;
  }
  if (p.yawnDetected === true) score += 15;
  if (p.headPose?.pitch != null) {
    score += Math.max(0, Math.min(1, -p.headPose.pitch / 0.3)) * 15;
  }
  return Math.round(Math.min(100, score));
}

function connect() {
  // Append auth token as query parameter (use a valid JWT for your environment)
  const token = "YOUR_JWT_TOKEN_HERE";
  const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);

  ws.onopen = () => {
    console.log("[FatigueWidget] Connected to SCARline WebSocket");
    // Subscribe to the session telemetry channel
    ws.send(JSON.stringify({
      action: "subscribe",
      channels: ["session.telemetry"]
    }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      // The WebSocket hub wraps events in { type: "event", data: { routingKey, payload } }
      if (data.type !== "event" || !data.data) return;

      const message = data.data;
      const rk = message.routingKey;
      const p = message.payload;

      // Only process blink events for fatigue calculation
      if (!rk.includes(".blink")) return;

      // Alias earAvg as ear for the formula
      p.ear = p.earAvg;

      const fatigue = computeFatigueIndex(p);
      scoreEl.textContent = fatigue;

      // Update label and color based on fatigue thresholds
      if (fatigue <= 39) {
        labelEl.textContent = "ALERT";
        scoreEl.style.color = "#4caf50";
        labelEl.style.color = "#4caf50";
      } else if (fatigue <= 69) {
        labelEl.textContent = "DROWSY";
        scoreEl.style.color = "#ff9800";
        labelEl.style.color = "#ff9800";
      } else {
        labelEl.textContent = "FATIGUED";
        scoreEl.style.color = "#f44336";
        labelEl.style.color = "#f44336";
      }
    } catch (e) {
      console.error("[FatigueWidget] Parse error:", e);
    }
  };

  ws.onclose = () => {
    console.log("[FatigueWidget] Disconnected. Reconnecting in 2s...");
    setTimeout(connect, 2000);
  };

  ws.onerror = (e) => console.error("[FatigueWidget] WebSocket error:", e);
}

// Start the connection
connect();
</script>
```

---

## 6. Degraded Mode

When a sensor's hardware is not physically connected or the required libraries are unavailable, the I/O Client continues to operate in **degraded mode**. Understanding degraded behavior is essential for building resilient widgets.

### What happens in degraded mode

1. **Null payload fields.** Measurement fields arrive as `null` rather than numeric values. For example, a disconnected heart rate monitor publishes `{ "heartRateBpm": null, "rrIntervalMs": null }`.

2. **`connected: false`** in the sensor payload. Every sensor event includes a `connected` boolean. When `false`, the data should be treated as unavailable.

3. **`degraded: true`** in `io.driver_status` events. The periodic health event explicitly flags degraded drivers. Use this to display connection status indicators in your UI.

4. **Stub data structure is preserved.** Even in degraded mode, the payload schema is identical — only the values are `null`. This means your parsing logic does not need separate branches for connected vs. disconnected.

### Defensive field access patterns

Always guard against `null` values using nullish coalescing:

```js
// Numeric fields — default to 0 or a safe fallback
const ear = payload.earAvg ?? 0;
const bpm = payload.heartRateBpm ?? 0;
const steer = payload.steer ?? payload.steeringAngle ?? 0;

// Display fields — show a dash for unavailable data
bpmDisplay.textContent = payload.heartRateBpm != null
  ? Math.round(payload.heartRateBpm)
  : "—";

// Boolean fields — treat null as false
const isYawning = payload.yawnDetected === true;

// Nested objects — use optional chaining
const pitch = payload.headPose?.pitch ?? 0;
const gazeX = payload.gazePoint?.x ?? 0.5;

// Connection guard — skip computation entirely if disconnected
if (payload.connected === false) {
  statusIndicator.textContent = "SENSOR OFFLINE";
  return;
}
```

### Degraded mode field reference

| Sensor | Degraded null fields | Always present |
|--------|---------------------|----------------|
| `io.blink` | `earLeft`, `earRight`, `earAvg`, `mar`, `headPose`, `gazePoint`, `eyebrowDistance` | `blinkDetected`, `blinkCount`, `eyesClosed`, `connected` |
| `io.eye_tracker` | `gaze.x`, `gaze.y`, `pupilDiameter` | `connected` |
| `io.heart_rate` | `heartRateBpm`, `rrIntervalMs` | `connected` |
| `io.ecg` | `ecgSamples`, `sampleRate`, `dataLostCount` | `connected` |
| `io.steering` | `steeringAngle` (note: field name changes in degraded mode), `throttle`, `brake` | `connected` |
