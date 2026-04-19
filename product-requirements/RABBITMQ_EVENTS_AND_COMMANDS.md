# RabbitMQ Events and Commands – Full Taxonomy

> **Parent Document**: [PRD.md](./PRD.md)  
> **Related**: [RABBITMQ.md](./RABBITMQ.md) · [CORE_API.md](./CORE_API.md) · [SIM_BRIDGE.md](./SIM_BRIDGE.md) · [IO_CLIENT.md](./IO_CLIENT.md)

---

## 1. Overview

This document defines the complete taxonomy of events and commands that flow through RabbitMQ. Each entry specifies the routing key, payload schema, producer(s), and consumer(s).

**Routing Key Formats**:
- Events: `events.{studyId}.{runId}.{modality}.{eventType}`
- Commands: `commands.{target}.{action}`

---

## 2. Events

### 2.1 Session Lifecycle Events

Events emitted when session state changes.

#### `session.created`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.study.session.created` |
| **Producer** | CoreAPI |
| **Consumers** | Admin Panel (via WebSocket) |

```json
{
  "sessionId": "uuid",
  "studyId": "uuid",
  "participantId": "uuid",
  "conditionId": "uuid",
  "name": "Session 1"
}
```

#### `session.started`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.study.session.started` |
| **Producer** | CoreAPI |
| **Consumers** | Admin Panel, Overlay Engine, Sim-Bridge |

```json
{
  "sessionId": "uuid",
  "studyId": "uuid",
  "startedAt": "2026-04-09T12:00:00.000Z",
  "condition": {
    "id": "uuid",
    "name": "Treatment A",
    "carlaOverrides": {},
    "widgetOverrides": {}
  }
}
```

#### `session.paused`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.study.session.paused` |
| **Producer** | CoreAPI |
| **Consumers** | Admin Panel, Overlay Engine, Sim-Bridge |

```json
{
  "sessionId": "uuid",
  "pausedAt": "2026-04-09T12:15:00.000Z"
}
```

#### `session.resumed`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.study.session.resumed` |
| **Producer** | CoreAPI |
| **Consumers** | Admin Panel, Overlay Engine, Sim-Bridge |

```json
{
  "sessionId": "uuid",
  "resumedAt": "2026-04-09T12:16:00.000Z"
}
```

#### `session.completed`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.study.session.completed` |
| **Producer** | CoreAPI |
| **Consumers** | Admin Panel, Overlay Engine, Sim-Bridge |

```json
{
  "sessionId": "uuid",
  "completedAt": "2026-04-09T13:00:00.000Z",
  "durationSeconds": 3600,
  "eventCount": 72000
}
```

#### `session.cancelled`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.study.session.cancelled` |
| **Producer** | CoreAPI |
| **Consumers** | Admin Panel, Overlay Engine, Sim-Bridge |

```json
{
  "sessionId": "uuid",
  "cancelledAt": "2026-04-09T12:30:00.000Z",
  "reason": "Participant requested stop"
}
```

---

### 2.2 Simulator Telemetry Events

Real-time data from the simulator (CARLA or Mock).

#### `vehicle.telemetry`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.driving.vehicle.telemetry` |
| **Producer** | CARLA Client / Mock Simulator (via Sim-Bridge) |
| **Consumers** | CoreAPI (persistence + WebSocket relay), Overlay Engine (widget data) |

```json
{
  "timestamp": "2026-04-09T12:00:00.050Z",
  "vehicle": {
    "speed": 45.2,
    "speedLimit": 50,
    "acceleration": 1.3,
    "position": {"x": 120.5, "y": -34.2, "z": 0.5},
    "rotation": {"pitch": 0, "yaw": 180, "roll": 0},
    "velocity": {"x": 12.1, "y": -0.5, "z": 0},
    "gear": 3,
    "throttle": 0.6,
    "brake": 0,
    "steer": 0.05
  }
}
```

#### `vehicle.collision`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.driving.vehicle.collision` |
| **Producer** | CARLA Client (via Sim-Bridge) |
| **Consumers** | CoreAPI, Admin Panel |

```json
{
  "timestamp": "2026-04-09T12:05:30.000Z",
  "otherActor": {"id": 42, "type": "vehicle", "blueprint": "vehicle.audi.a2"},
  "impulse": {"x": 500, "y": -200, "z": 0}
}
```

#### `vehicle.lane_invasion`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.driving.vehicle.lane_invasion` |
| **Producer** | CARLA Client (via Sim-Bridge) |
| **Consumers** | CoreAPI |

