# CoreAPI

CoreAPI is the synchronous and persistence-facing center of the platform.

## Major Route Families

| Route family | Responsibility |
| --- | --- |
| `/api/health` | service health |
| `/api/system/bootstrap` | bootstrap state for the Admin Panel |
| `/api/onboarding/*` | first-run configuration and first admin creation |
| `/api/auth/*` | login, refresh, logout, identity lookup |
| `/api/system/*` | configuration, component status, CARLA connectivity, process control |
| `/api/dashboard` | summary dashboard payload |
| `/api/studies*` | studies and nested study resources |
| `/api/carla/presets/*` | simulator preset catalogues |
| `/api/sensors/*` | sensor driver catalogue and live status |
| `/api/widgets/catalogue` | widget catalogue summary |
| `/api/overlay/assets` | overlay asset origin resolution |
| `/ws` | realtime websocket hub |

## Study-Nested Areas

Under `/api/studies/:studyId`, CoreAPI manages:

- researchers
- participants
- conditions
- sessions and lifecycle actions
- CARLA configuration
- sensor configuration
- layouts
- widget triggers

## Session Lifecycle Actions

Session actions are exposed as explicit endpoints:

- `start`
- `pause`
- `resume`
- `complete`
- `cancel`
- `notes`

That keeps lifecycle transitions auditable and separate from raw session creation.

## Authorization Pattern

CoreAPI applies role-based restrictions by route family. Sensitive system, user, and configuration operations are narrower than general research and operator access.

## Related Reading

- [Contracts](/reference/contracts)
- [UI And RBAC](/reference/ui-and-rbac)
- [Realtime And Events](/reference/realtime-and-events)
