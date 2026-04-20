# SCARline Implementation Report

> **Report Date**: April 17, 2026  
> **Scope**: Full repository status against product requirements and current implementation  
> **Overall Completeness**: Static finalization complete; live acceptance pending  
> **Assessment Status**: Build-clean and statically verified; runtime E2E blocked by Docker image metadata resolution

---

## Executive Summary

SCARline has the main architecture and implementation surfaces required by the product documents, and the current repository is build-clean and statically verified. The finalization pass closed measured gaps in build cleanliness, requirement traceability, documentation drift, RBAC alignment, simulator health coverage, widget catalogue consistency, Admin configuration surfaces, and active-study operator note persistence. The platform is not yet ready to be represented as fully production-ready because live end-to-end acceptance through the public gateway is still blocked by Docker image metadata resolution on this host.

The remaining finalization focus is runtime acceptance:
- **Gateway E2E**: Start the mock-backed stack and pass the public researcher/participant flow through `localhost:8088`.
- **Overlay Smoke**: Verify browser and Electron overlay rendering, lifecycle behavior, and window placement against a running stack.
- **External Validation**: Run CARLA host and physical sensor smoke checks where the required hardware/runtime exists.
- **Recovery Validation**: Exercise RabbitMQ reconnect, simulator disconnect/reconnect, service restart, and session recovery behavior.

### Current Platform Snapshot

| Area | Status | Notes |
| --- | --- | --- |
| Architecture compliance | Partially aligned | Static tests confirm CQRS boundaries and component ownership; live failure/recovery paths still need acceptance evidence. |
| Infrastructure (Docker/DB/MQ/Nginx) | Runtime blocked | Compose topology, healthchecks, and gateway config are statically verified; live startup is blocked by Docker image metadata resolution. |
| CoreAPI backend | Partially aligned | Build/tests pass and RBAC/session-note/sensor surfaces were tightened; full live gateway route behavior still needs E2E evidence. |
| Admin Panel | Partially aligned | RBAC, sidebar visibility, CARLA controls, condition overrides, sensor configuration, and persisted operator notes are implemented; browser walkthrough remains pending. |
| Overlay engine (web + desktop control path) | External validation required | Static overlay tests pass; browser/Electron visual smoke remains pending. |
| Process Manager / launcher parity | Runtime blocked | Static launcher/process-manager tests pass and partial startup/stop cleanup worked; full readiness is blocked by Docker image metadata resolution. |
| Python simulator clients | Partially aligned | Mock scenarios/health and I/O health/degraded status are implemented; live Sim-Bridge connection, CARLA host, and hardware smoke remain pending. |
| Contracts and schema layer | Aligned | Shared contracts, widget metadata categories, RabbitMQ/I/O taxonomy, and schema coverage are statically verified. |
| Tests and verification | Static pass / live blocked | `pnpm test`, `pnpm check`, and `pnpm build` pass; `pnpm test:e2e` skips until the gateway is running. |

---

## Part 1: Architecture And Boundary Compliance

### 1.1 High-Level Compliance

The repository still follows documented boundaries in `AGENTS.md` and PRD documents:

1. Backend-to-backend coordination remains RabbitMQ CQRS-based.
2. CoreAPI remains the source for persistence, auth, REST, and websocket fanout.
3. Frontends consume CoreAPI via REST/WebSocket; no frontend RabbitMQ coupling.
4. Sim-Bridge remains simulator adapter boundary.
5. Widgets remain static HTML/CSS/vanilla JS and are runtime-injected.

### 1.2 Boundary Validation Highlights

- **No direct service REST coupling** introduced for cross-domain state changes.
- **Session lifecycle control** is still command/event-driven with persisted transitions.
- **Overlay configure flow** is now explicit:
  - Admin/CoreAPI endpoint: `/api/system/overlay/configure`
  - Process-manager relay endpoint: `/overlay/configure`
  - Desktop overlay local control endpoint: `/configure`

---

## Part 2: Infrastructure And Runtime Orchestration

### 2.1 Docker, PostgreSQL, RabbitMQ, Nginx

All remain structurally aligned and operationally consistent with platform requirements:

- Compose topology includes all expected services.
- PostgreSQL schema, triggers, and indexes remain comprehensive.
- RabbitMQ CQRS topology and DLQ patterns remain in place.
- Nginx single-domain routing remains stable on `localhost:8088`.

### 2.2 Process Manager / Launcher State

The launcher stack has moved significantly toward parity and recovery readiness:

#### Implemented

- Startup readiness checks include:
  - CoreAPI health
  - overlay desktop health
  - process-manager IPC health
  - io-client and simulator service health gates
- Supervisor loop includes bounded backoff/retry strategy.
- IPC server supervision and restart behavior implemented.
- Overlay restart logic checks health endpoint, not only PID existence.
- Improved startup diagnostics with fail-fast log tails on early process death.

