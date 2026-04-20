# Local Development

Use the workspace root scripts and the launcher rather than inventing ad hoc startup commands.

## Core Commands

- `pnpm build`
- `pnpm check`
- `pnpm lint`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm docs:dev`
- `pnpm docs:build`

## Focused Builds

- `pnpm --dir apps/admin-panel build`
- `pnpm --dir services/core-api build`
- `pnpm --dir services/sim-bridge build`
- `pnpm --dir apps/overlay-web build`
- `pnpm --dir packages/contracts build`

## Runtime Development Modes

Prefer:

- `./scarline start --dev` for iterative work
- `./scarline start --no-carla` when you need the platform without a CARLA host dependency
- `./scarline start --widget-test` when the focus is widget validation

## Builder Workflow

1. inspect current contracts and route boundaries
2. implement the narrowest safe change
3. update impacted docs
4. run targeted tests first
5. validate one relevant runtime mode
