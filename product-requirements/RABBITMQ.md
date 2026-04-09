# RabbitMQ – Event Bus Architecture

> **Parent Document**: [PRD.md](./PRD.md)  
> **Related**: [RABBITMQ_EVENTS_AND_COMMANDS.md](./RABBITMQ_EVENTS_AND_COMMANDS.md) · [CORE_API.md](./CORE_API.md) · [DOCKER.md](./DOCKER.md)

---

## 1. Overview

[RabbitMQ](https://www.rabbitmq.com) is the **universal real-time event bus** for the SCARline platform. It handles all inter-component communication using a CQRS (Command Query Responsibility Segregation) pattern — separating commands (imperative instructions) from events (notifications of things that happened).

### Why RabbitMQ

| Requirement | How RabbitMQ Addresses It |
|-------------|--------------------------|
| Real-time data streaming | Low-latency message delivery between components |
| Decoupled components | Publishers and consumers don't need to know about each other |
| Reliable delivery | Message acknowledgment and persistence prevent data loss |
| Flexible routing | Topic exchanges with pattern-based routing keys |
| Multiple consumers | Fan-out patterns for events that multiple components need |

### RabbitMQ vs. WebSocket

| Transport | Used For | Direction |
|-----------|---------|-----------|
| **RabbitMQ** | Backend-to-backend communication (CoreAPI ↔ I/O Client, CoreAPI ↔ Sim-Bridge, export jobs) | Between services |
| **WebSocket** | Frontend-to-backend communication (Admin Panel ↔ CoreAPI, Overlay Engine ↔ CoreAPI) | Browser clients to CoreAPI |

CoreAPI acts as the **bridge** between RabbitMQ and WebSocket — it consumes RabbitMQ messages and re-publishes relevant data to connected WebSocket clients.

---

## 2. CQRS Architecture

SCARline enforces a formal separation between commands and events:

### Commands

Commands are **imperative instructions** — they tell a component to do something.

| Property | Description |
|----------|-------------|
| **Direction** | Sent to a specific target component |
| **Delivery** | Point-to-point (one consumer per command) |
| **Expectation** | The recipient is expected to act and may acknowledge or report failure |
| **Examples** | "Start session", "Load CARLA map", "Trigger widget" |

### Events

Events are **notifications** — they report that something has happened.

| Property | Description |
|----------|-------------|
| **Direction** | Published for any interested consumer |
| **Delivery** | Fan-out (multiple consumers can process the same event) |
| **Expectation** | No response expected — fire and forget |
| **Examples** | "Session started", "Vehicle speed updated", "Sensor connected" |

---

## 3. Exchange Topology

SCARline uses **topic exchanges** for flexible routing pattern matching.

### Exchanges

| Exchange Name | Type | Durability | Purpose |
|--------------|------|-----------|---------|
| `scarline.events` | `topic` | Durable | All platform events |
| `scarline.commands` | `topic` | Durable | All platform commands |
| `scarline.dlx` | `fanout` | Durable | Dead letter exchange for failed messages |

### Routing Key Schemes

#### Event Routing Keys

```
events.{studyId}.{runId}.{modality}.{eventType}
```

| Segment | Description | Examples |
|---------|-------------|---------|
| `events` | Fixed prefix | — |
| `{studyId}` | Study UUID (or `system` for non-study events) | `550e8400-e29b...`, `system` |
| `{runId}` | Session/run UUID (or `global` for study-wide events) | `6ba7b810-9dad...`, `global` |
| `{modality}` | Event modality category | `driving`, `communication`, `health`, `study`, `system`, `sensor` |
| `{eventType}` | Specific event type | `vehicle.telemetry`, `widget.triggered`, `session.started` |

**Examples**:
```
events.550e8400.6ba7b810.driving.vehicle.telemetry
events.550e8400.6ba7b810.health.sensor.heartrate
events.550e8400.global.study.condition.changed
events.system.global.system.component.status
```

#### Command Routing Keys

```
commands.{target}.{action}
```

| Segment | Description | Examples |
|---------|-------------|---------|
| `commands` | Fixed prefix | — |
| `{target}` | Target component or domain | `session`, `simulator`, `widget`, `export` |
| `{action}` | Specific command action | `start`, `load-map`, `trigger`, `create` |

**Examples**:
```
commands.session.start
commands.simulator.load-map
commands.widget.trigger
commands.export.create
```

---

## 4. Queue Architecture

### Queue Definitions

| Queue Name | Exchange | Binding Pattern | Consumer | Purpose |
|-----------|----------|----------------|----------|---------|
| `scarline.core-api.events` | `scarline.events` | `events.#` | CoreAPI | All events for persistence and WebSocket relay |
| `scarline.core-api.commands` | `scarline.commands` | `commands.session.*` | CoreAPI | Session lifecycle commands |
| `scarline.overlay.events` | `scarline.events` | `events.*.*.*.widget.*` | Overlay Engine | Widget-related events for rendering |
| `scarline.sim-bridge.commands` | `scarline.commands` | `commands.simulator.*` | Sim-Bridge | Simulator commands |
| `scarline.export.commands` | `scarline.commands` | `commands.export.*` | CoreAPI (async) | Export job commands |
| `scarline.io-client.events` | `scarline.events` | `events.*.*.sensor.*` | CoreAPI | Sensor data events from I/O Client |
| `scarline.dlq` | `scarline.dlx` | — | Monitoring | Failed messages for inspection |

### Queue Properties

All queues share these properties:

| Property | Value | Reason |
|----------|-------|--------|
| `durable` | `true` | Survive broker restarts |
| `autoDelete` | `false` | Persist even without consumers |
| `messageTtl` | `300000` (5 min) | Prevent unbounded queue growth for ephemeral data |
| `deadLetterExchange` | `scarline.dlx` | Route failed messages for inspection |
| `deadLetterRoutingKey` | `failed.{original-routing-key}` | Preserve origin information |

---

## 5. Message Envelope Format

All messages on RabbitMQ use a standardized envelope:

```json
{
  "id": "uuid-v4",
  "correlationId": "uuid-v4 (optional, for command-response tracking)",
  "timestamp": "2026-04-09T12:00:00.000Z",
  "source": "carla-client | io-client | core-api | researcher-trigger | ...",
  "routingKey": "events.{studyId}.{runId}.{modality}.{eventType}",
  "type": "event | command",
  "studyId": "uuid (if applicable)",
  "runId": "uuid (if applicable)",
  "payload": {
    // Domain-specific data
  }
}
```

### Message Properties (AMQP)

| Property | Value | Purpose |
|----------|-------|---------|
| `contentType` | `application/json` | All messages are JSON |
| `deliveryMode` | `2` (persistent) | Survive broker restarts |
| `timestamp` | Unix epoch (ms) | Message creation time |
| `messageId` | UUID v4 | Unique message identifier |
| `correlationId` | UUID v4 | Tracks command-response pairs |

---

## 6. Connection Management

### Per-Component Connections

Each component maintains its own AMQP connection:

| Component | Connection Type | Channels | Purpose |
|-----------|----------------|----------|---------|
| **CoreAPI** | Persistent | 2+ (publish + consume) | Central hub — publishes events, consumes commands |
| **I/O Client** | Persistent | 1 (publish) | Publishes sensor data events |
| **Sim-Bridge** | Persistent | 2 (publish + consume) | Publishes telemetry events, consumes simulator commands |
| **Overlay Engine** | Persistent | 1 (consume) | Consumes widget events for rendering |

### Connection Recovery

All components must implement:

- **Automatic reconnection** on connection loss (exponential backoff: 1s, 2s, 4s, 8s, max 30s)
- **Channel recovery** — recreate channels and re-bind queues after reconnection
- **Message buffering** — locally buffer messages during disconnection (configurable limit)

---

## 7. Dead Letter Handling

Messages are sent to the dead letter exchange (`scarline.dlx`) when:

- A consumer explicitly rejects/nacks a message without requeue
- A message exceeds its TTL in a queue
- A queue reaches its maximum length

### Dead Letter Queue Monitoring

The `scarline.dlq` queue collects all dead-lettered messages. The Admin Panel's component health view should surface:

- Current dead letter queue depth
- Most recent dead letter reasons
- Option to inspect and reprocess or discard dead letters

---

## 8. Performance and Reliability

### Throughput Targets

| Scenario | Expected Message Rate |
|----------|--------------------|
| Idle (no active session) | < 1 msg/sec (health checks only) |
| Active session (mock simulator) | ~50 msg/sec |
| Active session (CARLA + sensors) | ~300 msg/sec |
| Active session + multiple sensors | ~500 msg/sec peak |

### Reliability Guarantees

| Guarantee | Implementation |
|-----------|---------------|
| **No message loss** | Persistent messages + durable queues + publisher confirms |
| **At-least-once delivery** | Consumer acknowledgment required before message is removed |
| **Ordered delivery** | Within a single queue, messages are delivered in order |
| **Backpressure** | Consumers use prefetch count to limit unacknowledged messages |

### Prefetch Configuration

| Component | Prefetch Count | Reason |
|-----------|---------------|--------|
| CoreAPI | 50 | High-throughput event processing |
| Overlay Engine | 10 | Lower volume, focused on widget events |
| Sim-Bridge | 20 | Moderate command volume |

---

## 9. Development and Monitoring

### RabbitMQ Management UI

Accessible at `scarline:{port}/rabbitmq/` (admin role only) for:

- Exchange and queue inspection
- Message rate monitoring
- Connection and channel overview
- Dead letter queue inspection

### Environment Variables

See [DOCKER.md](./DOCKER.md) for the full list of RabbitMQ environment variables (`RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`).

### Complete Event and Command Reference

For the full taxonomy of all events and commands with routing keys and payload schemas, see [RABBITMQ_EVENTS_AND_COMMANDS.md](./RABBITMQ_EVENTS_AND_COMMANDS.md).
