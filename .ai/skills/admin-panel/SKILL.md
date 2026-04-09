---
name: "Admin Panel Developer"
description: "Guidelines and strict rules for developing the SvelteKit-based SCARline Admin Panel."
license: "Apache-2.0"
---

# SCARline Admin Panel Skill

The Admin Panel is the control interface for researchers and lab operators to manage studies, widgets, and the simulator.

## 1. Technology Stack

- **Framework**: `SvelteKit`.
- **Language**: `TypeScript`.
- **Styling**: `TailwindCSS v4`.
- **Icons**: `Lucide Icons` (strictly use lucide-svelte; do not introduce competing icon libraries).

## 2. State Management

Do not use Redux or complex external state engines. Use strictly **Svelte stores**.

- For real-time telemetry and state bridged from CoreAPI WebSockets, create custom Writable stores.
- Example: `sessionState` store automatically updates when CoreAPI pushes a status change event.

## 3. UI and Styling Principles

SCARline aims for a highly professional, clinical, yet dynamic UI suitable for an automotive research environment.

- **Use TailwindCSS v4 Utility Classes**: Avoid custom CSS files. 
- **No Direct DOM Manipulation**: Always use Svelte reactivity bindings (e.g., `class:active={isActive}`).

## 4. Role-Based Access Control (RBAC)

The UI must restrict access depending on the logged-in JWT role:

- **Researcher**: Full access to design studies, edit configs, view analysis.
- **Lab Admin**: Full access + System configurations (Simulator Paths, API Keys).
- **Study Operator**: Restricted to viewing active studies and running the "Active Study Controls" dashboard (Triggering widgets). Cannot edit designs.
- **Student**: View-only mode for historical data and study designs.

*Rule: Check permissions in SvelteKit `+page.server.ts` loaders before rendering sensitive pages.*
