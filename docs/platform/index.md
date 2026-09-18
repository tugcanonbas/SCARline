# Platform Overview

SCARline coordinates people, software, displays, simulators, and sensor hardware for
controlled driving studies. This section explains the system model; the
[Operations](/operations/) section explains how to work it.

## What The Platform Owns

- study design: conditions, participants, simulator and sensor configuration, layouts
- session execution: an ordered queue of conditions with an auditable lifecycle
- simulator and sensor integration through message-based commands and events
- participant-facing overlay windows and widgets
- durable evidence: events, annotations, activity log, export archives
- component health and readiness signalling

## Major Subsystems

<div class="section-grid">
  <div class="section-card">
    <h3>CoreAPI</h3>
    <p>Fastify service that owns authentication, RBAC, persistence, the REST surface, WebSocket fanout, session lifecycle orchestration, and export jobs.</p>
  </div>
  <div class="section-card">
    <h3>Admin Panel</h3>
    <p>SvelteKit application for researchers, operators, and administrators. Route guards and role checks run server-side.</p>
  </div>
  <div class="section-card">
    <h3>Simulator Plane</h3>
    <p>Sim-Bridge registers adapters over a WebSocket and relays lifecycle and command traffic to the Mock Simulator or the CARLA client.</p>
  </div>
  <div class="section-card">
    <h3>Sensor Plane</h3>
    <p>The Python IO Client loads driver manifests, discovers devices, and publishes batched sensor samples.</p>
  </div>
  <div class="section-card">
    <h3>Overlay Plane</h3>
    <p>Overlay Web renders participant widgets; the Electron desktop overlay places them as transparent, display-targeted windows.</p>
  </div>
  <div class="section-card">
    <h3>Infrastructure</h3>
    <p>PostgreSQL for durable state, RabbitMQ for asynchronous commands and events, and a transactional outbox between them.</p>
  </div>
</div>

## Core Domain Objects

| Object | Purpose |
| --- | --- |
| Study | Container for metadata, members, participants, conditions, sessions, and a data policy |
| Condition | An experimental variant; owns simulator configuration, device assignments, layouts, and trigger rules |
| Participant | Anonymised participant record scoped to one study |
| Session | One participant's run of a study, executing an ordered queue of conditions |
| Session condition | One condition within a session, carrying an immutable configuration snapshot |
| Layout | A participant or researcher-monitor arrangement of widget instances, versioned by revision |
| Widget instance | One placed widget: geometry, display, window mode, input mode, bindings, style |
| Trigger rule | A condition-scoped expression that fires an action during a session |
| Session event | A persisted runtime event tied to a session and optionally a session condition |
| Lifecycle command | An auditable session transition request with required component acknowledgements |
| Export job | A background request producing a downloadable archive |

## The Two Layers That Matter Most

**Configuration is snapshotted.** When a session becomes `ready`, CoreAPI freezes each
queued condition's simulator, device, and sensor configuration into
`session_conditions.configuration_snapshot`. Later edits to the study cannot change what
a session already ran, which is what makes a completed session reproducible.

**State changes are commands, not writes.** A lifecycle transition is a
`lifecycle_commands` row that is dispatched to the components that must participate,
collects their acknowledgements, and only then applies the new status. A command that is
not fully acknowledged before its deadline is marked `timed_out` and the session is
failed rather than silently left inconsistent.

## Read In Order

1. [Architecture](/platform/architecture) — boundaries and the flow of a request
2. [Runtime Topology](/platform/runtime-topology) — processes, ports, and health
3. [Study And Session Lifecycle](/platform/lifecycle) — the states and who may change them
4. [Overlay And Widgets](/platform/overlay-and-widgets) — the participant-facing plane
5. [Simulators](/platform/simulators) — adapters, bindings, and telemetry
6. [Sensors And IO](/platform/sensors-and-io) — drivers, discovery, and sample batching
7. [Data And Realtime](/platform/data-and-realtime) — persistence, outbox, and channels
8. [Security Model](/platform/security) — tokens, cookies, RBAC, and asset containment