```json
{
  "timestamp": "2026-04-09T12:10:00.000Z",
  "crossedMarkings": [
    {"type": "Solid", "color": "White", "laneChange": "None"}
  ]
}
```

#### `world.snapshot`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.driving.world.snapshot` |
| **Producer** | CARLA Client (via Sim-Bridge) |
| **Consumers** | CoreAPI |

```json
{
  "frame": 12345,
  "simulationTime": 617.5,
  "deltaSeconds": 0.05,
  "weather": {"cloudiness": 80, "precipitation": 50},
  "actorCount": 45
}
```

#### `sensor.camera`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.driving.sensor.camera` |
| **Producer** | CARLA Client (via Sim-Bridge) |
| **Consumers** | CoreAPI |

```json
{
  "timestamp": "2026-04-09T12:00:00.050Z",
  "sensorId": "front_rgb",
  "frame": 12345,
  "width": 1920,
  "height": 1080,
  "encoding": "jpeg",
  "dataRef": "base64-or-reference-id"
}
```

#### `sensor.lidar`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.driving.sensor.lidar` |
| **Producer** | CARLA Client (via Sim-Bridge) |
| **Consumers** | CoreAPI |

```json
{
  "timestamp": "2026-04-09T12:00:00.050Z",
  "sensorId": "roof_lidar",
  "frame": 12345,
  "channels": 32,
  "pointCount": 56000,
  "horizontalAngle": 3.14,
  "dataRef": "reference-id"
}
```

---

### 2.3 Widget Events

Events related to widget state and triggers.

#### `widget.triggered`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.{modality}.widget.triggered` |
| **Producer** | CoreAPI (from manual trigger or automatic rule) |
| **Consumers** | Overlay Engine, CoreAPI (persistence) |

```json
{
  "instanceId": "uuid",
  "widgetId": "speedometer",
  "modality": "driving",
  "triggerType": "manual | automatic | configurable",
  "source": "researcher-trigger | rule-engine",
  "operatorId": "uuid",
  "bindingValues": {
    "vehicle.speed": 120,
    "vehicle.speedLimit": 80
  },
  "payload": {}
}
```

#### `widget.state_changed`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.{modality}.widget.state_changed` |
| **Producer** | CoreAPI |
| **Consumers** | Overlay Engine |

```json
{
  "instanceId": "uuid",
  "widgetId": "navigation-prompt",
  "previousState": "hidden",
  "newState": "visible",
  "reason": "condition-rule"
}
```

---

### 2.4 I/O Sensor Events

Events from physical sensors connected through the I/O Client.

#### `sensor.eyetracker`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.sensor.io.eyetracker` |
| **Producer** | I/O Client |
| **Consumers** | CoreAPI (persistence), Overlay Engine (if widget bound) |

```json
{
  "timestamp": "2026-04-09T12:00:00.016Z",
  "gazePoint": {"x": 0.52, "y": 0.34},
  "pupilDiameter": {"left": 4.2, "right": 4.1},
  "fixation": {"duration": 250, "x": 0.52, "y": 0.34},
  "sensorMetadata": {"device": "tobii_pro", "sampleRate": 60}
}
```

#### `sensor.heartrate`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.health.io.heartrate` |
| **Producer** | I/O Client |
| **Consumers** | CoreAPI, Overlay Engine (hr widget) |

```json
{
  "timestamp": "2026-04-09T12:00:01.000Z",
  "bpm": 78,
  "rrInterval": 769,
  "hrv": 45.2,
  "sensorMetadata": {"device": "polar_h10"}
}
```

#### `sensor.steering`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.driving.io.steering` |
| **Producer** | I/O Client |
| **Consumers** | CoreAPI (persistence + relay to Sim-Bridge for CARLA input) |

```json
{
  "timestamp": "2026-04-09T12:00:00.010Z",
  "steer": 0.15,
  "throttle": 0.6,
  "brake": 0,
  "clutch": 0,
  "handbrake": false,
  "gear": 3,
  "buttons": {"a": false, "b": false},
  "sensorMetadata": {"device": "logitech_g29"}
}
```

#### `sensor.respiration`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.health.io.respiration` |
| **Producer** | I/O Client |
| **Consumers** | CoreAPI, Overlay Engine (resp widget) |

```json
{
  "timestamp": "2026-04-09T12:00:01.000Z",
  "breathRate": 16,
  "breathAmplitude": 0.8
}
```

#### `sensor.bloodpressure`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.health.io.bloodpressure` |
| **Producer** | I/O Client |
| **Consumers** | CoreAPI, Overlay Engine (bp widget) |

