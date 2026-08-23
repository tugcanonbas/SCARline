# SCARline Architecture Decision Records

> **Scope:** Sensor layer and RabbitMQ messaging divergences from the base project skills.
>
> **Last updated:** June 2026 · Branch `feature/sensor-layer-complete`

---

## Context

SCARline's sensor layer was built on top of two foundational skills inherited from the base project:

- **`sensor-driver`** — Guidelines for writing Python hardware integrations.
- **`rabbitmq-cqrs`** — Rules for inter-service messaging via RabbitMQ and CQRS.

During the implementation of the I/O Client (commits `8a0b536` through `b783544` on `feature/sensor-layer-complete`), the team made three deliberate architectural choices that diverge from those skills. These decisions were driven by the specific requirements of automotive UX/HCI research — high-frequency multi-sensor acquisition, mandatory degraded-mode operation, and centralized session lifecycle management.

This document records those divergences as lightweight ADRs so that future contributors and AI agents understand why the codebase does not match the skills verbatim, and can make informed decisions when extending the platform.

---

## ADR-001 — Driver Interface: Synchronous `read()` Over Async `publish()`

### Status

**Accepted** — implemented across all six production drivers.

### What the skill prescribes

The `sensor-driver` skill defines a driver contract with four async methods:

```python
class MyCustomSensor(SensorDriver):
    async def connect(self):       # Acquire hardware handle
    async def disconnect(self):    # Cleanup routine
    async def configure(self, config_dict):  # Apply parameters
    async def get_state(self):     # Return health indicator
```

Under this model, each driver is responsible for publishing its own readings directly to RabbitMQ via `aio-pika`.

### What SCARline implements

The actual `SensorDriver` abstract base class (`python/io-client/scarline_io/drivers/base.py`) defines a synchronous, read-only interface:

```python
class SensorDriver(ABC):
    def get_metadata(self) -> SensorMetadata     # Identity and capabilities
    def initialize(self, config) -> bool          # One-time setup, returns success
    def start(self) -> None                       # Activate acquisition
    def stop(self) -> None                        # Pause acquisition
    def read(self) -> SensorReading | None        # Return one sample (no I/O)
    def calibrate(self) -> bool                   # Hardware calibration check
    def is_connected(self) -> bool                # Connection health
    def shutdown(self) -> None                     # Release resources
    def get_configurable_fields(self) -> dict     # Advertise tunable parameters
```

Drivers never import `aio-pika`. They return a `SensorReading` dataclass, and the I/O Client's central `sensor_loop()` in `__main__.py` handles all RabbitMQ publishing, envelope construction, routing key resolution, error recovery, and health reporting.

### Rationale

1. **Separation of concerns.** A driver's job is to talk to hardware. It should not know about message brokers, envelope schemas, or routing key conventions. This boundary makes drivers portable — they could be consumed by a different transport layer (WebSocket, gRPC, file logger) without modification.

2. **Centralized control flow.** The `sensor_loop()` provides a single location for sample-rate throttling, degraded-mode stub emission, periodic `driver_status` health events (every 10 seconds), and graceful shutdown on `stop-session` commands. Without centralization, each driver would duplicate this logic.

3. **Testability.** Synchronous drivers with no I/O dependencies can be unit-tested with simple stubs. The existing test suite (`tests/simulator/io-client.test.mjs`) validates all drivers in isolation, including degraded-mode behavior, without requiring a running RabbitMQ instance.

4. **Degraded mode by design.** When hardware is unavailable, a driver returns `SensorReading` with null fields and `connected: False`. The central loop publishes this as a normal event — consumers receive a consistent schema regardless of hardware state. Under the original skill model, a disconnected driver would simply not publish, leaving consumers without any signal.

### Trade-off accepted

Drivers cannot emit out-of-band events. If a driver detects an exceptional condition (e.g., sudden sensor disconnection mid-frame), it must encode that information in the next `SensorReading`'s data or metadata fields. It cannot push an alert event independently. For the current sensor set (blink detection, gaze, heart rate, ECG, steering), this has not been a practical limitation — all anomalies are detectable within the regular read cycle.

---

## ADR-002 — Routing Key Modality: `sensor` Added to the Vocabulary

### Status

**Accepted** — all IO sensor events use the `sensor` modality.

### What the skill prescribes

The `rabbitmq-cqrs` skill defines four valid modalities for the event routing key pattern `events.{studyId}.{runId}.{modality}.{eventType}`:

- `driving` — vehicle dynamics and control
- `health` — participant physiological data
- `study` — study lifecycle events
- `system` — platform infrastructure

### What SCARline implements

SCARline introduces a fifth modality, `sensor`, used by all I/O Client telemetry events:

