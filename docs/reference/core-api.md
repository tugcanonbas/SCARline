# CoreAPI Routes

Base URL `http://localhost:8088`. REST is under `/api/v1`; probes and sockets are not.

Unless noted, every route requires a bearer access token, an account whose password does
not need changing, and — for study-scoped routes — membership of that study (`admin`
bypasses membership).

## Probes

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/health` | none | Liveness; always `healthy` while the process runs |
| `GET` | `/ready` | none | `200` when PostgreSQL, RabbitMQ, and admin bootstrap are ready, else `503` |

## Authentication

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/login` | none | Requires an allowed `Origin`. Rate limit 10/min. Sets the refresh cookie |
| `POST` | `/api/v1/auth/refresh` | refresh cookie | Rotates the token. Rate limit 30/min |
| `POST` | `/api/v1/auth/logout` | refresh cookie | `204`, clears the cookie |
| `GET` | `/api/v1/auth/me` | bearer | Current principal |
| `POST` | `/api/v1/auth/websocket-ticket` | bearer | Single-use ticket for `/ws`. Rate limit 30/min |
| `POST` | `/api/v1/auth/change-password` | bearer | Minimum 12 characters; revokes the refresh cookie |

## Users

All require `admin`.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/v1/users` | Cursor-paginated |
| `POST` | `/api/v1/users` | Creates with `password_reset_required` |
| `GET` | `/api/v1/users/:id` | |
| `PATCH` | `/api/v1/users/:id` | Deactivating requires `disabledReason` and revokes sessions |
| `POST` | `/api/v1/users/:id/reset-password` | `204`; revokes sessions |

## Studies

| Method | Path | Roles | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/v1/studies` | any | Cursor-paginated; scoped to membership |
| `POST` | `/api/v1/studies` | admin, researcher | Creator becomes a member |
| `GET` | `/api/v1/studies/:studyId` | any | Includes participant, condition, and session counts |
| `PATCH` | `/api/v1/studies/:studyId` | admin, researcher | Requires an editable study |
| `DELETE` | `/api/v1/studies/:studyId` | admin, researcher | Refused once sessions exist |
| `GET` | `/api/v1/studies/:studyId/readiness` | any | The nine checks |
| `POST` | `/api/v1/studies/:studyId/transition` | admin, researcher | `{ "to": "<status>" }` |
| `GET` | `/api/v1/studies/:studyId/users` | any | Study members |
| `POST` | `/api/v1/studies/:studyId/users` | admin, researcher | `204` |
| `DELETE` | `/api/v1/studies/:studyId/users/:id` | admin, researcher | `204` |

## Participants And Conditions

| Method | Path | Roles |
| --- | --- | --- |
| `GET` | `/api/v1/studies/:studyId/participants` | any |
| `POST` | `/api/v1/studies/:studyId/participants` | admin, researcher |
| `PATCH` | `/api/v1/studies/:studyId/participants/:id` | admin, researcher |
| `DELETE` | `/api/v1/studies/:studyId/participants/:id` | admin, researcher |
| `GET` | `/api/v1/studies/:studyId/conditions` | any |
| `POST` | `/api/v1/studies/:studyId/conditions` | admin, researcher |
| `PATCH` | `/api/v1/studies/:studyId/conditions/:id` | admin, researcher |
| `DELETE` | `/api/v1/studies/:studyId/conditions/:id` | admin, researcher |

`POST .../conditions` accepts `templateConditionId` to clone the source condition's
simulator configuration, devices and sensor configuration, layouts, and widget instances.
A condition already used by a session is archived rather than deleted.

## Condition Configuration