#### macOS/Linux launcher (`scarline`) specifics

- Added explicit IPC conflict diagnostics for port `4098`.
- Added stale-listener reclamation path for repo-local stale IPC processes.
- Reworked supervisor internal state to avoid shell incompatibility with associative arrays.

#### Windows launcher (`scarline.ps1`) specifics

- Added startup parity checks for overlay and IPC health.
- Added supervisor process controls and recovery structure.
- Improved YAML nested key parsing behavior.

#### Remaining Risks

- Desktop overlay boot can still fail due host GUI/Electron environment issues.
- Process-manager reliability is now substantially improved but still sensitive to host-level constraints (permissions, graphics runtime, local port conflicts).

---

## Part 3: Backend (CoreAPI + Sim-Bridge) Status

### 3.1 CoreAPI

#### Implemented since prior assessment

- `/api/health` now reflects RabbitMQ connectivity (`rabbit.isConnected()`), not only static process state.
- Websocket subscriptions support channel filters (`studyId`, `sessionId`) for scoped fanout.
- Telemetry event handling normalized and filtered:
  - Driver status no longer pollutes telemetry channel.
  - Session telemetry payloads include contextual envelope fields.
- Export scope invariants enforced:
  - `scope=session` requires `sessionId`
  - `scope=study` requires `studyId`
  - `scope=all` forbids study/session IDs
- Active-study lifecycle route permissions and overlay configure permissions refined.
- Overlay configure endpoint implemented and wired to process manager.
- Researchers, devices, study-design routes, active-study controls, and session note routes now match the documented RBAC matrix.
- Active-study operator notes are persisted to session records instead of page-local state.
- Sensor driver catalogue includes baseline optional drivers exposed by the I/O client.

#### Implemented and verified

- Active Study actions now operational server-side:
  - `start`, `pause`, `resume`, `complete`, `cancel`, `note`, `trigger`
- Triggerable widget instance discovery now uses actual participant layout detail.
- Active Study flow now invokes overlay configure on relevant transitions.
- Realtime telemetry store updated to keyed merge behavior with latest snapshot marker.
- DTO usage was normalized to current contract shape (removed snake_case fallback usage where migrated).
- Export, researcher, device, and study-design restrictions align to documented role policy.
- High-fidelity drag-and-drop participant layout editor implemented fixed implicit any errors.
- Comprehensive trigger rule builder and active study telemetry charts implemented.
- Session log evidence dashboard with modality filtering and event timeline.

### 4.2 Overlay Web + Desktop Overlay

#### Overlay web runtime

- Runtime supports stateful session behavior:
  - pause -> freeze bindings
  - completed/cancelled -> freeze and hide widgets
- Widget interaction forwarding and binding application logic remains intact.
- Widget metadata validation now accepts the canonical documented category set only: `driving`, `communication`, `health`, `study`, and `general`.

#### Desktop overlay + control wiring

- Desktop overlay now supports runtime reconfiguration through `/configure`.
- Configure payload supports URL/mode/display/bounds/session/click-through updates.
- Display topology is exposed through the desktop overlay, Process Manager, and CoreAPI so Participant View can project detected screens.
- Managed widget windows can be opened, resized/updated, and closed individually.
- Status endpoint now exposes richer runtime state context.

---

## Part 5: Widget System Refactor (Major Update)

### 5.1 Structural Change

The widget tree has been refactored from flat folders to:

```text
widgets/
  components/<widget-id>/{index.html,widget.json,...}
  images/...
  icons/...
  dist.css
```

### 5.2 Current Catalogue

Current widget catalogue now contains **24 components**:

- activecall
- appointments
- avatar
- bp
- calendar
- calldeclined
- callended
- contact
- contactlist
- ecg
- hr
- incomingcall
- music
- navigation-prompt
- operator-controls
- operator-notes
- outgoingcall
- resp
- sensor-health
- session-timeline
- speedometer
- spo2
- study-instruction
- time

### 5.3 Runtime/Contract Adaptation

To preserve the implemented data flow without editing design files:

- Contracts now normalize both metadata styles:
  - legacy array-based `bindings`/`triggers`
  - modern map-based `bindings`/`actions` + `ui.minSize/preferredSize`
- CoreAPI catalogue scanner now auto-detects `widgets/components`.
- Overlay server now:
  - resolves widget assets from `components`
  - serves shared `/images/*`, `/icons/*`, `/dist.css`
  - validates both metadata structures
- Overlay runtime normalizes metadata before applying existing binding/trigger flow.
- Shared `widgets/widget-runtime.js` applies declarative binding/state/action behavior across widget contexts.
- Shared Tailwind CSS is generated into `widgets/dist.css` from `widgets/tailwind-source.css`.
- Widget `widget.json` categories have been normalized to the product taxonomy.
- `WIDGET_CATALOGUE.md` now documents all 24 widgets, including `operator-controls`, `operator-notes`, and `sensor-health`.

