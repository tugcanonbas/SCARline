---
name: "widget-development"
description: "Rules for creating, modifying, or reviewing SCARline overlay widgets: the widget.json manifest, the shared widget runtime and its data-* attributes, the injected window.SCARline API, interactions, Tailwind styling, and testing."
license: "Apache-2.0"
---

# SCARline Widget Development Skill

A widget is a directory of **static files** rendered by Overlay Web in a
participant-facing window. There is no build step, no framework, and no bundler
— that is what lets `widgets/` be a read-only volume a running CoreAPI picks up
without an image rebuild.

```text
widgets/components/<widget-id>/
├── widget.json          manifest (required)
├── index.html           entry (default; override with `entry`)
└── <widget-id>.png      optional catalogue thumbnail
```

Shared assets live beside the components and are referenced with `../../`:
`widgets/dist.css`, `widgets/widget-runtime.js`, `widgets/images/`,
`widgets/icons/`.

## 1. Architectural Boundaries

- **No bundlers or frameworks.** Pure HTML, CSS, and vanilla JavaScript. No
  React, Svelte, Vue, Webpack, or Vite inside a widget.
- **No direct backend access.** Never call `fetch`, `XMLHttpRequest`, or open a
  WebSocket. The widget runs in a sandboxed iframe with an opaque origin and
  reaches the platform only through `window.SCARline`.
- **No Tailwind CDN.** Link the committed bundle: `../../dist.css`.
- **Only declared keys.** Subscribe to bindings and emit actions that
  `widget.json` declares. CoreAPI rejects the rest with
  `UNDECLARED_WIDGET_BINDING` / `UNDECLARED_WIDGET_ACTION`.
- **Fill the frame.** The widget root is transparent and sized to the window
  (`w-full h-full` or equivalent). The researcher owns its size.

## 2. The Manifest

Validated by `WidgetMetadataInputSchema` in `packages/contracts/src/widget.ts`.
**Use the modern object-map shape** for new widgets:

```json
{
  "id": "speedometer",
  "name": "Speedometer",
  "description": "Displays the current vehicle speed and speed limit.",
  "version": "1.0.0",
  "category": "driving",
  "entry": "index.html",
  "bindings": {
    "vehicle.speed": {
      "type": "number",
      "unit": "km/h",
      "description": "Current vehicle speed.",
      "source": "live",
      "staleAfterMs": 5000,
      "preview": 132
    },
    "vehicle.speed_unit": {
      "type": "string",
      "description": "Display unit for speed.",
      "default": "km/h",
      "source": "presentation"
    }
  },
  "actions": {
    "controls.primary": { "description": "Run the primary runtime control action." }
  },
  "ui": {
    "minSize": { "w": 150, "h": 129 },
    "preferredSize": { "w": 150, "h": 129 }
  },
  "window": { "frame": "none", "transparent": true }
}
```

| Field | Rule |
| --- | --- |
| `id` | Matches the directory name |
| `category` | Free-form; the catalogue groups by it (`driving`, `health`, `communication`, `study`, `general`) |
| `entry` | Defaults to `index.html` |
| `bindings` | Object keyed by binding name |
| `actions` | Object keyed by action name, each `{ description, interactionType? }` |
| `ui.minSize` / `ui.preferredSize` | `{ w, h }`, positive integers, enforced by the layout editor |
| `window.frame` | `none` or `default` |

A **legacy** shape is still accepted — `bindings` and `triggers` as arrays, and
`ui.minWidth` / `minHeight` / `preferredWidth` / `preferredHeight`. It is
normalised into the modern shape at load time. Do not write new widgets that
way; only touch it when editing an existing legacy manifest.

### Binding Declarations

| Key | Meaning |
| --- | --- |
| `type` | `number`, `string`, `boolean`, `object`, `array` |
| `label`, `unit`, `description` | Presentation metadata |
| `required` | Whether the widget needs it |
| `default` | Runtime value when nothing is configured |
| `preview` | Example value used by preview launches |
| `source` | `live`, `study`, or `presentation` |
| `staleAfterMs` | How long a value stays fresh |

