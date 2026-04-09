---
name: "Widget Developer"
description: "Guidelines and strict rules for creating and modifying SCARline Dashboard Widgets."
license: "Apache-2.0"
---

# SCARline Widget Developer Skill

When generating, modifying, or reviewing SCARline Widgets for the Overlay Engine, you must strictly follow these rules based on the product requirements.

## 1. Architectural Boundaries

SCARline widgets are **static UI components** rendered by the Overlay Engine. They must be entirely self-contained within their respective directory (e.g., `src/widgets/speedometer/`).

- **No Build Steps**: Widgets do not use bundlers (Webpack/Vite), React, Svelte, or Vue inside the widget itself. They are pure HTML, CSS, and vanilla JavaScript.
- **TailwindCSS v4**: All styling must use TailwindCSS v4 utility classes.
- **No Direct API Calls**: Widgets must never communicate directly with the backend via `fetch` or custom WebSockets. They must use the SCARline JS API.

## 2. Directory Structure

A widget directory must contain exactly:
1. `index.html` (The markup and logic)
2. `widget.json` (The metadata)
3. Assets (if required, local images only)

## 3. Metadata (`widget.json`) Format

Every widget **must** define a `widget.json` file exactly matching this schema:

```json
{
  "id": "widget_unique_id",
  "name": "Human Readable Name",
  "category": "driving|health|navigation|study|general",
  "description": "Short description of behavior",
  "defaultSize": {"width": 200, "height": 200},
  "minSize": {"width": 100, "height": 100},
  "bindings": [
    {
      "key": "telemetry.path.here",
      "type": "number|string|boolean",
      "required": true
    }
  ],
  "triggers": [
    {
      "action": "highlight",
      "description": "Trigger action explanation"
    }
  ]
}
```

## 4. The SCARline JavaScript API

The Overlay Engine injects the `window.SCARline` object into the widget's context.

### Data Binding
To receive data, subscribe to the exact keys defined in your `widget.json` bindings:

```javascript
// Strict rule: Only bind to keys declared in widget.json
window.SCARline.onData("vehicle.speed", (value) => {
    document.getElementById("speed-display").innerText = Math.round(value);
});
```

### Receiving Triggers
To respond to actions initiated by the researcher (e.g., manual highlights):

```javascript
// Strict rule: Only listen to actions declared in the widget.json triggers array
window.SCARline.onTrigger("highlight", (payload) => {
    document.getElementById("container").classList.add("text-red-500");
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

- Use absolute positioning (`absolute`, `top-0`, `left-0`) wrapping the root component if the widget needs to scale dynamically.
- Use explicit sizing or `w-full h-full` to fit the assigned zone defined in the Overlay Engine.
- Ensure text is legible against varied backgrounds (simulated environments), utilizing text shadows or semi-transparent backdrops (`bg-black/50`).