### 5.4 Design Fidelity Constraint

The refactor copied design-source files without changing individual widget design files. Runtime compatibility was achieved through loader/server/metadata normalization rather than design edits.

---

## Part 6: Python Runtime Clients

### 6.1 CARLA Client

Status improved materially from earlier skeletal baseline:

- Added `carla==0.9.15` dependency.
- Implemented command handling path for:
  - map loading
  - weather application
  - vehicle spawning
  - sensor setup scaffolding
  - control application
  - recording start/stop
  - session bind/unbind handling
- Added cleanup/reconnect-oriented control flow and explicit failure reporting.

Remaining validation burden is environment/runtime integration with real CARLA host and scenario-level behavioral verification.

### 6.2 I/O Client

Framework and driver structure remain intact, and the client now exposes a `/health` endpoint for Docker/process-manager readiness. Driver status, degraded behavior, plugin discovery, and explicit Admin sensor configuration are statically covered. Real hardware integration still depends on concrete device-specific testing in target lab environments.

### 6.3 Mock Simulator

The mock simulator now includes the documented scenario catalogue in `scenarios.yaml` and exposes a `/health` endpoint. Static tests cover deterministic scenario catalogue support, runtime event emission paths, reconnect settings, and health server presence. Live Sim-Bridge connection validation remains blocked until Docker startup succeeds.

---

## Part 7: Testing And Verification Snapshot

The following checks were run during the finalization review:

- `pnpm test` passed.
- `pnpm check` passed with zero Svelte diagnostics.
- `pnpm build` passed across all workspace packages.
- Targeted static tests passed for Admin routes, infra topology, mock simulator, and I/O client.
- `pnpm test:e2e` executed but skipped because the public gateway was not reachable before stack startup.

Notable current limitation found during live validation:

- Mock-backed stack startup was attempted with `./scarline start --no-carla --no-overlay --no-browser`, but Docker stalled while resolving base image metadata for `node:22-alpine` and `python:3.11-slim`. The partial startup was canceled and `./scarline stop` removed the temporary containers/network. Live E2E remains blocked until Docker image resolution is available on the host.

---

## Part 8: Open Risks And Gaps

### High Priority

1. **Build Cleanliness**
   - Root `pnpm check` and `pnpm build` pass after Sim-Bridge websocket dependency alignment; keep them as mandatory gates.
2. **Showcase Reliability**
   - Live mock-backed E2E and overlay smoke checks must be run through the public gateway.
3. **Requirement Drift**
   - Resolved for widget catalogue categories/specs, mock simulator scenarios, I/O command taxonomy, and mock/I/O health endpoint documentation.
4. **Admin Panel Completeness**
   - RBAC and major advanced configuration workflows were updated; browser walkthrough remains required before production-ready status.

---

## Part 9: Final Completion Assessment

### What Is Functionally Complete

- Core domain model and persistence backbone
- CQRS messaging topology
- Auth and RBAC foundations
- Session lifecycle and active-study action paths
- Overlay configure/bootstrap wiring
- Widget runtime + catalogue refactor support
- Process-manager recovery and supervisor loops
- Rate limiting and structured error handling
- Launcher diagnostics and requirement validation

---

---

## Part 11: Final Stabilization (Post-Bug Fixes)

### 11.1 Overlay Rendering and Persistence
A final stabilization pass was performed to resolve issues with participant view rendering:
- **Absolute Positioning**: Transitioned from a zone-based model to display-relative device-independent widget coordinates.
- **Persistence Correction**: Fixed Zod schema mismatches and JSONB mapping logic in the CoreAPI to ensure layout configurations (transparency, coordinates) are correctly saved and retrieved.
- **Connectivity Stability**: Resolved Docker-to-Host networking mismatches by enabling relative API origin discovery in the overlay runtime.
- **Per-Widget Display Targeting**: Participant View now persists `targetDisplay` per widget instance, CoreAPI resolves display offsets per widget, and browser-popup/transparent Electron launch paths use the same saved bounds.

### 11.2 Build Stabilization Target
The build issue identified in this finalization pass was Sim-Bridge websocket dependency skew:
- Sim-Bridge now uses the Fastify 4-compatible `@fastify/websocket` line.
- WebSocket route typing compiles cleanly under the workspace TypeScript configuration.
- **Verification**: root `pnpm check` and `pnpm build` pass across all workspace packages.

---

## Conclusion

SCARline is build-clean and statically finalized against the reviewed requirements, but it is not yet production-ready. Production-ready status depends on resolving Docker image metadata/startup on the host, passing live gateway E2E, completing overlay visual smoke checks, and recording CARLA/hardware validation where those external runtimes are available.