`default` and `preview` are validated against `type`, so a string default on a
number binding fails catalogue validation instead of surfacing as `NaN`.

**`source` is not decoration:**

- `live` — from the running session. A preview launch can never supply it.
- `study` — condition configuration or a researcher override.
- `presentation` — a display setting such as a unit label.

Suggested `staleAfterMs`: 5 s for continuous readings, 2 s for ECG, 60 s for
blood pressure. These are display-freshness settings, not sampling settings.

## 3. Declarative Bindings

Prefer the shared runtime over hand-written bootstrap script. Include it last:

```html
<link rel="stylesheet" href="../../dist.css" />

<div data-scarline-widget-root class="flex h-full w-full items-center justify-center bg-transparent">
  <span data-bind="vehicle.speed" data-format="number" data-decimals="0"
        class="text-6xl font-bold text-white">—</span>
  <span data-bind="vehicle.speed_unit" class="text-xs text-white/60">km/h</span>
</div>

<script src="../../widget-runtime.js"></script>
```

Attributes the shared runtime implements:

| Attribute | Effect |
| --- | --- |
| `data-scarline-widget-root` | The element visual state is applied to |
| `data-bind` | Binding key for this element |
| `data-bind-text` | `false` suppresses text replacement |
| `data-bind-attr` | Write the value to this attribute instead |
| `data-bind-class` / `data-bind-class-false` | Toggle classes on truthy / falsy values |
| `data-bind-style` / `data-style-unit` | Write to a CSS property, with an optional unit |
| `data-bind-label-true` / `data-bind-label-false` | Swap label text on a boolean |
| `data-format="number"` + `data-decimals` | Numeric formatting |
| `data-action` | Emit this action when clicked |
| `data-chart`, `data-chart-secondary`, `data-chart-trace`, `data-chart-window` | Time-series rendering |

The runtime also writes `data-data-source`, `data-data-status`,
`data-sample-count`, and `data-simulated` onto bound elements. Style against
them; do not set them yourself.

**Always start value elements at `—`.** A missing, invalid, stale, or
disconnected value resets to the element's initial content, so `—` is how the
participant sees "no data" instead of a number that stopped being true.

## 4. The Injected API

Overlay Web freezes `window.SCARline` into the widget frame. Use it only for
behaviour the declarative attributes cannot express.

| Member | Signature |
| --- | --- |
| `ready()` | `(): void` — call last, after listeners are attached |
| `getBinding(key)` | `(string): unknown` |
| `onBinding(key, listener)` | `(string, fn): () => void` |
| `getState()` | `(): "visible" \| "hidden" \| "highlighted"` |
| `onStateChange(listener)` | `(fn): () => void` |
| `getMetadata()` | `(): object` — the normalised manifest |
| `onTrigger(listener)` | `(fn): () => void` |
| `send(action, payload?)` | `(string, object): void` |

```html
<script type="module">
  const { SCARline } = window;

  SCARline.onBinding("vitals.heart_rate", (value) => {
    document.querySelector("#bpm").textContent = value ?? "—";
  });

  SCARline.onStateChange((state) => {
    document.body.dataset.state = state;
  });

  SCARline.ready();
</script>
```

This is a stable public API. Do not rename or remove members.

## 5. Interactions

Actions are round trips, not fire-and-forget. When a widget uses
`data-action`, the shared runtime handles the whole protocol:

- generates a UUID request id per click
- disables every action control and sets `aria-busy` while the result is
  outstanding
- surfaces an error only when the action fails, with a **Retry** button that
  reuses the same request id, so a lost response is retrieved rather than the
  action applied twice
- times out after 12 seconds with a retryable failure
- suppresses routine pending and success messages — a confirmed change should
  be visible in the control itself

Rules the platform enforces, which you cannot work around from the widget:

