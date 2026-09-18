# Building Widgets

A widget is a directory of static files. There is no build step, no framework, and no
bundler — which is what lets the catalogue be a read-only volume that a running CoreAPI
picks up without an image rebuild.

```text
widgets/components/<widget-id>/
├── widget.json     manifest (required)
├── index.html      entry (default; override with `entry`)
└── <widget-id>.png optional catalogue thumbnail
```

Shared assets live beside the components: `widgets/dist.css` (generated Tailwind),
`widgets/widget-runtime.js` (the binding helper), `widgets/images/`, `widgets/icons/`.

## The Manifest

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

| Field | Notes |
| --- | --- |
| `id` | Must match the directory name |
| `category` | Free-form; the catalogue groups by it (`driving`, `health`, `communication`, `study`, `general`) |
| `entry` | Defaults to `index.html` |
| `bindings` | Keyed object of binding declarations |
| `actions` | Keyed object of the actions the widget can emit |
| `ui.minSize` / `ui.preferredSize` | Enforced by the layout editor |
| `window` | `frame` is `none` or `default`; `transparent` for overlay use |

A legacy array form is also accepted (`bindings` and `triggers` as arrays,
`ui.minWidth`/`minHeight`/`preferredWidth`/`preferredHeight`) and normalised into the
same internal shape. Prefer the object form for new widgets.

### Binding Declarations

| Key | Meaning |
| --- | --- |
| `type` | `number`, `string`, `boolean`, `object`, `array` |
| `unit`, `label`, `description` | Presentation metadata |
| `required` | Whether the widget needs it |
| `default` | Runtime value when nothing is configured |
| `preview` | Example value used by preview launches |
| `source` | `live`, `study`, or `presentation` |
| `staleAfterMs` | How long a value stays fresh |

`default` and `preview` are validated against `type`, so a string default on a number
binding fails catalogue validation rather than showing up as `NaN` at run time.

`source` is not decoration:

- `live` — from the running session; a preview launch can never supply it
- `study` — condition configuration or a researcher override
- `presentation` — a display setting such as a unit label

Suggested `staleAfterMs`: 5 s for continuous readings, 2 s for ECG, 60 s for blood
pressure. These are display-freshness settings, not sampling settings.

## Declarative Bindings

Include the shared runtime and annotate elements:

```html
<script src="../../widget-runtime.js"></script>

<div data-scarline-widget-root>
  <div data-bind="vehicle.speed" data-format="number" data-decimals="0">—</div>
  <div data-bind="vehicle.speed_unit">km/h</div>
</div>
```

| Attribute | Effect |
| --- | --- |
| `data-scarline-widget-root` | Marks the element the runtime applies visual state to |
| `data-bind` | Binding key for this element |
| `data-bind-text` | `false` to suppress text replacement |
| `data-bind-attr` | Write the value to this attribute instead |
| `data-bind-class` / `data-bind-class-false` | Toggle classes on truthy / falsy values |
| `data-bind-style` / `data-style-unit` | Write to a CSS property, with an optional unit |
| `data-bind-label-true` / `data-bind-label-false` | Swap label text on a boolean |
| `data-format="number"` + `data-decimals` | Numeric formatting |
| `data-action` | Emit this action when clicked |
| `data-chart`, `data-chart-trace`, `data-chart-window`, `data-chart-secondary` | Time-series rendering |

Show `—` as the initial content of every value element. A missing, invalid, stale, or
disconnected value resets to it, which is how the participant sees "no data" rather than
a stale number.

## The Runtime API

For anything the declarative attributes cannot express, use the injected bridge:

```html
<script type="module">
  const { SCARline } = window;

  SCARline.onBinding("vitals.heart_rate", (value) => {
    document.querySelector("#bpm").textContent = value ?? "—";
  });

  SCARline.onStateChange((state) => {
    document.body.dataset.state = state;   // visible | hidden | highlighted
  });

  document.querySelector("#mute").addEventListener("click", () => {
    SCARline.send("call.mute", { muted: true });
  });

  SCARline.ready();
</script>
```

| Member | Purpose |
| --- | --- |
| `ready()` | Signal that the widget has mounted — call it last |
| `getBinding(key)` | Current value |
| `onBinding(key, fn)` | Subscribe; returns an unsubscribe function |
| `getState()` / `onStateChange(fn)` | Visibility |
| `getMetadata()` | The normalised manifest |
| `onTrigger(fn)` | Trigger and interaction-result events |
| `send(action, payload)` | Emit a declared action |

`window.SCARline` is frozen and non-configurable. The widget runs in a sandboxed iframe
with an opaque origin and has no other access to the host page, CoreAPI, or cookies.

## Actions And Interaction Results

Actions are round trips, not fire-and-forget. The shared runtime gives each click a
request id, disables the control while the result is outstanding, and surfaces an error
only when the action actually fails — routine pending and success toasts are suppressed
because a confirmed change should be visible in the control itself.

If a response is lost, **Retry** reuses the same request id so the result is retrieved
rather than the action applied twice. CoreAPI stores widget state on the current session
condition with a revision, so a late response cannot overwrite newer state, and a hidden
widget cannot submit at all.

## Adding A Widget

1. Create `widgets/components/<id>/` with `widget.json` and the entry file.
2. Regenerate the widget CSS if you used new Tailwind classes:
   `npm run widgets:build-css`.
3. Refresh the catalogue: **Participant View → refresh**, or
   `POST /api/v1/widgets/refresh`. Invalid manifests are rejected with
   `WIDGET_CATALOGUE_INVALID` and the specific issues.
4. Place it in a layout and **Launch** a preview — it uses your `preview` values.
5. Verify it in a real session with live data.
6. Run `npm run test:widgets`.

## Testing

```bash
npm run test:widgets
```

The suites run real widgets against the renderer HTTP routes and the WebSocket hub with
fixture study data, in both Chromium and Electron. CoreAPI's
`widget-interactions.test.ts` covers state transitions, audit rollback, duplicate
requests, scope checks, and researcher control.

## Guidelines

- Keep the widget legible at its `minSize`; it renders on a driving display in motion.
- Use transparency deliberately — `window.transparent` and a transparent body let the
  simulator show through.
- Never fabricate a value. An absent reading is `—`, not `0`.
- Label simulated data as simulated; the synthetic sensor suite is a test signal.
- Do not derive a clinical claim from a signal. A BPM value is a number, not a diagnosis,
  and an ECG trace is drawn from samples or not drawn at all.

## Read Next

- [Widgets And Layouts](/reference/widgets-and-layouts)
- [Overlay And Widgets](/platform/overlay-and-widgets)
- [Testing](/builders/testing)
