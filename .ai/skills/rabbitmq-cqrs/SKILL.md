---
name: "RabbitMQ CQRS Architect"
description: "Rules for defining, routing, and processing messages using RabbitMQ and CQRS in SCARline."
license: "Apache-2.0"
---

# SCARline RabbitMQ CQRS Skill

When generating, modifying, or reviewing inter-service communication or message payloads in SCARline, you must adhere strictly to the CQRS (Command Query Responsibility Segregation) event bus architecture.

## 1. Core Principles

- **No Direct Component Calls**: Services must never use HTTP REST to command another service to change state (except Process Manager OS-level scripts). All state changes must flow through RabbitMQ.
- **Separation of Concerns**: Differentiate strictly between **Commands** (asking for an action) and **Events** (declaring an action occurred).

## 2. Topic Exchange Exclusively

All messages are published to a single `topic` exchange named `scarline.exchange`. Direct or Fanout exchanges are not used.

## 3. Routing Key Schema

You must structure routing keys according to this strict pattern:

### Commands (Imperative)
Format: `{system}.{target}.{action}`

- `{system}`: Usually `study` or `system`.
- `{target}`: The component/domain being addressed (e.g., `session`, `simulator`, `widget`).
- `{action}`: The imperative verb (e.g., `start`, `stop`, `highlight`).

**Examples**: `study.session.start`, `system.simulator.spawn_vehicle`.

### Events (Declarative)
Format: `events.{system}.{domain}.{action}`

- Always prefixed with `events.`.
- `{system}`: Usually `study` or `system`.
- `{domain}`: The domain the event originated from (e.g., `telemetry`, `sensor`, `ui`).
- `{action}`: Past-tense verb or state change identifier.

**Examples**: `events.study.telemetry.vehicle_update`, `events.study.session.started`.

## 4. Universal Message Envelope

All JSON payloads sent to RabbitMQ must match this exact envelope structure:

```json
{
  "id": "uuid-v4",
  "timestamp": "ISO-8601 string",
  "routingKey": "The exact routing key used for publishing",
  "producer": "carla-client | coreapi | admin-panel | io-client",
  "payload": {
    // Dynamic data specific to the message
  },
  "metadata": {
    "studyId": "uuid or null",
    "runId": "uuid or null",
    "correlationId": "Used for matching command responses, or null"
  }
}
```

## 5. Dead-Letter Routing

When creating queues, you must always declare the dead-letter exchange (DLX) policy. Failed events are routed to `scarline.dlx`.
