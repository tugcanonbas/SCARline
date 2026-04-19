---
name: "widget-developer"
description: "Guidelines and strict rules for creating, modifying, or reviewing SCARline static overlay widgets, widget.json metadata, shared widget runtime usage, and widget Tailwind CSS."
license: "Apache-2.0"
---

# SCARline Widget Developer Skill

When generating, modifying, or reviewing SCARline widgets for the Overlay Engine, follow these rules. Widgets render in web overlays, browser-popup windows, and transparent Electron windows.

## 1. Architectural Boundaries

SCARline widgets are **static UI components** rendered by the Overlay Engine. They live under `widgets/components/<widget-id>/`.

- **No Per-Widget Bundlers**: Widgets do not use Webpack/Vite, React, Svelte, or Vue inside the widget itself. They are pure HTML, CSS, and vanilla JavaScript.
- **Shared TailwindCSS v4**: Widgets include `../../dist.css`; update it with `pnpm widgets:build-css` after class changes.
- **Shared Runtime**: Prefer `../../widget-runtime.js` and declarative `data-*` attributes over copy-pasted widget bootstrap scripts.
- **No Direct API Calls**: Widgets must never communicate directly with the backend via `fetch` or custom WebSockets. They must use the SCARline JS API.
- **Full-Size Roots**: Widget roots must be transparent and responsive to the assigned window/frame (`w-full h-full` or equivalent).

## 2. Directory Structure

A widget directory is `widgets/components/<widget-id>/` and must contain:
1. `index.html` for declarative markup plus widget-specific CSS/logic only when needed.
2. `widget.json` for metadata, bindings/actions, and `ui` sizing.
3. Local assets only when required. Shared assets belong in `widgets/images/` or `widgets/icons/`.

## 3. Metadata (`widget.json`) Format

Every widget **must** define a `widget.json` file using the normalized catalogue shape:

```json
{
  "id": "speedometer",
  "name": "Human Readable Name",
  "category": "driving|communication|health|study|general",
  "description": "Short description of behavior",
  "version": "1.0.0",
  "entry": "index.html",
  "bindings": [
    {
      "key": "vehicle.speed",
      "type": "number|string|boolean",
      "label": "Vehicle Speed",
      "unit": "km/h",
      "description": "Current vehicle speed"
    }
  ],
  "actions": [],
  "ui": {
    "minWidth": 160,
    "minHeight": 120,
    "preferredWidth": 300,
    "preferredHeight": 220
  }
}
```

Preferred sizes are used for first placement in Participant View. Minimum sizes are enforced during resize. Researcher-resized dimensions override preferred sizes in saved layouts.

## 4. The SCARline JavaScript API

The Overlay Engine injects the stable `window.SCARline` object into the widget context. Keep this public API unchanged: `onBinding`, `onTrigger`, `onStateChange`, `getBinding`, `getState`, `getMetadata`, `send`, `ready`.

### Declarative Bindings

Use shared runtime attributes whenever possible:

```html
<link rel="stylesheet" href="../../dist.css">

<div data-scarline-widget-root class="flex h-full w-full items-center justify-center">
  <span data-bind="vehicle.speed" data-format="number" class="text-6xl font-bold text-white">0</span>
  <button data-action="acknowledge" class="rounded-lg bg-sky-500 px-3 py-2 text-white">OK</button>
</div>

<script src="../../widget-runtime.js"></script>
```

Supported attributes include `data-bind`, `data-bind-class`, `data-bind-class-false`, `data-bind-style`, `data-bind-attr`, `data-format`, `data-decimals`, and `data-action`.

### Data Binding
Use custom JavaScript only for widget-specific behavior that the shared runtime cannot express. Subscribe only to keys declared in `widget.json`:

```javascript
// Strict rule: Only bind to keys declared in widget.json
window.SCARline.onBinding("vehicle.speed", (value) => {
    document.getElementById("speed-display").innerText = Math.round(value);
});
```

### Receiving Triggers
To respond to actions initiated by the researcher (e.g., manual highlights):

```javascript
window.SCARline.onTrigger((event) => {
    if (event.triggerType) {
        document.getElementById("container").classList.add("text-red-500");
    }
});
```

### Sending Data (Rare)
Widgets are mostly read-only, but interactive widgets can send state back:

```javascript
window.SCARline.send("widget.interaction", {
    widgetId: "button_panel",
    action: "clicked"
});
```

## 5. Styling and Design

- Include `../../dist.css`; do not use Tailwind CDN.
- Use explicit sizing or `w-full h-full` to fit the assigned widget window/frame.
- Ensure text is legible against varied backgrounds (simulated environments), utilizing text shadows or semi-transparent backdrops (`bg-black/50`).
- Keep truly custom animation/keyframe CSS local to the widget.
- After changing widget utility classes, run `pnpm widgets:build-css` and `pnpm widgets:check-css`.
