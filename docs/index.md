---
layout: home

hero:
  name: SCARline
  text: Platform Documentation
  tagline: Product-first documentation for understanding, operating, and extending the automotive UX and HCI research platform.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: Explore The Platform
      link: /platform/

features:
  - title: Run Research Operations
    details: Design studies, assign participants, configure simulator conditions, operate active sessions, and export evidence from one coordinated platform.
  - title: Understand The Runtime
    details: Learn how CoreAPI, RabbitMQ, Sim-Bridge, overlay services, Python clients, and the launcher fit together at runtime.
  - title: Build Safely
    details: Extend contracts, APIs, widgets, simulators, and sensor drivers with a curated reference and implementation guides.
---

SCARline is a research operations platform for simulator-based automotive UX and HCI studies. It combines administrative workflows, real-time operator tooling, participant-facing overlays, simulator adapters, hardware integrations, and auditable data capture into a single runtime model.

## What This Site Covers

<div class="section-grid">
  <div class="section-card">
    <h3>Product Concepts</h3>
    <p>Understand the system model, study lifecycle, data flow, overlay runtime, and platform responsibilities before changing or operating the stack.</p>
  </div>
  <div class="section-card">
    <h3>Operational Guides</h3>
    <p>Use startup, onboarding, session supervision, export, and recovery playbooks that reflect the current implementation.</p>
  </div>
  <div class="section-card">
    <h3>Builder Docs</h3>
    <p>Extend CoreAPI, contracts, widgets, simulator adapters, and sensor drivers without violating the architecture boundaries.</p>
  </div>
  <div class="section-card">
    <h3>Curated Reference</h3>
    <p>Look up route families, contracts, realtime channels, launcher modes, RBAC boundaries, and widget/layout models without wading through source files.</p>
  </div>
</div>

## Platform At A Glance

```mermaid
flowchart LR
    Admin["Admin Panel (/admin)"] --> Core["CoreAPI (/api, /ws)"]
    Docs["Docs (/docs)"] -. guidance .-> Admin
    Core --> DB["PostgreSQL"]
    Core --> MQ["RabbitMQ"]
    Core --> Overlay["Overlay Web + Desktop Overlay"]
    Core --> PM["Process Manager"]
    MQ --> Bridge["Sim-Bridge"]
    MQ --> IO["I/O Client"]
    Bridge --> Carla["CARLA Client"]
    Bridge --> Mock["Mock Simulator"]
    Overlay --> Widgets["Static Widget Catalogue"]
```

## Fast Paths

- New to the platform: start at [Getting Started](/getting-started/).
- Need the system mental model: read [Platform Overview](/platform/) and [Architecture](/platform/architecture).
- Running studies or supervising a session: go to [Operations](/operations/).
- Extending the product: go to [Builders](/builders/).
- Looking for specific route, contract, or runtime details: use [Reference](/reference/).

## Start By Role

<div class="section-grid">
  <div class="section-card">
    <h3>Researchers</h3>
    <p>Understand study setup, condition design, readiness checks, active session supervision, and exports.</p>
    <p><a href="/researchers/">Open researcher entry page</a></p>
  </div>
  <div class="section-card">
    <h3>Operators And Admins</h3>
    <p>Focus on startup state, health monitoring, user access, device readiness, incident response, and recovery order.</p>
    <p><a href="/admins/">Open admin entry page</a></p>
  </div>
  <div class="section-card">
    <h3>Developers</h3>
    <p>Understand contracts-first development, backend boundaries, realtime channels, launcher modes, and tests.</p>
    <p><a href="/developers/">Open developer entry page</a></p>
  </div>
  <div class="section-card">
    <h3>Designers</h3>
    <p>Map operator journeys, participant view behaviors, overlay constraints, role-aware UI, and information density patterns.</p>
    <p><a href="/designers/">Open designer entry page</a></p>
  </div>
</div>

## Documentation Map

- [Getting Started](/getting-started/): first orientation, first study run, local stack bring-up, troubleshooting entry points
- [Platform](/platform/): architecture, lifecycle, runtime topology, overlay/widget model, simulators/sensors, data/realtime
- [Operations](/operations/): task-oriented procedures for running the platform safely
- [Builders](/builders/): implementation guides for contributors
- [Reference](/reference/): concise source-of-truth summaries of routes, contracts, realtime, config, and RBAC
- [Roles](/roles/): role-based entry pages that route to the relevant product-first sections
