---
name: "admin-panel"
description: "Guidelines and strict rules for developing the SvelteKit-based SCARline Admin Panel, including study routes, Participant View widget layout editing, display topology, and overlay window controls."
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

## 4. Participant View And Widget Layouts

Participant View is the canonical editor for participant-facing widget layouts.

- Load widget catalogue data from CoreAPI and preserve normalized `widget.ui` sizing metadata.
- Use each widget's `ui.preferredWidth`/`ui.preferredHeight` for first placement.
- Enforce `ui.minWidth`/`ui.minHeight` while resizing, but preserve researcher-adjusted sizes after placement.
- Treat saved widget coordinates as device-independent pixels relative to the widget's assigned display.
- Preserve layout-level `targetDisplay` only as a fallback/default. Each placed widget may have its own `targetDisplay`.
- Display topology must come through CoreAPI/process-manager (`/api/system/overlay/displays`), not direct Electron calls from the Admin Panel.
- The canvas should represent the selected display's detected bounds and show only widgets assigned to that display. Moving the selected canvas display must not move all widgets.
- Use close controls for live widget windows (`/api/system/overlay/windows/close`) without deleting widgets from the saved layout.
- Opening browser-popup and transparent Electron widget windows must use the same saved widget bounds and assigned display.

## 5. Role-Based Access Control (RBAC)

The UI must restrict access depending on the logged-in JWT role:

- **Researcher**: Full access to design studies, edit configs, view analysis.
- **Admin**: Full access + System configurations (Simulator Paths, API Keys).
- **Study Operator**: Restricted to viewing active studies and running the "Active Study Controls" dashboard (Triggering widgets). Cannot edit designs.
- **Viewer**: View-only mode for historical data and study designs.

*Rule: Check permissions in SvelteKit `+page.server.ts` loaders before rendering sensitive pages.*