| Method | Path | Roles |
| --- | --- | --- |
| `GET` | `/api/v1/studies/:studyId/conditions/:conditionId/simulator` | any |
| `PUT` | `/api/v1/studies/:studyId/conditions/:conditionId/simulator` | admin, researcher |
| `GET` | `/api/v1/studies/:studyId/conditions/:conditionId/devices` | any |
| `POST` | `/api/v1/studies/:studyId/conditions/:conditionId/devices` | admin, researcher |
| `PATCH` | `/api/v1/studies/:studyId/conditions/:conditionId/devices/:id` | admin, researcher |
| `DELETE` | `/api/v1/studies/:studyId/conditions/:conditionId/devices/:id` | admin, researcher |
| `PUT` | `/api/v1/studies/:studyId/conditions/:conditionId/devices/:id/sensors` | admin, researcher |
| `GET` | `/api/v1/studies/:studyId/conditions/:conditionId/triggers` | any |
| `POST` | `/api/v1/studies/:studyId/conditions/:conditionId/triggers` | admin, researcher |
| `PATCH` | `/api/v1/studies/:studyId/conditions/:conditionId/triggers/:id` | admin, researcher |
| `DELETE` | `/api/v1/studies/:studyId/conditions/:conditionId/triggers/:id` | admin, researcher |

A `carla` simulator body is additionally validated against the full CARLA session schema.

## Devices

| Method | Path | Roles |
| --- | --- | --- |
| `GET` | `/api/v1/devices` | any |
| `POST` | `/api/v1/devices` | admin |
| `PATCH` | `/api/v1/devices/:id` | admin |
| `DELETE` | `/api/v1/devices/:id` | admin — disabled instead of deleted when in use |
| `GET` | `/api/v1/devices/:id/sensors` | any |
| `POST` | `/api/v1/devices/:id/sensors` | admin |
| `DELETE` | `/api/v1/devices/:deviceId/sensors/:id` | admin — refused when configured |

## Layouts And Widget Instances

| Method | Path | Roles |
| --- | --- | --- |
| `PUT` | `/api/v1/studies/:studyId/layouts/participant` | admin, researcher — transactional multi-condition save |
| `GET` | `/api/v1/studies/:studyId/conditions/:conditionId/layouts` | any |
| `POST` | `/api/v1/studies/:studyId/conditions/:conditionId/layouts` | admin, researcher |
| `PATCH` | `.../layouts/:layoutId` | admin, researcher |
| `DELETE` | `.../layouts/:layoutId` | admin, researcher |
| `POST` | `.../layouts/:layoutId/widgets` | admin, researcher |
| `PATCH` | `.../layouts/:layoutId/widgets/:id` | admin, researcher |
| `DELETE` | `.../layouts/:layoutId/widgets/:id` | admin, researcher |

## Catalogues

| Method | Path | Roles |
| --- | --- | --- |
| `GET` | `/api/v1/widgets/catalogue` | any |
| `POST` | `/api/v1/widgets/refresh` | admin, researcher |
| `GET` | `/api/v1/sensors/catalogue` | any |
| `POST` | `/api/v1/sensors/refresh` | admin, researcher |

A refresh that finds an invalid manifest returns `409` with the validation issues.

## Sessions

| Method | Path | Roles |
| --- | --- | --- |
| `POST` | `/api/v1/studies/:studyId/sessions` | admin, researcher, operator |
| `GET` | `/api/v1/studies/:studyId/sessions` | any — filter by `status` |
| `GET` | `/api/v1/sessions/:id` | any — includes conditions and the latest command |
| `PATCH` | `/api/v1/sessions/:id` | admin, researcher |
| `DELETE` | `/api/v1/sessions/:id` | admin, researcher |
| `GET` | `/api/v1/session-commands/:id` | any |

### Lifecycle Actions

`POST /api/v1/sessions/:id/{ready|start|pause|resume|advance|complete|abort|fail}` —
`admin`, `researcher`, `operator`. Returns `202` with `{ commandId, status: "queued" }`.

Body:

```json
{ "reason": null, "rendererMode": "desktop", "hostId": null }
```

`reason` is required for `abort`. `rendererMode` and `hostId` apply to `start`.

### Session Overlay

