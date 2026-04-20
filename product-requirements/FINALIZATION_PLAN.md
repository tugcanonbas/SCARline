# SCARline Finalization Plan

## Summary

Finalize SCARline against the product requirements without adding, skipping, or redefining features. Static implementation finalization is complete for the areas listed below; live runtime acceptance is still pending because Docker base image metadata resolution blocked stack startup on this host.

Current verification:
- `pnpm test` passes.
- `pnpm check` passes with zero Svelte diagnostics.
- `pnpm build` passes across all workspace packages.
- Targeted Admin, infra, mock simulator, and I/O client tests pass.
- `pnpm test:e2e` skips until the public gateway is running.
- `./scarline start --no-carla --no-overlay --no-browser` was attempted, but Docker stalled while resolving `node:22-alpine` and `python:3.11-slim`; the partial startup was canceled and cleaned up with `./scarline stop`.

## Finalization Work

1. **Requirements Baseline And Traceability**
   - Completed: `REQUIREMENTS_TRACEABILITY.md` now maps every requirements document to implementation surfaces, differentiated status, and remaining evidence.
   - Completed: `IMPLEMENTATION_REPORT.md` no longer claims 100% production readiness and now records measured verification evidence.
   - Completed: documented drift was corrected for widget catalogue categories/specs, missing study widgets, mock simulator scenarios, I/O command taxonomy, and mock/I/O health endpoints.

2. **Blocking Build And Contract Alignment**
   - Completed: Sim-Bridge now uses the Fastify 4-compatible websocket plugin line and compiles cleanly.
   - Completed: root `pnpm check` and `pnpm build` pass.
   - Completed: widget metadata categories and I/O command taxonomy were reconciled with contracts/docs while preserving CoreAPI and RabbitMQ CQRS boundaries.

3. **CoreAPI, Database, And RabbitMQ Reliability**
   - Completed: CoreAPI RBAC was tightened for researchers, devices, study design, active-study controls, and session notes.
   - Completed: active-study operator notes now persist to session records instead of local page state.
   - Completed: static tests cover database foundation tables, RabbitMQ topology, queue durability/DLX, command/event taxonomy, outbox/realtime hardening, and session command acknowledgement paths.
   - Pending runtime evidence: live gateway E2E, RabbitMQ reconnect/dead-letter failure injection, and recovery validation after service restarts.

4. **Admin Panel Completion**
   - Completed: documented RBAC matrix is enforced in server loaders/actions and reflected in sidebar navigation visibility.
   - Completed: CARLA configuration, condition parameters, sensor driver configuration, active-study operation, and persisted timestamped notes were expanded using existing workflows.
   - Completed: Svelte 5 diagnostics are clean with zero warnings from `pnpm check`.
   - Pending runtime evidence: browser walkthrough of the full researcher/operator flow through the gateway.

5. **Overlay, Widgets, Simulators, And I/O**
   - Completed: all 24 widget metadata categories are normalized to the documented taxonomy and catalogue specs include all widgets.
   - Completed: overlay validation now accepts only canonical product categories, and tests enforce static widgets with no direct `fetch` or custom WebSocket use.
   - Completed: mock simulator has documented scenarios and a `/health` endpoint.
   - Completed: I/O client has a `/health` endpoint, driver status/degraded handling, and explicit sensor configuration surfaces.
   - Pending external/runtime evidence: overlay web/Electron visual smoke, real CARLA host smoke, and physical sensor smoke.

6. **Infrastructure And Process Manager**
   - Completed: Docker topology and Nginx route tests pass; mock simulator and I/O client healthchecks were added.
   - Completed: launcher/process-manager static tests pass, including command parity, IPC path behavior, compose wrapper, prerequisites, and `--no-carla` CARLA validation skipping.
   - Pending runtime evidence: full `./scarline start --no-carla --no-overlay --no-browser` readiness and public gateway routing once Docker can resolve/build required images.

## Acceptance Tests

- Passed: `pnpm test`, `pnpm check`, and `pnpm build` at repo root.
- Passed: targeted Admin route/RBAC, infra topology, mock simulator, and I/O client tests.
- Pending: live E2E through the public gateway using `./scarline start --no-carla --no-overlay --no-browser`.
- Pending: overlay web and Electron smoke tests verifying visible widgets, nonblank rendering, lifecycle updates, and window placement.
- Pending: CARLA host smoke test with a supported CARLA server.
- Pending: sensor smoke tests for connected and degraded hardware states.
- Pending: recovery tests covering CoreAPI restart, RabbitMQ reconnect, simulator disconnect/reconnect, overlay reconnect, and session recovery without data loss.

## Assumptions

- No new product features are introduced; implementing a documented requirement that is currently incomplete is in scope.
- The mock simulator is acceptable as the default demo fallback when CARLA is unavailable, but full platform sign-off still requires a real CARLA validation pass.
- Existing local user changes must be preserved; unrelated worktree changes are not reverted.
