# SCARline Requirements Traceability Matrix

> **Last reviewed**: 2026-04-17  
> **Purpose**: Track each requirements document against implemented surfaces, verification coverage, and remaining finalization work.

## Status Legend

| Status | Meaning |
| --- | --- |
| Aligned | Implementation and static verification currently match the requirement. |
| Partially aligned | Implementation exists and key gaps were closed, but live/runtime validation is still required. |
| Runtime blocked | Static verification passes, but acceptance depends on a runtime dependency that could not be completed on this host. |
| External validation required | The requirement depends on real hardware, CARLA host availability, or manual visual smoke checks outside static tests. |

## Matrix

| Requirement source | Implementation surfaces | Current status | Finalization action |
| --- | --- | --- | --- |
| `README.md` | Workspace layout, root scripts, `./scarline`, Docker Compose, apps/services/packages/tests | Partially aligned | Root `pnpm test`, `pnpm check`, and `pnpm build` pass; live launcher validation is still blocked by Docker image metadata resolution. |
| `product-requirements/README.md` | Product requirements index and component summaries | Aligned | Links now include `FINALIZATION_PLAN.md` and this traceability matrix; implementation report wording is measured, not aspirational. |
| `ADMIN_PANEL.md` | `apps/admin-panel/src/routes`, shared components, server loaders/actions, RBAC helpers | Partially aligned | Participant View display topology, per-widget display assignment, and widget window close controls are documented; full browser walkthrough remains part of live E2E. |
| `CARLA_SIMULATOR.md` | `python/carla-client`, CARLA config routes/actions, simulator command contracts | External validation required | Admin/CoreAPI CARLA config surface now carries documented controls; real-host CARLA binding and simulator smoke must be run with a supported CARLA installation. |
| `CORE_API.md` | `services/core-api/src/lib/api.ts`, auth, command handling, event handling, WebSocket hub | Partially aligned | Overlay display/window control endpoints and per-widget display launch behavior are documented; full route behavior still needs live gateway E2E and recovery validation. |
| `DATABASE_ENTITIES.md` | `infra/database/schema.sql`, seed data, CoreAPI data helpers | Aligned | Layout JSONB documentation now covers per-widget `targetDisplay`; static schema tests pass for foundation tables, columns, summaries, devices, exports, and activity log coverage. |
| `DATABASE.md` | PostgreSQL service, schema bootstrap, query layer | Runtime blocked | Schema and bootstrap are statically covered; ingestion/performance behavior must be validated during live stack and soak runs. |
| `DOCKER.md` | `docker-compose*.yml`, service Dockerfiles, Nginx, volumes, healthchecks | Runtime blocked | Mock simulator and I/O healthchecks were added and topology tests pass; live Compose startup is blocked by Docker base image metadata resolution on this host. |
| `IMPLEMENTATION_REPORT.md` | Measured repository status | Aligned | 100% production-ready claims were replaced with current evidence: static verification passes, live E2E remains blocked by Docker startup. |
| `IO_CLIENT.md` | `python/io-client/scarline_io`, driver host, RabbitMQ command/event flow | Partially aligned | Health endpoint, configured driver status, degraded behavior, plugin discovery, and baseline optional drivers are statically covered; physical hardware smoke remains external. |
| `MOCK_SIMULATOR.md` | `python/mock-simulator/scarline_mock`, scenarios YAML, Sim-Bridge adapter protocol | Partially aligned | Documented scenario catalogue and health endpoint were implemented and statically tested; live Sim-Bridge connection must be validated once Docker startup succeeds. |
| `OVERLAY_ENGINE.md` | `apps/overlay-web`, `apps/desktop-overlay`, overlay configure endpoints | External validation required | Per-widget display targeting, browser-popup sizing, shared runtime binding, and close/update control paths are documented; browser and Electron visual smoke checks remain required against a running stack. |
| `PRD.md` | Overall architecture, roles, access model, component boundaries | Partially aligned | Static tests confirm CQRS boundaries, RBAC surfaces, contracts, and build health; end-to-end researcher/participant showcase flow remains unproven. |
| `PROCESS_MANAGER.md` | `scarline`, `scarline.ps1`, `infra/process-manager/ipc_server.py` | Runtime blocked | Overlay display/window lifecycle proxy endpoints are documented; static launcher/process-manager tests pass and partial startup/stop cleanup worked; full `--no-carla` startup readiness is blocked by Docker image metadata resolution. |
| `RABBITMQ_EVENTS_AND_COMMANDS.md` | `packages/contracts/src/rabbitmq.ts`, CoreAPI/Sim-Bridge/I/O publishers and consumers | Aligned | I/O command routing docs were added and contract tests cover simulator, widget, export, sensor, and driver-status taxonomy. |
| `RABBITMQ.md` | RabbitMQ definitions, managers, confirms, DLX, reconnect logic | Partially aligned | Definitions and manager hardening are statically tested; dead-letter/reconnect behavior still needs runtime failure injection. |
| `SIM_BRIDGE.md` | `services/sim-bridge`, adapter registry, simulator command forwarding | Aligned | Fastify websocket build blocker is fixed; `pnpm check`, `pnpm build`, and Sim-Bridge static command/adapter tests pass. |
| `WIDGET_CATALOGUE.md` | `widgets/components/*`, CoreAPI scanner, overlay server metadata normalization | Aligned | All 24 widgets are documented, canonical categories were normalized, and catalogue tests enforce metadata/static-widget constraints. |
| `WIDGETS.md` | Static widget architecture, `widget.json`, shared assets, `SCARline` JS API | Aligned | Shared widget runtime and `dist.css` build flow are documented; widget metadata categories are canonical, each widget remains static HTML/JSON, and tests reject direct `fetch` or custom WebSocket usage. |

## Required Acceptance Evidence

- Root `pnpm test`, `pnpm check`, and `pnpm build` pass.
- Live mock-backed E2E works through `localhost:8088` with `./scarline start --no-carla --no-overlay --no-browser`.
- Overlay web and Electron smoke checks confirm visible, updating widgets and lifecycle behavior.
- Real CARLA smoke check is recorded when a supported CARLA host is available.
- Sensor smoke checks record both connected and degraded hardware behavior.