- A hidden widget cannot submit actions (`WIDGET_HIDDEN`).
- An interaction from a previous condition or another scope is rejected
  (`INTERACTION_CONDITION_CHANGED`, `WIDGET_OUT_OF_SCOPE`).
- A duplicate request id returns the original result.
- Reusing a request id for a different action is `INTERACTION_REQUEST_CONFLICT`.
- Researcher overrides and resets share the same lock and revision, so a late
  response cannot overwrite newer state.

Researchers can also drive a widget directly with
`POST /api/v1/sessions/:id/widgets/trigger` using `trigger`, `show`, `hide`,
`highlight`, `reset`, or `update`. Handle those through `onTrigger` and
`onStateChange`.

## 6. Window And Input Modes

Set per widget instance in the layout, not in the manifest:

| Mode | Meaning |
| --- | --- |
| `windowMode: transparent_electron` | Frameless transparent window on a chosen display |
| `windowMode: browser_popup` | Browser popup positioned by the renderer |
| `inputMode: click_through` | Clicks pass through to the simulator underneath |
| `inputMode: interactive` | The window accepts clicks |

A widget with controls only works when the researcher assigns it
`interactive`. Say so in the widget's `description` if it needs that.

## 7. Styling

- Link `../../dist.css`. Keep only genuinely widget-specific CSS local.
- Keep the body and root transparent so the simulator shows through.
- Stay legible over a moving scene: text shadows, or a semi-transparent backdrop
  such as `bg-black/50`.
- Design for `ui.minSize`; it renders on a driving display in motion.
- After changing widget markup or `widgets/tailwind-source.css`, regenerate the
  committed bundle — `npm run check` fails on a stale one:

```bash
npm run widgets:build-css
```

This repository uses **npm**, not pnpm.

## 8. Adding A Widget

1. Create `widgets/components/<id>/` with `widget.json` and the entry file.
2. `npm run widgets:build-css` if you used new Tailwind classes.
3. Refresh the catalogue: **Participant View → refresh**, or
   `POST /api/v1/widgets/refresh`. An invalid manifest is rejected with
   `409 WIDGET_CATALOGUE_INVALID` and the specific issues.
4. Place it in a layout and **Launch** a preview — it uses your `preview` values
   and never touches a live session.
5. Verify it in a real session with live data.

## 9. Testing

```bash
npm run test:widgets
```

Builds contracts and Overlay Web, then runs `tests/e2e/widget-runtime.spec.ts`
(Chromium) and `tests/e2e/widget-interactions.spec.mts` (Electron) against real
widgets, the renderer HTTP routes, and the WebSocket hub with fixture study
data. CoreAPI's `widget-interactions.test.ts` covers state transitions, audit
rollback, duplicate requests, scope checks, and researcher control.

## 10. Honesty Rules

These are not style preferences — they protect the research record.

- **Never fabricate a value.** An absent reading is `—`, never `0`.
- **Never derive a clinical claim.** A BPM number is a number, not a diagnosis.
  An ECG trace is drawn from received samples or not drawn at all; BPM never
  generates a waveform.
- **Label simulated data as simulated.** The Synthetic Sensor Suite is a test
  signal; the runtime marks it with `data-simulated` and the UI says so.
- **Do not mix sources.** When several sources could supply a binding and none
  is selected, the status is `ambiguous` and the value is withheld. Show that
  state rather than picking one.

## 11. Checklist

- [ ] `widget.json` `id` matches the directory name
- [ ] Modern object-map `bindings` and `actions`, `ui.minSize` / `preferredSize`
- [ ] Every binding declares `type`, `source`, and — for live data — `staleAfterMs`
- [ ] `preview` values on every `live` binding, so previews are useful
- [ ] Value elements start at `—`
- [ ] Root is `data-scarline-widget-root`, transparent, and fills the frame
- [ ] `../../dist.css` linked; `../../widget-runtime.js` included last
- [ ] No `fetch`, no WebSocket, no CDN
- [ ] Only declared binding keys and action names are used
- [ ] `npm run widgets:build-css` run after class changes
- [ ] `npm run test:widgets` passes
