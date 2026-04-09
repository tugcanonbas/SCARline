---
name: "rabbitmq-cqrs"
description: "Rules for defining, routing, and processing messages using RabbitMQ and CQRS in SCARline."
license: "Apache-2.0"
---

# SCARline RabbitMQ CQRS Skill

When generating, modifying, or reviewing inter-service communication or message payloads in SCARline, you must adhere strictly to the CQRS (Command Query Responsibility Segregation) event bus architecture.

## 1. Core Principles

- **No Direct Component Calls**: Services must never use HTTP REST to command another service to change state (except Process Manager OS-level scripts). All state changes must flow through RabbitMQ.
- **Separation of Concerns**: Differentiate strictly between **Commands** (asking for an action) and **Events** (declaring an action occurred).

## 2. Topic Exchanges

SCARline uses dedicated durable exchanges for commands and events:

- Commands: `scarline.commands`
- Events: `scarline.events`
- Dead letters: `scarline.dlx`

Backend services integrate with each other through RabbitMQ only. Frontend clients connect to CoreAPI over WebSocket and never consume RabbitMQ directly.

## 3. Routing Key Schema

You must structure routing keys according to this strict pattern:

### Commands (Imperative)
Format: `commands.{target}.{action}`

- `{target}`: The component/domain being addressed (e.g., `session`, `simulator`, `widget`).
- `{action}`: The imperative verb (e.g., `start`, `stop`, `highlight`).

**Examples**: `commands.session.start`, `commands.simulator.spawn-vehicle`.

### Events (Declarative)
Format: `events.{studyId}.{runId}.{modality}.{eventType}`

- `studyId`: A study UUID or `system`
- `runId`: A session UUID or `global`
- `modality`: Domain grouping such as `driving`, `health`, `study`, or `system`
- `eventType`: Specific event type such as `vehicle.telemetry` or `session.started`

**Examples**: `events.system.global.system.component.status`, `events.550e8400.6ba7b810.driving.vehicle.telemetry`.

## 4. Universal Message Envelope

All JSON payloads sent to RabbitMQ must match this exact envelope structure:

```json
{
  "id": "uuid-v4",
  "timestamp": "ISO-8601 string",
  "routingKey": "The exact routing key used for publishing",
  "producer": "carla-client | core-api | sim-bridge | io-client",
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