```json
{
  "timestamp": "2026-04-09T12:00:05.000Z",
  "systolic": 120,
  "diastolic": 80,
  "meanArterial": 93
}
```

#### `sensor.spo2`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.health.io.spo2` |
| **Producer** | I/O Client |
| **Consumers** | CoreAPI, Overlay Engine (spo2 widget) |

```json
{
  "timestamp": "2026-04-09T12:00:01.000Z",
  "spo2Percentage": 98,
  "perfusionIndex": 3.2
}
```

#### `sensor.ecg`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.{studyId}.{runId}.health.io.ecg` |
| **Producer** | I/O Client |
| **Consumers** | CoreAPI, Overlay Engine (ecg widget) |

```json
{
  "timestamp": "2026-04-09T12:00:00.010Z",
  "samples": [0.12, 0.15, 0.89, 1.2, 0.3, -0.1],
  "sampleRate": 250,
  "leadType": "single"
}
```

---

### 2.5 System Events

Platform-level events not tied to a specific study session.

#### `component.status`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.system.global.system.component.status` |
| **Producer** | CoreAPI (from health checks) |
| **Consumers** | Admin Panel (via WebSocket) |

```json
{
  "componentId": "carla-server",
  "componentName": "CARLA Server",
  "status": "running | stopped | error",
  "message": "Connected on port 2000",
  "checkedAt": "2026-04-09T12:00:00.000Z"
}
```

#### `export.status`

| Property | Value |
|----------|-------|
| **Routing Key** | `events.system.global.system.export.status` |
| **Producer** | CoreAPI |
| **Consumers** | Admin Panel (via WebSocket) |

```json
{
  "jobId": "uuid",
  "status": "queued | processing | completed | failed",
  "progress": 75,
  "resultPath": "/exports/study-123.zip",
  "error": null
}
```

---

## 3. Commands

### 3.1 Session Commands

#### `session.start`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.session.start` |
| **Producer** | Admin Panel (via CoreAPI) |
| **Consumer** | CoreAPI |

```json
{
  "sessionId": "uuid",
  "studyId": "uuid",
  "participantId": "uuid",
  "conditionId": "uuid"
}
```

#### `session.pause`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.session.pause` |
| **Producer** | Admin Panel (via CoreAPI) |
| **Consumer** | CoreAPI |

```json
{
  "sessionId": "uuid"
}
```

#### `session.resume`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.session.resume` |
| **Producer** | Admin Panel (via CoreAPI) |
| **Consumer** | CoreAPI |

```json
{
  "sessionId": "uuid"
}
```

#### `session.complete`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.session.complete` |
| **Producer** | Admin Panel (via CoreAPI) |
| **Consumer** | CoreAPI |

```json
{
  "sessionId": "uuid"
}
```

#### `session.cancel`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.session.cancel` |
| **Producer** | Admin Panel (via CoreAPI) |
| **Consumer** | CoreAPI |

```json
{
  "sessionId": "uuid",
  "reason": "Participant requested stop"
}
```

---

### 3.2 Simulator Commands

#### `simulator.load-map`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.simulator.load-map` |
| **Producer** | CoreAPI |
| **Consumer** | Sim-Bridge → CARLA Client |

```json
{
  "mapName": "Town05",
  "resetSettings": true,
  "mapLayers": "All"
}
```

#### `simulator.set-weather`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.simulator.set-weather` |
| **Producer** | CoreAPI |
| **Consumer** | Sim-Bridge → CARLA Client |

```json
{
  "preset": "HardRainNoon",
  "custom": {
    "cloudiness": 90,
    "precipitation": 80,
    "wind_intensity": 60
  }
}
```

#### `simulator.spawn-vehicle`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.simulator.spawn-vehicle` |
| **Producer** | CoreAPI |
| **Consumer** | Sim-Bridge → CARLA Client |

```json
{
  "blueprint": "vehicle.lincoln.mkz_2020",
  "roleName": "hero",
  "spawnPointIndex": 0,
  "autoPilot": false
}
```

#### `simulator.configure-sensors`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.simulator.configure-sensors` |
| **Producer** | CoreAPI |
| **Consumer** | Sim-Bridge → CARLA Client |

```json
{
  "sensors": [
    {
      "type": "sensor.camera.rgb",
      "id": "front_rgb",
      "attributes": {"image_size_x": "1920", "image_size_y": "1080", "fov": "90"},
      "transform": {"x": 1.5, "y": 0, "z": 2.4}
    }
  ]
}
```

