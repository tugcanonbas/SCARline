# Testing

## Everything

```bash
npm run check
```

That runs the widget CSS check, then `typecheck` and `test` in every workspace. It is the
gate before a pull request.

## Per Workspace

Each TypeScript workspace runs the Node test runner over `test/*.test.ts` through `tsx`,
building first:

```bash
npm test -w @scarline/contracts
npm test -w @scarline/cli
npm test -w @scarline/core-api
npm test -w @scarline/sim-bridge
npm test -w @scarline/mock-simulator
npm test -w @scarline/admin-panel
npm test -w @scarline/overlay-web
npm test -w @scarline/desktop-overlay
npm test -w @scarline/docs
```

Filter within a workspace with the runner's own flags:

```bash
node --import tsx --test --test-name-pattern "readiness" services/core-api/test/*.test.ts
```

## What Each Suite Covers

| Workspace | Covers |
| --- | --- |
| `contracts` | Schema acceptance and rejection, widget manifest normalisation, IO shapes |
| `cli` | Command parsing, setup and lifecycle behaviour with a stubbed Compose runner |
| `core-api` | Routes, auth and WebSocket auth, readiness, session events and queueing, layout bulk save, session windows, overlay runtime and hosts, widget data and interactions, sensors, telemetry |
| `sim-bridge` | Adapter registry, command journal, socket protocol |
| `mock-simulator` | Journal replay and protocol ordering |
| `admin-panel` | Route guards, RBAC, server-side helpers |
| `overlay-web` | Asset serving and containment, the widget bridge |
| `desktop-overlay` | Window geometry and reconnect reliability |
| `docs` | Navigation and internal links resolve |

Unit suites do not require Docker. `core-api` tests build the app against stubbed
runtimes rather than a live database.

## Python

```bash
.runtime/io-client/venv/bin/python -m pytest services/io-client/test
```

Covers the driver catalogue, driver behaviour, journaling, models, the real-time control
path, and integration. `pytest-asyncio` is in auto mode. The CARLA client has its own
suite under `services/carla-client/test`.

## End To End

```bash
npm run test:e2e
```

`scripts/run-isolated-e2e.mjs` builds CoreAPI, then creates a **fully isolated** stack:

- a temporary directory with its own `compose.yml`, `config.yml`, and `.env`
- freshly reserved free ports for every service
- a unique Compose project name, so it cannot collide with a running `scarline` stack
- freshly generated secrets

It brings the stack up, runs the Playwright suites against it, and tears it down. Your
development stack, database, and `.runtime/` are untouched.

Suites under `tests/e2e/`:

| Spec | Covers |
| --- | --- |
| `admin-panel.spec.ts` | Bootstrap sign-in, forced password change, RBAC, study setup, sessions, logs, exports, accessibility with axe |
| `admin-routing.spec.ts` | Route guards and redirects |
| `widget-runtime.spec.ts` | Widget rendering and binding delivery in Chromium |
| `widget-interactions.spec.mts` | Widget actions and results in Electron |

Playwright config: Chromium, serial (`workers: 1`), no retries, 60-second test timeout,
traces and screenshots retained on failure.

## Widgets Only

```bash
npm run test:widgets
```

Builds contracts and Overlay Web, then runs the two widget suites against real widgets,
the renderer HTTP routes, and the WebSocket hub with fixture study data.

## Choosing The Right Level

| Changed | Run |
| --- | --- |
| A contract schema | `contracts`, then every consumer workspace |
| A CoreAPI route | `core-api`, then one manual runtime path |
| Session lifecycle | `core-api`, `sim-bridge`, `mock-simulator`, then `test:e2e` |
| An Admin Panel screen | `admin-panel`, then click through it |
| A widget | `test:widgets` |
| A sensor driver | `pytest services/io-client/test` |
| The CLI | `cli`, then a real `scarline start --no-sim` |
| The schema | `core-api`, then apply the migration to a fresh database |
| Docs | `npm run typecheck -w @scarline/docs` and `npm run build:docs` |

## Writing Tests

- Use `node:test` and `node:assert/strict`; that is the convention everywhere.
- Prefer building the real app or service with injected stubs over mocking modules — the
  existing `core-api` suites show the pattern.
- Cover the failure path too. Most of this platform's value is in what it does when a
  component is missing.
- Keep suites independent; the runner may execute files in parallel.

## Read Next

- [Local Development](/builders/local-development)
- [Contracts And CoreAPI](/builders/contracts-and-core-api)