```
events.{studyId}.{runId}.sensor.io.blink
events.{studyId}.{runId}.sensor.io.eye_tracker
events.{studyId}.{runId}.sensor.io.heart_rate
events.{studyId}.{runId}.sensor.io.ecg
events.{studyId}.{runId}.sensor.io.driver_status
```

The one exception is the Logitech G29, which uses the `driving` modality since it produces vehicle control input:

```
events.{studyId}.{runId}.driving.io.steering
```

### Rationale

1. **Semantic precision.** The `health` modality implies clinically processed or interpreted data (e.g., a fatigue index, a stress classification). Raw sensor readings — EAR ratios, ECG waveforms, iris coordinates — are not health assessments. They are hardware observations that may or may not feed into a health-domain computation downstream.

2. **Filtering granularity.** Research operators may want to subscribe to raw sensor data without receiving study lifecycle events or system heartbeats. A dedicated `sensor` modality enables clean wildcard bindings (`events.*.*.sensor.#`) without cross-contamination from other domains.

3. **Scope of the original skill.** When the `rabbitmq-cqrs` skill was authored, the platform did not have an independent sensor acquisition layer. The four-modality list reflected the architecture at that time. Adding `sensor` is an additive extension, not a contradiction.

### Trade-off accepted

Any consumer that hardcodes a filter on the original four modalities (`driving|health|study|system`) will silently miss sensor events. This affects:

- Existing queue bindings that use enumerated modality patterns instead of `#` wildcards.
- Any validation logic that rejects unknown modalities.

In practice, SCARline's own consumers (`core-api`, `sim-bridge`, dashboards) all use inclusive wildcard patterns, so no production code is affected. External integrators should bind to `events.*.*.sensor.io.*` to receive sensor telemetry — this is documented in the [Sensor Integration Guide](sensor-integration-guide.md).

---

## ADR-003 — Envelope: `type` Field Present but Undocumented in Skill

### Status

**Accepted** — all messages include a `type` field.

### What the skill prescribes

The `rabbitmq-cqrs` skill defines the universal message envelope as:

```json
{
  "id": "uuid-v4",
  "timestamp": "ISO-8601 string",
  "routingKey": "...",
  "producer": "carla-client | core-api | sim-bridge | io-client",
  "payload": {},
  "metadata": {
    "studyId": "uuid or null",
    "runId": "uuid or null",
    "correlationId": "..."
  }
}
```

The `type` field is absent from this specification.

### What SCARline implements

Every message published by the I/O Client (and validated by the Zod schema `rabbitMessageSchema` in `packages/contracts/src/rabbitmq.ts`) includes a `type` field:

```json
{
  "id": "a3f1c2d4-...",
  "timestamp": "2026-06-16T13:00:00.000Z",
  "routingKey": "events.study-01.run-01.sensor.io.blink",
  "producer": "io-client",
  "type": "event",
  "payload": { "..." },
  "metadata": { "..." }
}
```

The `type` field is an enum: `"event"` or `"command"`.

### Rationale

The WebSocket hub in CoreAPI (`services/core-api/src/lib/websocket-hub.ts`) fans out RabbitMQ messages to browser clients. Having an explicit `type` field allows the hub to classify messages without parsing the routing key prefix (`events.*` vs `commands.*`). This is a performance optimization and a defensive coding practice — the field is authoritative, not derived.

### Trade-off accepted

None. This is a purely additive, non-breaking extension. Consumers that do not use the `type` field can ignore it. The Zod contract schema enforces its presence on all outgoing messages, so there is no inconsistency risk.

---

## Packaging Divergence (Note)

The `sensor-driver` skill prescribes the naming convention `scarline_io_*` for plugin discovery. SCARline's actual implementation uses `scarline_io.drivers.*` as the module namespace, with dynamic discovery via `importlib.metadata` entry points (group `scarline_io.drivers`).

This is not recorded as a formal ADR because:

1. It does not affect inter-service contracts or message schemas.
2. The discovery mechanism achieves the same goal (dynamic driver registration) through a standard Python packaging feature.
3. No external system depends on the `scarline_io_*` naming convention.

The `sensor_loop()` function in `__main__.py` discovers drivers through `DRIVER_FACTORIES` (built-in) and `importlib.metadata.entry_points()` (plugins), providing both hardcoded and dynamic registration paths.

---

## Summary of Divergences

| Area | Skill says | SCARline does | ADR |
|------|-----------|---------------|-----|
| Driver interface | Async methods, direct RabbitMQ publish | Sync `read()`, central `sensor_loop()` publishes | ADR-001 |
| Routing modalities | `driving`, `health`, `study`, `system` | Adds `sensor` for raw hardware data | ADR-002 |
| Envelope schema | No `type` field | `"type": "event" \| "command"` on every message | ADR-003 |
| Plugin naming | `scarline_io_*` | `scarline_io.drivers.*` + `importlib.metadata` | Note |
