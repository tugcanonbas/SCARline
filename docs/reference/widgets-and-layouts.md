# Widgets And Layouts

## Manifest

`widgets/components/<id>/widget.json`, validated by `WidgetMetadataInputSchema`. Two
forms are accepted and normalised into one.

### Modern Form

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Matches the directory name |
| `name` | string | |
| `description` | string | |
| `version` | string | |
| `category` | string | Free-form; used for grouping |
| `entry` | string | Defaults to `index.html` |
| `bindings` | object | Keyed by binding name |
| `actions` | object | Keyed by action name, each `{ description, interactionType? }` |
| `ui.minSize` | `{ w, h }` | Positive integers |
| `ui.preferredSize` | `{ w, h }` | Positive integers |
| `window.frame` | `none` \| `default` | Optional |
| `window.transparent` | boolean | Optional |

### Legacy Form

`bindings` as an array of `{ key, type, ... }`, `triggers` as an array of
`{ action, description, interactionType? }`, and `ui.minWidth` / `minHeight` /
`preferredWidth` / `preferredHeight`. Normalised into the modern shape at load time.

### Binding Declaration

| Field | Type | Notes |
| --- | --- | --- |
| `type` | `number` \| `string` \| `boolean` \| `object` \| `array` | Required |
| `label`, `unit`, `description` | string | Presentation |
| `required` | boolean | |
| `default` | any | Validated against `type` |
| `preview` | any | Validated against `type`; used by preview launches |
| `source` | `live` \| `study` \| `presentation` | |
| `staleAfterMs` | positive integer | Display freshness |

## Layout

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | |
| `conditionId` | uuid | A layout belongs to a condition |
| `name` | string | |
| `type` | `participant` \| `researcher_monitor` | |
| `targetDisplay` | string \| null | Default display |
| `layoutConfig` | object | Editor state |
| `revision` | positive integer | Optimistic concurrency |
| `widgets` | array | Widget instances |

## Widget Instance

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `layoutId`, `widgetId` | uuid | |
| `windowMode` | `transparent_electron` \| `browser_popup` | |
| `inputMode` | `click_through` \| `interactive` | |
| `targetDisplay` | string | Display id, or `primary` |
| `order` | integer ≥ 0 | Stacking and launch order |
| `x`, `y` | integer | Display-relative |
| `width`, `height` | positive integer | |
| `enabled` | boolean | |
| `configuration` | object | Widget-specific |
| `bindingsConfig` | object | Binding key → data path or `{ path, sourceKey }` |
| `styleOverrides` | object | |

## Binding Mappings

`bindingsConfig` maps a widget binding key to a data path:

```json
{ "vitals.heart_rate": "vitals.heart_rate" }
```

```json
{ "vitals.heart_rate": { "path": "vitals.heart_rate", "sourceKey": "driver:heart_rate" } }
```

`sourceKey` selects one source when several could supply the binding. Without it and with
more than one candidate, the binding reports `ambiguous` — data from multiple sources is
never silently mixed.

External ECG data may supply `vitals.ecg_samples` as
`[{ "timestamp": 1750000000000, "value": 0.25 }]`, with Unix-millisecond timestamps and
`null` for a gap.

## Binding Data

Every value delivered to a renderer carries metadata:

| Field | Meaning |
| --- | --- |
| `source` | `live`, `preview`, `study`, `presentation` |
| `status` | `ready`, `waiting`, `receiving`, `stale`, `disconnected`, `ambiguous` |
| `sourceKey` | The selected source, or `null` |
| `path` | The resolved data path |
| `timestamp`, `receivedAt` | Unix milliseconds |
| `staleAfterMs` | Freshness window |
| `simulated` | Present and true for synthetic sources |
| `history` | Bounded time series for array bindings |

## Bulk Layout Save

`PUT /api/v1/studies/:studyId/layouts/participant`

```json
{
  "name": "Participant layout",
  "targetDisplay": "primary",
  "layoutConfig": {},
  "expectedRevisions": [
    { "conditionId": "<uuid>", "layoutId": "<uuid or null>", "revision": 3 }
  ],
  "widgets": [ ]
}
```

Applied in one transaction across every listed condition. A stale `revision` rejects the
whole save. The response returns the primary layout id, the widget ids with their order,
and each layout's new revision.

## Session Window Save

`PUT /api/v1/sessions/:id/overlay/windows/:instanceId` persists a moved or resized
participant window during a run. It takes an `expectedRevision` and the same geometry
fields, and returns the session, condition, layout, new revision, and instance id.

## Overlay Runtime Scope

Every overlay credential carries:

| Field | Notes |
| --- | --- |
| `rendererMode` | `desktop` or `browser` |
| `studyId`, `conditionId`, `layoutId` | Required |
| `sessionId` | `null` for previews |
| `instanceId` | `null` for a whole layout |
| `previewId` | Present for preview launches |

## Runtime API

`window.SCARline`, frozen and non-configurable, inside the sandboxed widget frame:

| Member | Signature |
| --- | --- |
| `ready()` | `(): void` |
| `getBinding(key)` | `(string): unknown` |
| `onBinding(key, listener)` | `(string, fn): () => void` |
| `getState()` | `(): "visible" \| "hidden" \| "highlighted"` |
| `onStateChange(listener)` | `(fn): () => void` |
| `getMetadata()` | `(): object` |
| `onTrigger(listener)` | `(fn): () => void` |
| `send(action, payload?)` | `(string, object): void` |

## Declarative Attributes

Provided by `widgets/widget-runtime.js`:

| Attribute | Effect |
| --- | --- |
| `data-scarline-widget-root` | The element visual state is applied to |
| `data-bind` | Binding key |
| `data-bind-text` | `false` suppresses text replacement |
| `data-bind-attr` | Write to this attribute |
| `data-bind-class` / `data-bind-class-false` | Toggle classes on truthy / falsy |
| `data-bind-style` / `data-style-unit` | Write to a CSS property |
| `data-bind-label-true` / `data-bind-label-false` | Boolean label swap |
| `data-format="number"` / `data-decimals` | Numeric formatting |
| `data-action` | Emit this action on click |
| `data-chart`, `data-chart-trace`, `data-chart-window`, `data-chart-secondary` | Time-series rendering |

## Asset Routes

| Route | Serves |
| --- | --- |
| `/assets/<widget>/<file>` | Widget component files |
| `/images/*`, `/icons/*` | Shared assets |
| `/dist.css` | Generated Tailwind bundle |
| `/widget-runtime.js` | The shared runtime helper |
| `/launcher/:layoutId`, `/widget/:instanceId` | Renderer shells |
| `/runtime-config.json`, `/client.js`, `/bridge.js`, `/browser-position.js` | Renderer plumbing |

Overlay Web serves these on port 4000; the Admin Panel mirrors them under `/overlay/`
for the editor. Both resolve through `realpath` and reject anything outside the widgets
root.

## Catalogue Widgets

Shipped under `widgets/components/`:

`activecall`, `appointments`, `avatar`, `bp`, `calendar`, `calldeclined`, `callended`,
`contact`, `contactlist`, `ecg`, `hr`, `incomingcall`, `music`, `navigation-prompt`,
`operator-controls`, `operator-notes`, `outgoingcall`, `resp`, `sensor-health`,
`session-timeline`, `speedometer`, `spo2`, `study-instruction`, `time`.

## Read Next

- [Building Widgets](/builders/widgets)
- [Overlay And Widgets](/platform/overlay-and-widgets)
- [CoreAPI Routes](/reference/core-api)
