# Realtime Channels

## Connecting

```text
ws://localhost:8088/ws
```

Authenticate with a single-use ticket from `POST /api/v1/auth/websocket-ticket`, passed
as a WebSocket subprotocol because browsers cannot set headers on a WebSocket:

```js
new WebSocket(`${origin}/ws`, [`scarline.user-ticket.${token}`]);
```

A bearer `Authorization` header works too, for non-browser clients. A principal whose
password still needs changing is refused with `PASSWORD_CHANGE_REQUIRED`.

## Subscribing

```json
{
  "type": "subscription.subscribe",
  "requestId": "<uuid>",
  "channels": ["session.lifecycle", "session.telemetry"],
  "filters": { "studyId": "<uuid>", "sessionId": "<uuid>" }
}
```

`subscription.unsubscribe` has the same shape. The server replies:

```json
{
  "type": "subscription.ack",
  "requestId": "<uuid>",
  "action": "subscribe",
  "channels": ["session.lifecycle", "session.telemetry"]
}
```

**Every channel except `system.health` requires a `studyId` filter.** A subscription
without one is refused — that is how study scoping is enforced on the socket.

`sessionId` narrows further. Omitting it delivers every session of that study.

## Channels

| Channel | Data |
| --- | --- |
| `session.lifecycle` | Session status, the command that caused it, active condition, remaining conditions |
| `session.events` | Raw message envelopes |
| `session.telemetry` | Telemetry envelopes |
| `widget.updates` | Widget state and binding changes |
| `overlay.windows` | Overlay host and window status |
| `system.health` | Platform health |
| `sensor.status` | Sensor availability and degradation |
| `export.progress` | Export job progress |

## Data Messages

```json
{
  "type": "data",
  "channel": "session.lifecycle",
  "timestamp": "2026-09-18T09:00:00.000Z",
  "data": { }
}
```

### `session.lifecycle`

```json
{
  "studyId": "<uuid>",
  "sessionId": "<uuid>",
  "previousStatus": "ready",
  "status": "running",
  "commandId": "<uuid>",
  "commandAction": "start",
  "commandStatus": "completed",
  "commandError": null,
  "activeConditionId": "<uuid>",
  "activeConditionName": "Baseline",
  "activeConditionSequence": 0,
  "conditionCount": 3,
  "remainingConditionCount": 2
}
```

`commandStatus` is `queued`, `processing`, `completed`, `failed`, or `timed_out`.
`commandAction` is one of the eight lifecycle actions.

### `export.progress`

```json
{
  "exportJobId": "<uuid>",
  "status": "running",
  "progress": 35,
  "artifactPath": null,
  "errorMessage": null
}
```

### `sensor.status`

```json
{
  "driverId": "heart_rate",
  "sensorType": "heart-rate",
  "connected": true,
  "sampleRate": 1,
  "message": null,
  "checkedAt": "2026-09-18T09:00:00.000Z",
  "capabilities": ["health.heart-rate"],
  "configSchema": {},
  "degraded": false
}
```

`session.events`, `session.telemetry`, `widget.updates`, and `overlay.windows` carry
message envelopes or plain JSON objects; `system.health` carries the platform health
payload.

## Channel Selection

Events arriving from RabbitMQ are mapped by routing key:

| Routing key contains | Channel |
| --- | --- |
| `.lifecycle.` | `session.lifecycle` |
| ends with `.telemetry` | `session.telemetry` |
| `.sensor.` | `sensor.status` |
| anything else | `session.events` |

`widget.updates`, `overlay.windows`, `system.health`, and `export.progress` are
broadcast directly by the components that produce them.

## Errors

```json
{
  "type": "error",
  "requestId": "<uuid or null>",
  "code": "INVALID_SUBSCRIPTION",
  "message": "A studyId filter is required for study data subscriptions"
}
```

Every subscription failure uses `INVALID_SUBSCRIPTION`; the `message` distinguishes
them:

| Message | Cause |
| --- | --- |
| `A studyId filter is required for study data subscriptions` | A channel other than `system.health` without a `studyId` |
| `Study access denied` | Not an admin and not a member of that study |
| `Session does not belong to the selected study` | The `sessionId` filter is not in that study |
| A Zod issue list | The client message did not match the schema |

## Delivery Guarantees

The socket is a **live view, not a log**. There is no replay: a client that reconnects
sees what happens next, and reconstructs the past from
`GET /api/v1/sessions/:id/events` or `GET /api/v1/session-events`.

Two throttles apply:

- `dataPolicy.realtime.maximumHz` per study limits delivery per session, component, and
  modality.
- `dataPolicy.persistence.mode: sampled` reduces what is stored, so sampled-out events
  never reach the socket either.

Critical events — `.lifecycle.`, `.trigger.`, `.annotation.`, `.error.`, and anything
flagged `level: error` or `severity: error` — bypass both.

## Overlay Runtime Socket

Widget renderers use a different socket with its own protocol:

```text
ws://localhost:8088/overlay-runtime?instanceId=<uuid>&lifecycleOnly=true
```

Authenticated with `scarline.overlay-ticket.<token>` from
`POST /api/v1/overlay/websocket-ticket`. Server messages:

| Type | Payload |
| --- | --- |
| `overlay.runtime.ready` | The resolved scope |
| `overlay.runtime.bindings` | `instanceId`, `bindings`, `bindingData`, `revision` |
| `overlay.runtime.trigger` | `instanceId`, `trigger` |
| `overlay.runtime.state` | `instanceId`, `visible` / `hidden` / `highlighted` |
| `overlay.runtime.session` | The session status |
| `overlay.runtime.close` | `session-terminal` or `condition-changed` |

`instanceId` restricts the socket to one widget; `lifecycleOnly=true` subscribes a layout
launcher to lifecycle events without sensor histories.

Live bindings are projected at most ten times per second, with a freshness update once
per second when nothing new arrived.

## Overlay Control Socket

The Electron host connects to `/overlay-control` with
`scarline.overlay-control.<token>`, sends `overlay.status`,
`overlay.window.changed`, and `overlay.command.result` events, and receives
`overlay.window.open`, `overlay.window.update`, `overlay.window.close`, and
`overlay.reload` commands.

## Read Next

- [Messaging](/reference/messaging)
- [Data And Realtime](/platform/data-and-realtime)
- [CoreAPI Routes](/reference/core-api)
