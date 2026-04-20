# Realtime And Events

SCARline combines WebSocket fanout for browsers with RabbitMQ transport for backend integrations.

## WebSocket Channels

| Channel | Main use |
| --- | --- |
| `session.events` | event stream awareness |
| `session.telemetry` | live telemetry updates |
| `widget.updates` | widget state and binding updates |
| `system.health` | component health visibility |
| `sensor.status` | sensor availability and degradation |
| `export.progress` | export job progress |

Subscriptions support optional `studyId` and `sessionId` filters.

## RabbitMQ Exchanges And Queues

- exchanges:
  - `scarline.events`
  - `scarline.commands`
  - `scarline.dlx`
- important queues:
  - `scarline.core-api.events`
  - `scarline.core-api.commands`
  - `scarline.sim-bridge.commands`
  - `scarline.io-client.commands`
  - `scarline.export.commands`
  - `scarline.dlq`

## Routing Conventions

- events: `events.<studyId>.<runId>.<modality>.<eventType>`
- commands: `commands.<target>.<action>`

## Important Event Types

- simulator telemetry and world events
- sensor camera, lidar, GNSS, and IMU events
- I/O steering, camera, and driver-status events
- component status
- sensor status
- widget trigger events
- export progress

## Why The Split Exists

WebSocket is for browser-facing observability and responsiveness. RabbitMQ is for backend intent and observation. Keeping them separate avoids coupling the browser directly to service internals.
