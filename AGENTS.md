# AGENTS.md

Welcome to the SCARline repository. This file serves as the primary entry point and guide for AI coding agents contributing to the platform.

## Architecture & Product Requirements

SCARline is a research operations platform for the automotive industry, integrating driving simulators (like CARLA), web interfaces, and hardware sensors into a unified UX/HCI testing environment.

- **Source of Truth:** Check the `product-requirements/` directory before making major changes. Start with `product-requirements/PRD.md` for the system overview.
- **Tech Stack:** SvelteKit (UI), Fastify (Backend APIs), Python (Simulator and Sensor plugins), RabbitMQ (Event Bus), PostgreSQL (Single source of truth).
- **Messaging Pattern:** Strict CQRS architecture flowing through RabbitMQ using a universal envelope structure.

## AI Skills (Project Rules)

SCARline utilizes explicit domain rules located in the `.ai/skills/` directory. Depending on the component you are working on, cross-reference the corresponding skill documentation to ensure adherence to architectural constraints:

- `.ai/skills/admin-panel`: Frontend rules mapping to Svelte stores and RBAC security.
- `.ai/skills/coreapi-backend`: Fastify endpoint structures, Zod validations, and JWT queries.
- `.ai/skills/rabbitmq-cqrs`: Message envelope formats and Command vs Event separation rules.
- `.ai/skills/sensor-driver`: Building Python sub-classes for physical hardware I/O integrations.
- `.ai/skills/sim-adapter`: Implementing Sim-Bridge WebSocket capabilities for simulator engines.
- `.ai/skills/widget-developer`: Requirements for building Overlay Engine widgets (`widget.json` schemas).
- `.ai/skills/tailwindcss-v4`: Strict reliance on `@theme` CSS variables instead of older configuration files.
- `.ai/skills/sveltekit-v5`: Svelte 5 Runes (`$state`, `$derived`, `$props()`) conventions.
- `.ai/skills/git-conventions`: Strict Conventional Commits v1.0.0 enforcement.

## System Commands

The entire platform is orchestrated OS-side via our Process Manager script (`./scarline`).

- **Start production run:** `./scarline start`
- **Start development (hot reloading):** `./scarline start --dev`
- **Stop gracefully:** `./scarline stop`
- **Check component health:** `./scarline status`
- **Reboot containers without OS overlay:** `./scarline start --no-overlay`
- **Database wipe/reset:** `./scarline reset-db`

## Key Boundaries

1. **Overlay Widgets** run with vanilla JS and CSS, completely decoupled from SvelteKit. Do not use build steps for widgets.
2. **State Mutability:** Services should never utilize synchronous REST for multi-domain state changes. Publish commands to RabbitMQ.
3. All commits **must** be atomic and adhere to the `feat/fix/chore[scope]: message` structure.
