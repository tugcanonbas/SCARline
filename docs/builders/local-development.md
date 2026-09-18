# Local Development

## Root Scripts

| Script | Does |
| --- | --- |
| `npm run build` | Builds the widget CSS, then every workspace in dependency order |
| `npm run build:cli` | Contracts and CLI only |
| `npm run build:core-api` | Contracts and CoreAPI |
| `npm run build:sim-bridge` | Contracts, Sim-Bridge, Mock Simulator |
| `npm run build:admin-panel` | Contracts and Admin Panel |
| `npm run build:overlays` | Contracts, Overlay Web, Desktop Overlay |
| `npm run build:docs` | This documentation site |
| `npm run check` | Widget CSS check, then `typecheck` and `test` in every workspace |
| `npm run test:e2e` | Isolated Playwright end-to-end run |
| `npm run test:widgets` | Chromium and Electron widget suites |
| `npm run package:cli` | Produces the installable CLI tarball |

`npm install` runs `postinstall`, which builds the contracts and CLI, builds the desktop
overlay, and links `scarline` globally.

## Dev Servers

Each service has a watch-mode entry point. They expect the infrastructure to be running,
so start the stack first — or at least `database` and `rabbitmq`.

| Script | Service |
| --- | --- |
| `npm run dev:core-api` | CoreAPI |
| `npm run dev:admin-panel` | Admin Panel (Vite, port 5173) |
| `npm run dev:overlay-web` | Overlay Web |
| `npm run dev:sim-bridge` | Sim-Bridge |
| `npm run dev:mock-simulator` | Mock Simulator |
| `npm run dev:desktop-overlay` | Electron overlay host |
| `npm run dev:cli -- <args>` | CLI without the global link |
| `npm run dev -w @scarline/docs` | Documentation site on port 4040 |

A practical hybrid: run the full stack with `scarline start`, stop the one container you
are working on (`docker compose -p scarline stop core-api`), and run its dev server on
the same port.

## Working Per Area

| Changing | Start with | Then |
| --- | --- | --- |
| A wire shape | `packages/contracts` | Rebuild contracts, update both sides |
| A REST route | `services/core-api/src/routes/` | Contract schema, route, Admin Panel consumer |
| Session lifecycle | `services/core-api/src/sessions/service.ts` | Downstream components that must acknowledge |
| A UI screen | `apps/admin-panel/src/routes/` | Keep guards in `+page.server.ts` |
| A widget | `widgets/components/<id>/` | Refresh the catalogue, test with a preview launch |
| An adapter | `services/mock-simulator` or `services/carla-client` | Adapter protocol schemas |
| A sensor driver | `services/io-client/` plus a manifest | Refresh the sensor catalogue |
| The schema | `infra/database/migrations/` | A new forward-only migration |

## Contracts First

`packages/contracts` is the shared vocabulary. Both producer and consumer parse against
the same Zod schema, so a mismatch is a runtime error at the boundary rather than a
silent misinterpretation.

```bash
npm run build -w @scarline/contracts
```

`packages/contracts/scripts/generate-json-schemas.mjs` emits JSON Schema for every entry
in `jsonSchemaSources`, which is how non-TypeScript services validate the same shapes.

Most schemas are `.strict()`. Adding a field to a request body means adding it to the
schema; otherwise it is rejected as unexpected.

## Widget CSS

`widgets/dist.css` is a generated Tailwind build committed to the repository, because
widgets are static and have no build step of their own.

```bash
npm run widgets:build-css     # regenerate after changing widget markup or tailwind-source.css
npm run widgets:check-css     # fail if it is out of date
```

`npm run check` runs the check variant, so a stale `dist.css` fails CI.

## Validation Loop

Use the narrowest check that proves the change, then widen:

| Changed | Minimum |
| --- | --- |
| Docs only | `npm run typecheck -w @scarline/docs` |
| Contracts | `npm test -w @scarline/contracts`, then the affected services |
| CoreAPI | `npm test -w @scarline/core-api` and one runtime path |
| Admin Panel | `npm run check -w @scarline/admin-panel` and one interactive path |
| Widgets | `npm run test:widgets` |
| Sim-Bridge or adapters | `npm test -w @scarline/sim-bridge -w @scarline/mock-simulator` |
| IO Client | `python -m pytest services/io-client/test` inside the venv |
| Anything cross-cutting | `npm run check` and `npm run test:e2e` |

## Before Opening A Pull Request

```bash
npm run check
```

Then validate one real runtime path — usually `scarline start --no-sim` plus the screen
or flow you touched — and update the affected documentation page in `docs/`.

## Read Next

- [Contracts And CoreAPI](/builders/contracts-and-core-api)
- [Testing](/builders/testing)
- [Editing These Docs](/builders/documentation)
