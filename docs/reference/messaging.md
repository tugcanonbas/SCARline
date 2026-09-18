# Messaging

RabbitMQ carries every backend integration. Commands express intent, events record
observation, and the two are deliberately kept apart so you can see what was asked for
separately from what happened.

## Exchanges

All topic exchanges, all durable.

| Exchange | Carries |
| --- | --- |
| `scarline.commands` | Commands to a named component |
| `scarline.events` | Everything that happened |
| `scarline.realtime` | Vehicle control, non-persistent |
| `scarline.dlx` | Dead letters |

## Queues

Durable, dead-lettering to `scarline.dlx` with routing key `dead.<queue>`.

| Queue | Consumer | Binding |
| --- | --- | --- |
| `scarline.core-api.commands` | CoreAPI | `commands.core-api.*` |
| `scarline.core-api.events` | CoreAPI | `events.#` |
| `scarline.sim-bridge.commands` | Sim-Bridge | `commands.sim-bridge.*` |
| `scarline.io-client.commands` | IO Client | `commands.io-client.*` |
| `scarline.core-api.dead-letters` | CoreAPI | `#` on `scarline.dlx` |

Sim-Bridge also binds a queue to `controls.*` on `scarline.realtime`.

CoreAPI prefetches 20 messages. A message that fails schema validation, or whose handler
throws, is nacked without requeue and dead-letters rather than looping.

## Routing Keys

```text
commands.<target>.<action>
events.<studyId|system>.<sessionId|global>.<modality>.<eventType>
controls.<sessionId>
```

Both command and event keys are validated by regular expression in
`packages/contracts/src/messaging.ts`, so a malformed key fails at enqueue time.

`<modality>` is `^[a-z][a-z0-9-]*$`. `<eventType>` additionally allows `.` and `_`, which
is how sensor channel keys such as `heart_rate` survive into event names.

### Commands

| Routing key | Consumer | Payload |
| --- | --- | --- |
| `commands.core-api.session-lifecycle` | CoreAPI | `commandId`, `action`, `reason`, `rendererMode`, `hostId` |
| `commands.sim-bridge.session-<action>` | Sim-Bridge | `commandId`, `action`, `sessionId`, `deadlineAt`, plus `configuration` on `start` and `advance` |
| `commands.sim-bridge.simulator-command` | Sim-Bridge | `commandId`, `sessionId`, `sessionConditionId`, `command`, `parameters`, `requiredCapability`, `triggerRuleId`, `deadlineAt` |
| `commands.io-client.session-<action>` | IO Client | Same shape, with the IO session configuration |
| `commands.io-client.catalogue-refresh` | IO Client | Re-read the driver manifests |

`<action>` is `start`, `pause`, `resume`, `advance`, `complete`, or `abort`.

### Events

| Routing key | Producer |
| --- | --- |
| `events.<study>.<session>.lifecycle.command-queued` | CoreAPI |
| `events.<study>.<session>.lifecycle.command-processing` | CoreAPI |
| `events.<study>.<session>.lifecycle.command-failed` | CoreAPI |
| `events.<study>.<session>.lifecycle.command-timed-out` | CoreAPI |
| `events.<study>.<session>.lifecycle.session-<action>` | CoreAPI |
| `events.<study>.<session>.command.ack` | Sim-Bridge, IO Client |
| `events.<study>.<session>.driving.vehicle.telemetry` | Sim-Bridge |
| `events.<study>.<session>.driving.simulator.collision` | Sim-Bridge |
| `events.<study>.<session>.driving.simulator.lane-invasion` | Sim-Bridge |
| `events.<study>.<session>.<modality>.io.<channelKey>` | IO Client |
| `events.<study>.<session>.trigger.rule-fired` | CoreAPI |
| `events.<study>.<session>.annotation.created` | CoreAPI |
| `events.<study>.<session>.error.command-failed` | CoreAPI |
| `events.<study>.<session>.error.command-timeout` | CoreAPI |
| `events.<study>.<session>.error.overlay-open-failed` | CoreAPI |
| `events.<study>.<session>.error.overlay-close-failed` | CoreAPI |
| `events.<study>.<session>.error.sensor-disconnected` | IO Client |
| `events.<study>.<session>.error.simulator-cleanup-warning` | Sim-Bridge |
| `events.system.global.component.heartbeat` | Sim-Bridge |
| `events.system.global.system.component.heartbeat` | IO Client |
| `events.system.global.system.device.discovered` | IO Client |
| `events.system.global.system.device.status` | IO Client |

## Message Envelope

Every command and event uses the same envelope, validated by `MessageEnvelopeSchema`:

```json
{
  "id": "<uuid>",
  "timestamp": "2026-09-18T09:00:00.000Z",
  "routingKey": "events.<study>.<session>.driving.vehicle.telemetry",
  "producer": "sim-bridge",
  "payload": { },
  "metadata": {
    "studyId": "<uuid or null>",
    "sessionId": "<uuid or null>",
    "correlationId": "<uuid or null>",
    "source": { "component": "sim-bridge", "instanceId": "<string or null>" }
  }
}
```

| Field | Rule |
| --- | --- |
| `id` | UUID; also the AMQP `messageId` and the inbox deduplication key |
| `producer` | `core-api`, `sim-bridge`, or `io-client` |
| `payload` | A JSON object |
| `metadata.correlationId` | The lifecycle command id, where one applies |
| `metadata.source.component` | `^[a-z][a-z0-9-]*$` |

Messages are published persistent (delivery mode 2) with publisher confirms, except
`vehicle.control` on `scarline.realtime`, which is non-persistent by design.

## Delivery Semantics

**At least once.** CoreAPI writes an `event_outbox` row in the same transaction as the
domain change; a background publisher drains it, retrying with a growing delay and
failing the row after ten attempts.

Consumers deduplicate by claiming `message_inbox` with the message id inside the handling
transaction. A redelivered message finds the claim and is skipped.

Order is not guaranteed across producers. CoreAPI serialises event handling **per
session**, so events for one session are applied in arrival order.

## Real-Time Control

```text
exchange: scarline.realtime
routing key: controls.<sessionId>
```

```json
{
  "version": 1,
  "id": "<uuid>",
  "timestamp": "2026-09-18T09:00:00.000Z",
  "type": "vehicle.control",
  "studyId": "<uuid>",
  "sessionId": "<uuid>",
  "sessionConditionId": "<uuid>",
  "sourceKey": "driver:logitech_g29",
  "sequence": 1024,
  "throttle": 0.42,
  "steer": -0.13,
  "brake": 0
}
```

Published by the IO Client whenever a sensor sample carries `steer`, `throttle`, and
`brake`. Sim-Bridge consumes `controls.*` and forwards it to the bound adapter as
`adapter.vehicle_control`. It is non-persistent and not journaled — a lost control frame
is replaced by the next one, which is the right trade for input latency.

## Inspecting The Broker

```text
http://localhost:15672
```

Credentials are `scarline` and `RABBITMQ_DEFAULT_PASS` from `.env`.

Useful checks: a growing `scarline.core-api.dead-letters` means messages are failing
validation or handling; a growing command queue means a consumer is down; an empty
`events.#` queue with a full outbox means the publisher cannot reach the broker.

## Read Next

- [Realtime Channels](/reference/realtime)
- [Data And Realtime](/platform/data-and-realtime)
- [Simulator Adapters](/builders/simulator-adapters)
