# SCARline – Product Requirements

> **Version**: 1.0  
> **Last Updated**: 2026-04-14

---

## 1. Platform Overview

SCARline is a complete research operations platform for **Human-Computer Interaction (HCI)** and **User Experience (UX)** researchers focusing on the automotive industry. The platform enables researchers to rapidly prototype and execute user studies using driving simulators — with [CARLA Simulator](https://carla.org) as the primary simulator environment.

The system predefines all required components so researchers can focus solely on study design and improving the automotive experience. When additional requirements arise, researchers and developers can extend the system through its standardized interfaces — adding new widgets, sensors, or simulator adapters using built-in documentation and development tools.

### Core Value Proposition

| Value                        | Description                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| **Rapid Study Design**       | Researchers design and launch studies entirely through the Admin Panel — no code required        |
| **Real-Time Data Pipeline**  | All data streams flow in real time from simulators and sensors through to widgets and storage    |
| **Extensible Widget System** | Static HTML + TailwindCSS v4 widgets with metadata-driven bindings — easy to create and maintain |
| **Multi-Device Access**      | Web-based platform accessible from any device on the local network                               |
| **Complete Data Capture**    | Every event, input, and telemetry reading is persisted to PostgreSQL for analysis                |
| **Simulator Agnostic**       | Abstract Sim-Bridge protocol enables future simulator integrations beyond CARLA                  |

---

## 2. Target Audience

| Role               | Description                                                         | Primary Interface                                                    |
| ------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Researcher**     | Designs studies, configures conditions, analyzes data               | Admin Panel — full access                                            |
| **Lab Admin**      | Manages system configuration, devices, user accounts                | Admin Panel — system settings                                        |
| **Study Operator** | Runs study sessions, triggers widgets, monitors progress            | Admin Panel — active study controls (laptop/tablet on local network) |
| **Developer**      | Extends the system with new widgets, sensors, or simulator adapters | Documentation + widget/sensor development                            |
| **Student**        | Learning HCI/UX research methods using the platform                 | Admin Panel — scoped access based on role                            |

---

## 3. Main Components

### Infrastructure

| Component                                | Description                                                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Docker](https://www.docker.com)**     | Containerization layer that packages and runs all platform components in isolated environments, simplifying setup and ensuring consistent deployment across machines.               |
| **Database**                             | [PostgreSQL](https://www.postgresql.org) database serving as the single data store for all platform data — metadata, configuration, session events, telemetry, and sensor readings. |
| **[RabbitMQ](https://www.rabbitmq.com)** | Universal real-time event bus implementing a CQRS pattern (commands and events) for reliable inter-component communication.                                                         |

### Apps and Services

| Component           | Description                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Process Manager** | OS-level service that orchestrates the platform lifecycle — manages Docker containers, CARLA Server binary, and the Overlay Engine's transparent mode.                                                                                                                                                                               |
| **CoreAPI**         | Central control plane and sole API boundary built with [Fastify](https://fastify.dev) ([Node.js](https://nodejs.org) / [TypeScript](https://www.typescriptlang.org)). Handles all communication between components, manages session lifecycle, processes widget triggers, and dispatches real-time data to interfaces via WebSocket. |
| **Admin Panel**     | Web-based researcher and operator interface built with [SvelteKit](https://svelte.dev/docs/kit). Manages everything from study design and simulator configuration to session execution and data export.                                                                                                                              |
| **Sim-Bridge**      | Abstract protocol bridge that normalizes communication between the platform and any simulator backend. Enables future simulator integrations through a standardized adapter interface.                                                                                                                                               |
| **I/O Client**      | [Python](https://www.python.org)-based service for physical sensor integration. Implements a standardized `SensorDriver` interface, allowing eye trackers, steering wheels, heart rate monitors, and other hardware to stream data through RabbitMQ.                                                                                 |
| **Overlay Engine**  | Widget rendering engine supporting two modes: **web mode** (browser-based, accessible on any device) and **desktop transparent mode** ([Electron](https://www.electronjs.org) windows overlaying the simulator for the participant).                                                                                                 |
| **Widgets**         | Catalogue of self-contained HTML + [TailwindCSS v4](https://tailwindcss.com) components rendered by the Overlay Engine. Widgets are organized under `widgets/components/<widget-id>/` with shared assets in `widgets/images/` and `widgets/icons/`. Each widget includes `widget.json` metadata defining bindings, sizing, and category. |

### Simulators

| Component          | Description                                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mock Simulator** | Full development tool with configurable telemetry and predefined scenarios. Enables system and widget development without a running simulator instance.                                              |
| **CARLA Server**   | Pre-built CARLA binary provided by the CARLA project. The researcher provides the installation path during onboarding; the Process Manager handles its lifecycle.                                    |
| **CARLA Client**   | Custom Python adapter running in Docker that connects to the CARLA Server via the CARLA Python API and to the platform via the Sim-Bridge. All CARLA features are configurable from the Admin Panel. |

---

## 4. Document Index

This directory contains the detailed product requirements for every component. Start with the [PRD.md](./PRD.md) for the full architecture overview and design decisions.

### Central Document

| File                                                   | Description                                                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [PRD.md](./PRD.md)                                     | Product Requirements Document — architecture, technology stack, access model, authentication, and complete document index                                    |
| [IMPLEMENTATION_REPORT.md](./IMPLEMENTATION_REPORT.md) | Current codebase assessment against product requirements, measured verification evidence, and remaining finalization risks |
| [FINALIZATION_PLAN.md](./FINALIZATION_PLAN.md) | Implementation plan for bringing the platform to showcase-ready end-to-end reliability without adding new feature scope |
| [REQUIREMENTS_TRACEABILITY.md](./REQUIREMENTS_TRACEABILITY.md) | Traceability matrix mapping each requirements document to implementation surfaces, verification status, and finalization actions |


### Infrastructure

| File                                                                 | Description                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [DOCKER.md](./DOCKER.md)                                             | Container architecture, Docker Compose structure, networking, volumes, and health checks |
| [DATABASE.md](./DATABASE.md)                                         | PostgreSQL requirements, JSONB strategy, performance targets, and schema management      |
| [DATABASE_ENTITIES.md](./DATABASE_ENTITIES.md)                       | All database entities with fields, types, relationships, and ER diagram                  |
| [RABBITMQ.md](./RABBITMQ.md)                                         | Event bus architecture, CQRS pattern, exchange topology, and routing key schemes         |
| [RABBITMQ_EVENTS_AND_COMMANDS.md](./RABBITMQ_EVENTS_AND_COMMANDS.md) | Complete event and command taxonomy with routing keys and payload schemas                |

---

### Apps and Services

| File                                         | Description                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [PROCESS_MANAGER.md](./PROCESS_MANAGER.md)   | OS-level lifecycle management, boot sequence, CARLA Server control, and health monitoring             |
| [CORE_API.md](./CORE_API.md)                 | Central API specification — all endpoints, WebSocket server, session runtime, and trigger engine      |
| [ADMIN_PANEL.md](./ADMIN_PANEL.md)           | Web UI specification — all 24 screens, routes, interactions, and role-based access control            |
| [SIM_BRIDGE.md](./SIM_BRIDGE.md)             | Simulator bridge — WebSocket protocol, adapter registration, and session binding                      |
| [IO_CLIENT.md](./IO_CLIENT.md)               | Physical sensor client — SensorDriver interface, supported sensors, and data flow                     |
| [OVERLAY_ENGINE.md](./OVERLAY_ENGINE.md)     | Widget rendering engine — web mode, desktop transparent mode, and data binding model                  |
| [WIDGETS.md](./WIDGETS.md)                   | Widget architecture — development guide, `widget.json` schema, trigger system, and styling guidelines |
| [WIDGET_CATALOGUE.md](./WIDGET_CATALOGUE.md) | Complete catalogue of all 24 widgets with bindings, sizing, and behavior                              |

---

### Simulators

| File                                       | Description                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [MOCK_SIMULATOR.md](./MOCK_SIMULATOR.md)   | Development simulator — configurable telemetry, predefined scenarios, and dev workflow      |
| [CARLA_SIMULATOR.md](./CARLA_SIMULATOR.md) | CARLA integration — all configurable features, Admin Panel controls, and telemetry pipeline |
