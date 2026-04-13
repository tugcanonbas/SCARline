# AGENTS.md

Welcome to the SCARline repository. This file is the primary navigation guide for AI coding agents contributing to the platform.

## Product And Architecture Source Of Truth

SCARline is a research operations platform for automotive UX/HCI studies. It integrates driving simulators such as CARLA, web interfaces, overlay widgets, hardware sensors, RabbitMQ messaging, and PostgreSQL-backed operational state.

- **[IMPLEMENTATION_REPORT.md](./product-requirements/IMPLEMENTATION_REPORT.md)** — Comprehensive codebase implementation assessment showing 92% platform completeness, detailed component status, remaining risks, and finalization roadmap.

## Repo Map

- `apps/admin-panel/`: SvelteKit Admin Panel mounted at `/admin`.
- `apps/overlay-web/`: browser overlay runtime and widget gateway.
- `apps/desktop-overlay/`: Electron transparent overlay shell.
- `services/core-api/`: Fastify CoreAPI, auth, persistence, REST, WebSocket fanout, and command/event handling.
- `services/sim-bridge/`: simulator adapter WebSocket bridge plus RabbitMQ command/event integration.
- `packages/contracts/`: shared TypeScript/Zod contracts for REST DTOs, RabbitMQ, WebSocket, layout, widgets, process-manager IPC, and enums.
- `python/io-client/`: hardware/sensor client and driver host.
- `python/carla-client/`: CARLA adapter client.
- `python/mock-simulator/`: deterministic simulator for development and tests.
- `widgets/`: static overlay widget catalogue with `components/<widget-id>/`, shared `images/`, shared `icons/`, and `dist.css`.
- `infra/`: database schema/scripts, Nginx routing, RabbitMQ definitions, and process-manager IPC.
- `tests/`: contract, infra, service, simulator, Admin Panel, and integration tests.
- `.ai/skills/`: project-specific agent rules that should be read when working in a matching domain.

## AI Skills

Use the relevant skill before editing a domain. The local project skills are:

- `.ai/skills/admin-panel`: Admin Panel frontend rules, route loaders, RBAC, and Svelte stores.
- `.ai/skills/coreapi-backend`: Fastify endpoint, Zod validation, auth, and PostgreSQL query rules.
- `.ai/skills/rabbitmq-cqrs`: RabbitMQ envelope, command/event separation, routing, and queue rules.
- `.ai/skills/sensor-driver`: Python sensor driver rules for physical hardware.
- `.ai/skills/sim-adapter`: simulator adapter WebSocket protocol rules.
- `.ai/skills/widget-developer`: static overlay widget and `widget.json` requirements.
- `.ai/skills/tailwindcss-v4`: Tailwind v4 CSS-first theme rules.
- `.ai/skills/sveltekit-v5`: Svelte 5 runes and SvelteKit conventions.
- `.ai/skills/git-conventions`: Conventional Commits v1.0.0 rules.

## Runtime Commands

The whole platform is orchestrated by the OS-side Process Manager script.

- Start production-style stack: `./scarline start`
- Start development stack with hot reload: `./scarline start --dev`
- Start without CARLA host launch: `./scarline start --no-carla`
- Start without overlay shell: `./scarline start --no-overlay`
- Start without opening the browser: `./scarline start --no-browser`
- Start widget test mode: `./scarline start --widget-test`
- Stop gracefully: `./scarline stop`
- Restart: `./scarline restart`
- Check health: `./scarline status`
- View logs: `./scarline logs [component]`
- Reset database: `./scarline reset-db`

Root package scripts:

- Build all workspace packages: `pnpm build`
- Check all workspace packages: `pnpm check`
- Lint all workspace packages: `pnpm lint`
- Test all workspace packages: `pnpm test`
- Run platform E2E: `pnpm test:e2e`

## Frontend Navigation

Admin Panel:

- App shell: `apps/admin-panel/src/routes/+layout.svelte`
- Root route guard and bootstrap state: `apps/admin-panel/src/routes/+layout.server.ts`
- Request/auth hook: `apps/admin-panel/src/hooks.server.ts`
- Global design system: `apps/admin-panel/src/app.css`
- Internal path helper for `/admin`: `apps/admin-panel/src/lib/paths.ts`
- Server helpers: `apps/admin-panel/src/lib/server/api.ts`, `apps/admin-panel/src/lib/server/bootstrap.ts`, `apps/admin-panel/src/lib/server/rbac.ts`
- Realtime store: `apps/admin-panel/src/lib/stores/realtime.ts`
- Shared UI primitives: `apps/admin-panel/src/lib/components/PageHeader.svelte`, `SurfaceCard.svelte`, `StatusBadge.svelte`, `StudyTabs.svelte`, and `KeyValueGrid.svelte`

