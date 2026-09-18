# Contracts

`packages/contracts` holds the Zod schemas every service shares. Both producer and
consumer parse against the same definition, so a mismatch fails at the boundary instead
of being misinterpreted downstream.

## Modules

| Module | Owns |
| --- | --- |
| `common.ts` | `UuidSchema`, `IsoDateTimeSchema`, `JsonObjectSchema` |
| `api.ts` | Success and error envelopes, `ApiErrorSchema` |
| `auth.ts` | Login, tokens, claim shapes, cookie names and options |
| `config.ts` | `ScarlineConfigSchema`, `EnvironmentSecretsSchema`, per-service subsets |
| `domain.ts` | Roles, study status, users, studies, participants, conditions, sessions, data policy |
| `session.ts` | Session status, the transition table, `canTransitionSession` |
| `readiness.ts` | Readiness check keys and the readiness payload |
| `health.ts` | Component ids, health statuses, platform health |
| `events.ts` | Session event query, log item, aggregates |
| `export.ts` | Export job status and progress |
| `layout.ts` | Layouts, widget instances, overlay scopes, host commands and events |
| `widget.ts` | Widget manifests (both forms) and binding data |
| `trigger.ts` | Trigger expressions and action types |
| `simulator.ts` | The adapter protocol, CARLA configuration, lifecycle commands |
| `sensor.ts` | Sensor status and per-modality event payloads |
| `io.ts` | Driver manifests, IO session configuration, lifecycle commands, sample batches |
| `messaging.ts` | Exchanges, routing key patterns, message envelope |
| `websocket.ts` | Channels, subscriptions, server messages |

## Enums

**Roles** — `admin`, `researcher`, `operator`, `observer`

**Study status** — `draft`, `configured`, `ready`, `running`, `completed`, `archived`

**Session status** — `created`, `ready`, `running`, `paused`, `completed`, `aborted`,
`failed`

**Session condition status** — `pending`, `active`, `paused`, `completed`, `skipped`,
`aborted`, `failed`

**Lifecycle action** — `ready`, `start`, `pause`, `resume`, `advance`, `complete`,
`abort`, `fail`

**Lifecycle command status** — `queued`, `processing`, `completed`, `failed`,
`timed_out`

**Component id** — `database`, `rabbitmq`, `core-api`, `sim-bridge`, `mock-simulator`,
`carla-client`, `carla-server`, `io-client`, `overlay-web`, `desktop-overlay`,
`admin-panel`, `docker`

**Component health status** — `starting`, `healthy`, `degraded`, `unhealthy`, `stopped`,
`unavailable`

**Export job status** — `queued`, `running`, `completed`, `failed`, `cancelled`

**Export scope** — `study`, `participant`, `session`, `session_condition`

**Export format** — `csv`, `json`, `both`

**Layout type** — `participant`, `researcher_monitor`

**Widget window mode** — `transparent_electron`, `browser_popup`

**Overlay input mode** — `click_through`, `interactive`

**Overlay renderer mode** — `desktop`, `browser`

**Widget runtime action** — `trigger`, `show`, `hide`, `highlight`, `reset`, `update`

**Widget state** — `visible`, `hidden`, `highlighted`

**Widget binding source** — `live`, `study`, `presentation` (plus `preview` in binding
data)

**Widget binding status** — `ready`, `waiting`, `receiving`, `stale`, `disconnected`,
`ambiguous`

**Simulator type** — `carla`, `mock`

**CARLA control mode** — `io`, `autopilot`, `external`

**Simulator state** — `loading`, `ready`, `running`, `paused`, `stopped`

**IO disconnect policy** — `fail`, `continue`

**Trigger action type** — `widget.update`, `overlay.command`,
`session-condition.advance`, `simulator.command`

**WebSocket channel** — `session.lifecycle`, `session.events`, `session.telemetry`,
`widget.updates`, `overlay.windows`, `system.health`, `sensor.status`,
`export.progress`

**Readiness check key** — `participants`, `conditions`, `simulator`, `sensors`,
`participant_view`, `desktop_host`, `displays`, `widget_renderer`, `study_status`

## Session Transitions

`SessionTransitionSchema` is the single definition of the allowed edges:

| From | To |
| --- | --- |
| `created` | `ready`, `aborted`, `failed` |
| `ready` | `running`, `aborted`, `failed` |
| `running` | `paused`, `completed`, `aborted`, `failed` |
| `paused` | `running`, `completed`, `aborted`, `failed` |

`canTransitionSession(from, to)` is exported for anything that needs to check without
throwing.

## Response Envelopes

```json
{ "success": true, "data": { }, "error": null }
```

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "STUDY_NOT_FOUND",
    "message": "Study not found.",
    "details": { },
    "requestId": "req-1"
  }
}
```

`code` matches `^[A-Z][A-Z0-9_]*$`. `createApiSuccessEnvelopeSchema(dataSchema)` builds
the typed success envelope for a given payload.

## Data Policy

```json
{
  "persistence": { "mode": "all", "sampleEveryN": 1, "retentionDays": null },
  "realtime": { "maximumHz": null }
}
```

`DEFAULT_STUDY_DATA_POLICY` is exported and used when a study does not specify one.

## Constants

| Constant | Value |
| --- | --- |
| `REFRESH_TOKEN_COOKIE_NAME` | `__Host-scarline_refresh` |
| `OVERLAY_RENDER_COOKIE_NAME` | `__Host-scarline_overlay` |
| `CORE_API_WEBSOCKET_PATH` | `/ws` |
| `SIM_BRIDGE_ADAPTER_WEBSOCKET_PATH` | `/adapter` |
| `SIMULATOR_ADAPTER_PROTOCOL_VERSION` | `1` |
| `RABBITMQ_EXCHANGES` | `commands`, `events`, `realtime`, `deadLetters` |

Both cookie option sets are `httpOnly`, `secure`, `sameSite: strict`, `path: /`,
`priority: high`.

## JSON Schema Generation

`jsonSchemaSources` in `index.ts` maps a name to each schema exported as JSON Schema by
`scripts/generate-json-schemas.mjs`. That is how the Python services validate the same
shapes. Adding a schema a non-TypeScript service must parse means adding it here.

## Strictness

Most object schemas are `.strict()` — an unexpected property is a validation error, not
an ignored field. That is deliberate: a typo'd key fails loudly rather than being
silently dropped.

Practical consequences:

- Adding a request field means adding it to the schema.
- A client sending an extra field gets `400 VALIDATION_ERROR`.
- Adding an **optional** field is backward compatible; a required one is not.

## Read Next

- [Contracts And CoreAPI](/builders/contracts-and-core-api)
- [Messaging](/reference/messaging)
- [Database Schema](/reference/database)
