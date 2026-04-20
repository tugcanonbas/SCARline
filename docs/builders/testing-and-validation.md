# Testing And Validation

SCARline already has test coverage by subsystem. Use the narrowest test set that proves the change first, then broaden if the change crosses boundaries.

## Main Verification Commands

- `pnpm test`
- `pnpm check`
- `pnpm build`
- `pnpm test:e2e`

## Targeted Tests

- `node --test tests/admin-panel/routes.test.mjs`
- `node --test tests/contracts/contracts.test.mjs`
- `node --test tests/infra/topology.test.mjs`
- `node --test tests/services/core-api.test.mjs`
- `node --test tests/simulator/mock-simulator.test.mjs`
- `node --test tests/simulator/io-client.test.mjs`
- `node --test tests/integration/platform-e2e.test.mjs`

## Validation Pattern

| Change area | Minimum validation |
| --- | --- |
| Docs only | `pnpm --dir docs build` |
| Contracts | contract tests plus affected service/client checks |
| CoreAPI | relevant service tests, type checks, and one runtime path |
| Admin Panel | route tests and one interactive validation path |
| Overlay/widgets | widget validation path and runtime sanity check |
| Infra/routing | topology tests and startup validation |