Admin Panel route surfaces:

- Startup/login/onboarding: `apps/admin-panel/src/routes/startup/`, `login/`, `onboarding/system/`, and `onboarding/researcher/`
- Dashboard: `apps/admin-panel/src/routes/dashboard/`
- Studies: `apps/admin-panel/src/routes/user-studies/`
- Study workspace: `apps/admin-panel/src/routes/user-studies/[id]/overview/`, `participants/`, `conditions/`, `sessions/`, `carla-config/`, `sensors/`, `participant-view/`, and `active-study/`
- Session logs: `apps/admin-panel/src/routes/session-logs/` and `apps/admin-panel/src/routes/session-logs/[id]/`
- Researchers: `apps/admin-panel/src/routes/researchers/`, `researchers/new/`, and `researchers/[id]/`
- Settings: `apps/admin-panel/src/routes/settings/system/`, `settings/users/`, `settings/devices/`, and `settings/components/`
- Documentation: `apps/admin-panel/src/routes/documentation/`
- Exports: `apps/admin-panel/src/routes/exports/` and `apps/admin-panel/src/routes/exports/[id]/download/+server.ts`

Overlay frontend surfaces:

- Overlay web server: `apps/overlay-web/src/server.ts`
- Overlay browser runtime: `apps/overlay-web/public/app.js`
- Electron transparent shell: `apps/desktop-overlay/src/main.mjs`
- Widget metadata and markup: `widgets/components/*/widget.json` and `widgets/components/*/index.html`
- Shared widget assets: `widgets/images/*`, `widgets/icons/*`, and `widgets/dist.css`

## Backend Navigation

CoreAPI:

- Main boot path: `services/core-api/src/index.ts`
- Route registration: `services/core-api/src/lib/api.ts`
- Auth and token handling: `services/core-api/src/lib/auth.ts`
- Command publication/handling: `services/core-api/src/lib/commands.ts`
- Component status: `services/core-api/src/lib/component-status.ts`
- Config loading: `services/core-api/src/lib/config.ts`
- Data access helpers: `services/core-api/src/lib/data.ts`
- PostgreSQL client/query layer: `services/core-api/src/lib/db.ts`
- Event persistence/fanout: `services/core-api/src/lib/events.ts`
- PRD route coverage support: `services/core-api/src/lib/prd-routes.ts`
- RabbitMQ manager: `services/core-api/src/lib/rabbit.ts`
- WebSocket hub: `services/core-api/src/lib/websocket-hub.ts`
- Widget catalogue scanning: `services/core-api/src/lib/widget-catalogue.ts`

Sim-Bridge:

- Main boot path: `services/sim-bridge/src/index.ts`
- Adapter registry: `services/sim-bridge/src/lib/adapter-registry.ts`
- Config loading: `services/sim-bridge/src/lib/config.ts`
- RabbitMQ manager: `services/sim-bridge/src/lib/rabbit.ts`

Python runtime:

- I/O client entrypoint: `python/io-client/scarline_io/__main__.py`
- I/O drivers: `python/io-client/scarline_io/drivers/base.py`, `logitech_g29.py`, `usb_camera.py`, `eye_tracker.py`, and `heart_rate.py`
- CARLA client entrypoint: `python/carla-client/scarline_carla/__main__.py`
- Mock simulator entrypoint: `python/mock-simulator/scarline_mock/__main__.py`
- Mock scenario catalogue: `python/mock-simulator/scenarios.yaml`

## Contracts, Data, And Infrastructure

Contracts:

- Public contract barrel: `packages/contracts/src/index.ts`
- REST DTO schemas: `packages/contracts/src/api.ts`
- RabbitMQ exchanges, queues, envelopes, routing keys, and command/event enums: `packages/contracts/src/rabbitmq.ts`
- WebSocket channels and payloads: `packages/contracts/src/websocket.ts`
- Widget metadata: `packages/contracts/src/widget.ts`
- Layout/zone/widget instance schemas: `packages/contracts/src/layout.ts`
- Process Manager IPC schemas: `packages/contracts/src/process-manager.ts`
- Shared enums for roles, states, components, health, and widgets: `packages/contracts/src/enums.ts`

