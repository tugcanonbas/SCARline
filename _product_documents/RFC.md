# SCARline Platform RFC

- **Status:** Draft v0
- **Owner:** HCIS Lab
- **Audience:** UX researchers, simulation engineers, HCIS lab contributors

---

## 1. Purpose

SCARline is a **plug-and-play UX platform for driving simulations**. It enables UX designers and researchers to design, run, and analyze driving studies without deep simulator or backend engineering.

This RFC defines the **core architecture**, **responsibilities**, and **extensibility model** for SCARline so that:

- UX designers can configure studies, overlays, and widgets with minimal code.
- Engineers can extend the platform with new modalities, widgets, and pipelines without breaking existing studies.
- Researchers can fork/customize the system for special protocols while still benefiting from a stable core.

The scope of this RFC is the **local / lab deployment** of SCARline (single or few machines on a LAN using Docker Compose). Cloud deployment, scaling, and multi-site coordination are out-of-scope for v0.

---

## 2. High-Level Goals

1. **End-to-end workflow for UX studies**\
   Configure study → run simulation → collect data → visualize and export.

2. **Config-first, code-second**\
   Studies, overlays, modalities, and widgets are primarily configured via JSON/YAML; code changes are only needed for new capabilities.

3. **Modality-agnostic core**\
   Support HR, camera, vehicle telemetry, etc. through a single generic event model and pluggable adapters.

4. **Widget-based HMIs**\
   In-simulation HMIs are composed from reusable HTML + Tailwind widgets driven by live data.

5. **Forkable and hackable**\
   Clear separation between core platform, study configuration, and adapters so that labs can fork/extend safely.

---

## 3. System Overview

SCARline is composed of three main layers:

1. **Data & Control Layer** – messaging, persistence, orchestration.
2. **Overlay Runtime** – SvelteKit-based in-simulation UI.
3. **Widget Library** – HTML + Tailwind widgets with a simple binding contract.

These are deployed together via **Docker Compose** for local / LAN use.

### 3.1 Core Services

- **RabbitMQ** – Message broker for commands and telemetry between components.
- **PostgreSQL** – Persistent store for studies, runs, sessions, and signals.
- **Hub-API (Node/TypeScript)** – Central brain; exposes REST/WebSocket APIs, manages studies/configs, and bridges RabbitMQ ↔ DB ↔ Overlay.
- **Process-Controller** – Manages lifecycle of external simulators (e.g., CARLA) and related tools not running inside Docker.
- **Sim-Bridge** – Connects to simulators (CARLA, others), normalises telemetry, and publishes events.
- **I/O-Client** – Connects to physiological sensors, cameras, or external tools (e.g., MATLAB) and publishes events.
- **Overlay (SvelteKit)** – Renders HMIs as composed widgets and subscribes to live widget data.

Each service is a Docker container on a shared `hub-net` network.

---

## 4. Core Concepts

### 4.1 Study

A **Study** describes a specific experimental setup:

- ID, name, description.
- Enabled modalities (HR, camera, vehicle, etc.).
- Persistence rules (which modalities are stored, aggregated, or only used live).
- Overlay layouts and widget instances.

Studies are defined as versioned JSON/YAML configs and stored in PostgreSQL.

### 4.2 Modality

A **Modality** is any data channel involved in a study (e.g., `hr`, `vehicle`, `camera`, `gsr`, `steering_wheel`). The core system treats modalities generically.

Each modality configuration includes:

- `id` – e.g., `"hr"`, `"vehicle"`.
- `source` – which adapter is expected to publish it (e.g., `"io-client"`, `"sim-bridge"`).
- `mqTopic` – routing key/exchange binding in RabbitMQ.
- `persist` rules – `{ raw?: boolean; aggregate?: boolean; }`.

### 4.3 Sensor Event Envelope

All telemetry conforms to a generic **SensorEvent** envelope:

```json
{
  "studyId": "study_emotune_01",
  "runId": "run_abc123",
  "modality": "hr",
  "eventType": "sample",
  "ts": "2025-12-08T14:23:10.123Z",
  "payload": {
    "bpm": 82,
    "quality": "good"
  }
}
```

This envelope is transported over RabbitMQ and consumed by Hub-API.

### 4.4 Widget

A **Widget** is a reusable HTML + Tailwind fragment that knows how to render some data but is agnostic about where that data comes from.

Each widget lives under `widgets/<widgetId>/` and consists of:

- `meta.json` – metadata and input contract.
- `widget.html` – markup with Tailwind classes and `data-bind` hooks.

Example `meta.json`:

```json
{
  "id": "speedometer",
  "name": "Speedometer",
  "description": "Displays current speed and speed limit.",
  "inputs": ["speed", "speedLimit", "unit", "speedBar"],
  "category": "vehicle",
  "size": "sm",
  "aspectRatio": "4:1",
  "tags": ["primary", "critical"]
}
```

Example `widget.html` (root + data bindings):

```html
<div class="sc-widget" data-widget-id="speedometer">
  <div class="flex items-center justify-between">
    <div>
      <div class="sc-widget-title">Speed</div>
      <div class="flex items-baseline gap-1">
        <span class="sc-widget-value-lg" data-bind="speed">72</span>
        <span class="text-xs text-sc-muted" data-bind="unit">km/h</span>
      </div>
    </div>

    <div class="flex flex-col items-end">
      <span class="sc-widget-sub">Limit</span>
      <span class="text-sm font-medium text-sc-accent" data-bind="speedLimit">80</span>
    </div>
  </div>

  <div class="mt-2 h-1.5 w-full rounded-full bg-sc-bg">
    <div
      class="h-1.5 rounded-full bg-sc-accent transition-[width]"
      data-bind="speedBar"
      data-bind-style="width"
      style="width: 60%;"
    ></div>
  </div>
</div>
```

Widgets must not contain business logic or network calls.

### 4.5 Widget Instance

A **Widget Instance** places a widget into a specific study layout and defines how it is fed from modality data.

Key fields:

- `instanceId` – unique per layout.
- `widgetId` – reference to `widgets/<widgetId>`.
- `modality` – which modality this instance subscribes to.
- `inputMap` – mapping from telemetry fields to widget `inputs`.
- `layout` – x/y position and width/height in a grid.

Example:

```json
{
  "instanceId": "widget-speed-1",
  "widgetId": "speedometer",
  "modality": "vehicle",
  "inputMap": {
    "speed": "payload.speed",
    "speedLimit": "payload.speedLimit",
    "unit": "\"km/h\"",
    "speedBar": "derived.speedBar"
  },
  "layout": { "x": 0, "y": 0, "w": 4, "h": 2 }
}
```

The `inputMap` defines how a `SensorEvent` for `modality = "vehicle"` is transformed into the key/value object bound into the widget.

