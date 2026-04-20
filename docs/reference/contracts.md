# Contracts

Shared contracts live in `packages/contracts` and define how services, clients, and frontends agree on data shape.

## Main Contract Modules

| Module | Purpose |
| --- | --- |
| `api.ts` | REST DTOs, dashboard payloads, user/device/export/session schemas |
| `enums.ts` | roles, health states, study/session states, widget state, component identifiers |
| `layout.ts` | layout config, widget instances, window mode |
| `widget.ts` | widget metadata, bindings, action/trigger normalization |
| `websocket.ts` | WebSocket channels and subscription/data envelopes |
| `rabbitmq.ts` | message envelopes, routing helpers, event/command enums |
| `process-manager.ts` | host-level command and status schema |

## Key State Enums

- roles: `admin`, `researcher`, `operator`, `viewer`
- session states: `created`, `running`, `paused`, `completed`, `cancelled`
- study states: `draft`, `active`, `completed`, `archived`
- health states: `healthy`, `degraded`, `error`, `disconnected`, `running`, `stopped`

## Important Data Families

- onboarding and auth payloads
- studies, conditions, participants, sessions
- component status and dashboard summaries
- users, researchers, devices
- trigger rules and export jobs
- session logs and session summaries
- active study payloads

## Change Rule

If a wire shape changes anywhere in the platform, start here first and propagate outward.