| Method | Path | Roles |
| --- | --- | --- |
| `POST` | `/api/v1/sessions/:id/overlay/desktop` | admin, researcher, operator — reopen participant windows |
| `PUT` | `/api/v1/sessions/:id/overlay/windows/:instanceId` | admin, researcher, operator — persist geometry with `expectedRevision` |
| `GET` | `/api/v1/sessions/:id/widgets/data` | any — per-binding source diagnostics |
| `POST` | `/api/v1/sessions/:id/widgets/trigger` | admin, researcher, operator — manual widget command |

## Events And Activity

| Method | Path | Roles |
| --- | --- | --- |
| `GET` | `/api/v1/session-events` | any — global stream with filters and aggregates |
| `GET` | `/api/v1/sessions/:id/events` | any — one session, `beforeId` paging |
| `POST` | `/api/v1/sessions/:id/annotations` | admin, researcher, operator — `202` |
| `GET` | `/api/v1/activity` | admin |
| `GET` | `/api/v1/studies/:studyId/activity` | admin, researcher, observer |
| `GET` | `/api/v1/dashboard` | any |

## Exports

All require `admin` or `researcher`.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/v1/exports` | Filter by `studyId`, `sessionId`, `status` |
| `POST` | `/api/v1/exports` | `202` with the job id |
| `GET` | `/api/v1/exports/:id` | Job state |
| `GET` | `/api/v1/exports/:id/download` | ZIP stream; `409` until completed |
| `DELETE` | `/api/v1/exports/:id` | Cancels a queued job; refuses a running one |

## System

| Method | Path | Roles |
| --- | --- | --- |
| `GET` | `/api/v1/system/status` | admin — configuration, components, overlay |
| `GET` | `/api/v1/components/status` | any — live component heartbeats |
| `GET` | `/api/v1/overlay/status` | any — hosts, displays, windows, selection |
| `GET` | `/api/v1/system/configuration` | admin |
| `PUT` | `/api/v1/system/configuration` | admin |
| `POST` | `/api/v1/system/carla/:action` | admin — `start`, `stop`, `restart` via the process manager |
| `POST` | `/api/v1/carla/test-connection` | admin |
| `POST` | `/api/v1/system/overlay/reload` | admin |

::: warning Process-manager routes
`/system/carla/:action`, `/carla/test-connection`, and `/system/overlay/reload` call an
external process-manager socket (`PM_SOCKET_PATH`). The current stack does not run one —
the CLI owns process lifecycle instead — so they answer `503 PROCESS_MANAGER_UNAVAILABLE`.
Use `scarline start`/`stop` rather than these endpoints.
:::

## Overlay

| Method | Path | Auth |
| --- | --- | --- |
| `POST` | `/api/v1/overlay/token` | `x-overlay-control-secret` header. Rate limit 20/min |
| `POST` | `/api/v1/overlay/selection` | bearer — admin, researcher, operator |
| `POST` | `/api/v1/overlay/render-grants` | bearer — admin, researcher, operator |
| `POST` | `/api/v1/overlay/bootstrap` | bootstrap token. Rate limit 60/min |
| `GET` | `/api/v1/overlay/runtime` | render-session cookie |
| `POST` | `/api/v1/overlay/websocket-ticket` | render-session cookie |
| `POST` | `/api/v1/overlay/interactions` | render-session cookie — `202` |
| `POST` | `/api/v1/overlay/commands` | bearer — admin, researcher, operator |

The last three also exist under `/api/v1/overlay/renderers/:rendererId/...` for
per-renderer scoped cookies.

## WebSockets

| Path | Credential |
| --- | --- |
| `/ws` | User ticket — `scarline.user-ticket.<token>` |
| `/overlay-control` | Overlay control token — `scarline.overlay-control.<token>` |
| `/overlay-runtime` | Overlay ticket — `scarline.overlay-ticket.<token>` |

Each accepts the credential as a bearer header or a `Sec-WebSocket-Protocol` entry.

## Read Next

- [Realtime Channels](/reference/realtime)
- [Error Codes](/reference/error-codes)
- [Admin Panel And RBAC](/reference/admin-panel)