#### `simulator.set-traffic`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.simulator.set-traffic` |
| **Producer** | CoreAPI |
| **Consumer** | Sim-Bridge → CARLA Client |

```json
{
  "npcVehicleCount": 30,
  "pedestrianCount": 20,
  "pedestrianCrossFactor": 0.1,
  "trafficManagerPort": 8000,
  "globalSpeedDifference": -10
}
```

#### `simulator.set-spectator`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.simulator.set-spectator` |
| **Producer** | CoreAPI |
| **Consumer** | Sim-Bridge → CARLA Client |

```json
{
  "mode": "follow-ego | fixed | free",
  "transform": {"x": 0, "y": 0, "z": 50, "pitch": -90, "yaw": 0, "roll": 0}
}
```

#### `simulator.start-recording`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.simulator.start-recording` |
| **Producer** | CoreAPI |
| **Consumer** | Sim-Bridge → CARLA Client |

```json
{
  "filePath": "/recordings/session-{sessionId}.log",
  "additionalData": true
}
```

#### `simulator.stop-recording`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.simulator.stop-recording` |
| **Producer** | CoreAPI |
| **Consumer** | Sim-Bridge → CARLA Client |

```json
{}
```

---

### 3.3 Widget Commands

#### `widget.trigger`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.widget.trigger` |
| **Producer** | CoreAPI (from researcher action or rule engine) |
| **Consumer** | CoreAPI (processes and emits corresponding event) |

```json
{
  "instanceId": "uuid",
  "widgetId": "speedometer",
  "presetId": "speed_highway",
  "bindingValues": {"vehicle.speed": 120, "vehicle.speedLimit": 120},
  "payload": {},
  "source": "researcher-trigger | rule-engine",
  "operatorId": "uuid"
}
```

#### `widget.update-bindings`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.widget.update-bindings` |
| **Producer** | CoreAPI |
| **Consumer** | Overlay Engine |

```json
{
  "instanceId": "uuid",
  "widgetId": "navigation-prompt",
  "bindings": {
    "instruction": "Turn right in 200m",
    "distance": 200,
    "direction": "right"
  }
}
```

---

### 3.4 Export Commands

#### `export.create`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.export.create` |
| **Producer** | Admin Panel (via CoreAPI) |
| **Consumer** | CoreAPI (async processing) |

```json
{
  "jobId": "uuid",
  "studyId": "uuid",
  "sessionId": "uuid (optional)",
  "format": "json | csv | zip",
  "scope": "study | session | participant",
  "requestedBy": "uuid"
}
```

#### `export.cancel`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.export.cancel` |
| **Producer** | Admin Panel (via CoreAPI) |
| **Consumer** | CoreAPI |

```json
{
  "jobId": "uuid"
}
```

---

### 3.5 I/O Client Commands

#### `io.start-session`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.io.start-session` |
| **Producer** | CoreAPI |
| **Consumer** | I/O Client |

```json
{
  "studyId": "uuid",
  "sessionId": "uuid",
  "sensors": [
    {
      "type": "steering_wheel",
      "driver": "logitech_g29",
      "sample_rate": 100,
      "metadata": {"force_feedback": true}
    }
  ]
}
```

#### `io.stop-session`

| Property | Value |
|----------|-------|
| **Routing Key** | `commands.io.stop-session` |
| **Producer** | CoreAPI |
| **Consumer** | I/O Client |

```json
{
  "studyId": "uuid",
  "sessionId": "uuid"
}
```

---

## 4. Routing Key Quick Reference

### Events

| Routing Key Pattern | Description |
|-------------------|-------------|
| `events.{s}.{r}.study.session.*` | Session lifecycle events |
| `events.{s}.{r}.driving.vehicle.*` | Vehicle telemetry and driving events |
| `events.{s}.{r}.driving.world.*` | World/simulation state events |
| `events.{s}.{r}.driving.sensor.*` | CARLA sensor data events |
| `events.{s}.{r}.{m}.widget.*` | Widget trigger and state events |
| `events.{s}.{r}.sensor.io.*` | I/O Client sensor data |
| `events.{s}.{r}.health.io.*` | Health/biometric sensor data |
| `events.system.global.system.*` | System-level events |

### Commands

| Routing Key Pattern | Description |
|-------------------|-------------|
| `commands.session.*` | Session lifecycle commands |
| `commands.simulator.*` | Simulator control commands |
| `commands.widget.*` | Widget interaction commands |
| `commands.export.*` | Export job commands |
| `commands.io.*` | I/O Client session sensor commands |