Infrastructure:

- Compose files: `docker-compose.yml`, `docker-compose.dev.yml`, and `docker-compose.widget-test.yml`
- Linux/macOS launcher: `scarline`
- Windows launcher parity: `scarline.ps1`
- Example local config: `.scarline.yaml.example`
- PostgreSQL schema: `infra/database/schema.sql`
- Database bootstrap/reset scripts: `infra/database/scripts/apply_schema.sh` and `infra/database/scripts/reset_dev.sh`
- Development seed data: `infra/database/seed/seed_dev.sql`
- RabbitMQ topology: `infra/rabbitmq/definitions.json`
- Nginx single-domain routing: `infra/nginx/default.conf`
- Process Manager IPC server: `infra/process-manager/ipc_server.py`

## Tests And Verification

Targeted tests:

- Admin Panel route/navigation/RBAC coverage: `node --test tests/admin-panel/routes.test.mjs`
- Shared contracts and widget metadata: `node --test tests/contracts/contracts.test.mjs`
- Infra, compose, schema, Nginx, and process-manager topology: `node --test tests/infra/topology.test.mjs`
- CoreAPI, RabbitMQ, Sim-Bridge, and CARLA command behavior: `node --test tests/services/core-api.test.mjs`
- Mock simulator: `node --test tests/simulator/mock-simulator.test.mjs`
- I/O client: `node --test tests/simulator/io-client.test.mjs`
- Full platform E2E: `node --test tests/integration/platform-e2e.test.mjs`

Useful focused builds:

- Admin Panel build: `pnpm --dir apps/admin-panel build`
- CoreAPI build: `pnpm --dir services/core-api build`
- Sim-Bridge build: `pnpm --dir services/sim-bridge build`
- Overlay Web build: `pnpm --dir apps/overlay-web build`
- Contracts build: `pnpm --dir packages/contracts build`

## Architectural Boundaries

1. Backend service-to-service integration must use RabbitMQ CQRS. Do not add synchronous REST calls between backend services for multi-domain state changes.
2. CoreAPI owns persistence, auth, REST routes, WebSocket fanout, session state transitions, and command publication.
3. Frontends connect to CoreAPI through REST and WebSocket only. The Overlay must not consume RabbitMQ directly.
4. Sim-Bridge owns simulator adapter binding and forwards simulator commands/events through RabbitMQ.
5. Python CARLA, mock simulator, and I/O clients publish/consume SCARline events through their documented adapters; they do not own UI or CoreAPI state.
6. Overlay widgets must remain static HTML/CSS/vanilla JS and use the injected `SCARline` widget API. Do not add widget build steps.
7. Admin Panel route guards and RBAC live in SvelteKit server loaders/actions. Do not bypass them with client-only checks.
8. All commits must be atomic and follow `feat/fix/chore/style/test/docs(scope): message`.

## Agent Workflow Notes

- Check `git status --short` before editing. This repository often has active local work; never revert or overwrite unrelated changes.
- Avoid generated/runtime folders unless explicitly required: `node_modules/`, `.svelte-kit/`, `build/`, `dist/`, `.scarline-runtime/`, `__pycache__/`.
- Use `rg` and `rg --files` for navigation.
- Keep contract changes synchronized across `packages/contracts/`, CoreAPI, services, tests, and PRD docs.
- For Admin Panel UI work, preserve loaders, actions, API calls, auth redirects, route paths, and state flow. Prefer shared styles/components over page-specific rewrites.
- For Tailwind v4 work, configure theme values in `apps/admin-panel/src/app.css`; do not add `tailwind.config.*`.
- For links inside the Admin Panel, preserve the `/admin` base path by using `apps/admin-panel/src/lib/paths.ts`.
- For `./scarline start --no-carla`, host CARLA binary validation should be skipped while the rest of the stack and mock simulator can boot.
- Linux Process Manager IPC uses `/tmp/scarline.sock`; macOS uses TCP fallback on `127.0.0.1:4098`.
- `localhost:8088` is the single public Nginx entry point and routes `/admin`, `/api`, `/ws`, `/overlay`, `/docs`, `/rabbitmq`, and legacy redirects.
