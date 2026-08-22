# Admin Panel API Coverage Map

## UI Routes ↔ Backend Endpoints

| Ruta UI (SvelteKit) | Método | Endpoint core-api | Estado |
|---|---|---|---|
| / | GET | /api/auth/me | ✅ conectado |
| /dashboard | — | — | ❌ sin backend |
| /exports | GET | /api/exports${query.size ?  | ✅ conectado |
| /exports | DELETE | /api/exports/:id | ✅ conectado |
| /exports/[id]/download | GET | /api/exports/:id/download | ✅ conectado |
| /login | POST | /api/auth/logout | ✅ conectado |
| /login | POST | /api/auth/login | ✅ conectado |
| /onboarding/researcher | POST | /api/onboarding/researcher | ✅ conectado |
| /onboarding/system | POST | /api/onboarding/system | ✅ conectado |
| /researchers | GET | /api/researchers:id | ✅ conectado |
| /researchers/new | — | — | ❌ sin backend |
| /researchers/[id] | GET | /api/researchers/:id | ✅ conectado |
| /researchers/[id] | GET | /api/researchers/:id/studies | ✅ conectado |
| /session-logs | GET | /api/session-logs${query.size ?  | ✅ conectado |
| /session-logs/[id] | GET | /api/session-logs/:id/summary | ✅ conectado |
| /session-logs/[id] | GET | /api/session-logs/:id?:id | ✅ conectado |
| /settings | — | — | ❌ sin backend |
| /settings/components | — | — | ❌ sin backend |
| /settings/devices | GET | /api/devices${query.size ?  | ✅ conectado |
| /settings/devices | GET | /api/devices/:id | ✅ conectado |
| /settings/system | GET | /api/system/carla/:id | ⚠️ parcial |
| /settings/users | — | — | ❌ sin backend |
| /startup | — | — | ❌ sin backend |
| /user-studies | — | — | ❌ sin backend |
| /user-studies/new | — | — | ❌ sin backend |
| /user-studies/[id] | — | — | ❌ sin backend |
| /user-studies/[id]/active-study | GET | /api/studies/:id/sessions | ✅ conectado |
| /user-studies/[id]/active-study | GET | /api/studies/:id/layouts | ✅ conectado |
| /user-studies/[id]/active-study | GET | /api/studies/:id/layouts/:id | ✅ conectado |
| /user-studies/[id]/active-study | GET | /api/studies/:id/sessions/:id | ✅ conectado |
| /user-studies/[id]/active-study | POST | /api/studies/:id/sessions/:id/notes | ✅ conectado |
| /user-studies/[id]/active-study | POST | /api/studies/:id/sessions/:id/triggers | ✅ conectado |
| /user-studies/[id]/active-study | POST | /api/studies/:id/sessions/:id/:id | ✅ conectado |
| /user-studies/[id]/active-study | POST | /api/system/overlay/windows/open | ✅ conectado |
| /user-studies/[id]/carla-config | GET | /api/studies/:id/carla-config | ✅ conectado |
| /user-studies/[id]/carla-config | PUT | /api/studies/:id/carla-config | ✅ conectado |
| /user-studies/[id]/conditions | GET | /api/studies/:id/conditions | ✅ conectado |
| /user-studies/[id]/conditions | POST | /api/studies/:id/conditions | ✅ conectado |
| /user-studies/[id]/conditions | PUT | /api/studies/:id/conditions/:id | ✅ conectado |
| /user-studies/[id]/conditions | DELETE | /api/studies/:id/conditions/:id | ✅ conectado |
| /user-studies/[id]/overview | GET | /api/studies/:id | ✅ conectado |
| /user-studies/[id]/participant-view | GET | /api/studies/:id/layouts | ✅ conectado |
| /user-studies/[id]/participant-view | GET | /api/studies/:id/layouts/:id | ✅ conectado |
| /user-studies/[id]/participant-view | PUT | /api/studies/:id/layouts/:id | ✅ conectado |
| /user-studies/[id]/participant-view | POST | /api/studies/:id/layouts | ✅ conectado |
| /user-studies/[id]/participant-view | POST | /api/system/overlay/windows/open | ✅ conectado |
| /user-studies/[id]/participant-view | PUT | /api/studies/:id/layouts | ✅ conectado |
| /user-studies/[id]/participant-view | POST | /api/system/overlay/windows/close | ✅ conectado |
| /user-studies/[id]/participants | GET | /api/studies/:id/participants | ✅ conectado |
| /user-studies/[id]/participants | POST | /api/studies/:id/participants | ✅ conectado |
| /user-studies/[id]/sensors | GET | /api/studies/:id/sensor-config | ✅ conectado |
| /user-studies/[id]/sensors | PUT | /api/studies/:id/sensor-config | ✅ conectado |
| /user-studies/[id]/sessions | GET | /api/studies/:id/sessions | ✅ conectado |
| /user-studies/[id]/sessions | GET | /api/studies/:id/participants | ✅ conectado |
| /user-studies/[id]/sessions | GET | /api/studies/:id/conditions | ✅ conectado |
| /user-studies/[id]/sessions | POST | /api/studies/:id/sessions/:id/:id | ✅ conectado |
| /user-studies/[id]/sessions | POST | /api/studies/:id/sessions | ✅ conectado |
| exports/[id] | — | — | ❌ sin backend |
| onboarding | — | — | ❌ sin backend |

## Endpoints Huérfanos

| Endpoint core-api | Método | Consumidor conocido |
|---|---|---|
| /api/health | GET | ninguno en admin-panel |
| /api/system/bootstrap | GET | ninguno en admin-panel |
| /api/onboarding/status | GET | ninguno en admin-panel |
| /api/onboarding/complete | POST | ninguno en admin-panel |
| /api/auth/refresh | POST | ninguno en admin-panel |
| /api/system/components | GET | ninguno en admin-panel |
| /api/system/component-status | POST | ninguno en admin-panel |
| /api/system/ready | POST | ninguno en admin-panel |
| /api/system/shutdown | POST | ninguno en admin-panel |
| /api/system/carla/test-connection | GET | ninguno en admin-panel |
| /api/system/configuration | GET | ninguno en admin-panel |
| /api/system/configuration | PUT | ninguno en admin-panel |
| /api/dashboard | GET | ninguno en admin-panel |
| /api/studies | GET | ninguno en admin-panel |
| /api/studies | POST | ninguno en admin-panel |
| /api/studies/:id | PUT | ninguno en admin-panel |
| /api/studies/:id/status | PUT | ninguno en admin-panel |
| /api/studies/:studyId/researchers | GET | ninguno en admin-panel |
| /api/studies/:studyId/researchers | POST | ninguno en admin-panel |
| /api/studies/:studyId/researchers | PUT | ninguno en admin-panel |
| /api/studies/:studyId/researchers/:researcherId | DELETE | ninguno en admin-panel |
| /api/studies/:studyId/participants/:id | PUT | ninguno en admin-panel |
| /api/studies/:studyId/participants/:id/assign-condition | PUT | ninguno en admin-panel |
| /api/studies/:studyId/conditions/reorder | PUT | ninguno en admin-panel |
| /api/studies/:studyId/sessions/:id/start | POST | ninguno en admin-panel |
| /api/studies/:studyId/sessions/:id/pause | POST | ninguno en admin-panel |
| /api/studies/:studyId/sessions/:id/resume | POST | ninguno en admin-panel |
| /api/studies/:studyId/sessions/:id/complete | POST | ninguno en admin-panel |
| /api/studies/:studyId/sessions/:id/cancel | POST | ninguno en admin-panel |
| /api/carla/presets/maps | GET | ninguno en admin-panel |
| /api/carla/presets/weather | GET | ninguno en admin-panel |
| /api/carla/presets/vehicles | GET | ninguno en admin-panel |
| /api/carla/presets/sensors | GET | ninguno en admin-panel |
| /api/sensors/drivers | GET | ninguno en admin-panel |
| /api/studies/:studyId/layouts/:id | DELETE | ninguno en admin-panel |
| /api/widgets/catalogue | GET | ninguno en admin-panel |
| /api/sensors/status | GET | ninguno en admin-panel |
| /api/overlay/assets | GET | ninguno en admin-panel |
| /ws | GET | ninguno en admin-panel |
| /api/researchers | GET | ninguno en admin-panel |
| /api/researchers | POST | ninguno en admin-panel |
| /api/researchers/:id | PUT | ninguno en admin-panel |
| /api/researchers/:id | DELETE | ninguno en admin-panel |
| /api/studies/:id | DELETE | ninguno en admin-panel |
| /api/studies/:id/duplicate | POST | ninguno en admin-panel |
| /api/studies/:studyId/conditions/:id | GET | ninguno en admin-panel |
| /api/studies/:studyId/participants/:id | GET | ninguno en admin-panel |
| /api/studies/:studyId/participants/:id | DELETE | ninguno en admin-panel |
| /api/studies/:studyId/sessions/:id | PUT | ninguno en admin-panel |
| /api/studies/:studyId/sessions/:id | DELETE | ninguno en admin-panel |
| /api/carla/test-connection | POST | ninguno en admin-panel |
| /api/studies/:studyId/trigger-rules | GET | ninguno en admin-panel |
| /api/studies/:studyId/trigger-rules | PUT | ninguno en admin-panel |
| /api/devices | GET | ninguno en admin-panel |
| /api/devices | POST | ninguno en admin-panel |
| /api/devices/:id | PUT | ninguno en admin-panel |
| /api/devices/:id | DELETE | ninguno en admin-panel |
| /api/devices/:id/status | GET | ninguno en admin-panel |
| /api/users | GET | ninguno en admin-panel |
| /api/users | POST | ninguno en admin-panel |
| /api/users/:id | GET | ninguno en admin-panel |
| /api/users/:id | PUT | ninguno en admin-panel |
| /api/users/:id | DELETE | ninguno en admin-panel |
| /api/exports | GET | ninguno en admin-panel |
| /api/exports | POST | ninguno en admin-panel |
| /api/exports/:id | GET | ninguno en admin-panel |
| /api/session-logs | GET | ninguno en admin-panel |
| /api/session-logs/:sessionId | GET | ninguno en admin-panel |
| /api/system/process-manager/status | GET | ninguno en admin-panel |
| /api/system/carla/:action | POST | ninguno en admin-panel |
| /api/system/overlay/reload | POST | ninguno en admin-panel |
| /api/system/overlay/displays | GET | ninguno en admin-panel |
| /api/system/overlay/configure | POST | ninguno en admin-panel |
| /api/system/overlay/windows/update | POST | ninguno en admin-panel |
| /api/system/restart | POST | ninguno en admin-panel |

## Hallazgos

- **Desconexión SvelteKit**: Múltiples rutas de UI tienen un directorio pero no realizan llamadas explícitas a un backend en la fase de render (ssr) o no tienen lógica en `+page.server.ts`.
- **Endpoints Huérfanos**: Existen 75 endpoints en `core-api` que no tienen un consumidor directo identificable en el código fuente de `admin-panel` mediante las funciones `apiAction` o `apiRequest`.
- **Cobertura Parcial**: Las llamadas marcadas como `⚠️ parcial` indican que el endpoint llamado no se pudo emparejar con certeza con las definiciones de rutas exactas de `core-api`, lo cual puede indicar URLs hardcodeadas o diferencias en el formato de parámetros dinámicos.
- **Dependencia Fuerte**: La gran mayoría de interacciones de mutación (`POST`, `PUT`, `DELETE`) están bien mapeadas a sus equivalentes del backend a través de form actions y el uso de `apiAction`.
