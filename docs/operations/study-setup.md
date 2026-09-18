# Study Setup

Everything on this page happens while the study is `draft` or `configured` and before
any session reaches `ready`. After that the configuration locks.

## The Screens

Each study has a tab strip; the order below is the order the Quick Start checklist
follows.

| Screen | Path | Owns |
| --- | --- | --- |
| Overview | `/user-studies/:id/overview` | Metadata, Quick Start checklist, lifecycle controls |
| Participants | `/user-studies/:id/participants` | Anonymised participant records |
| Simulator Setup | `/user-studies/:id/carla-config` | Per-condition simulator type and configuration |
| Sensors | `/user-studies/:id/sensors` | Device assignments, channel rates, required flags |
| Participant View | `/user-studies/:id/participant-view` | Layout canvas, widget placement, displays |
| Conditions | `/user-studies/:id/conditions` | Experimental variants and their order |
| Sessions | `/user-studies/:id/sessions` | Session creation and the condition queue |
| Active Study | `/user-studies/:id/active-study` | Live operation |

## Conditions Own The Configuration

This is the single most important structural fact: simulator settings, device
assignments, sensor configuration, layouts, and trigger rules all belong to a
**condition**, not to the study.

A study with three conditions has three simulator configurations and three participant
layouts. Creating a condition **from a template** copies the source condition's
simulator configuration, device assignments and their sensor configuration, layouts, and
widget instances, so you configure one variant properly and clone it.

Conditions carry an `order`, which is the default queue order for new sessions.

## Participants

Create one record per participant with an anonymised `participantCode`, optional
demographic JSON, and notes. Participants are study-scoped and editable until the study
is `completed` or `archived`. A participant with sessions cannot be deleted.

Keep identifying information out of the platform. The participant code is the link to
whatever consent record you keep elsewhere.

## Simulator Setup

Choose the simulator type per condition and save its configuration:

- **`mock`** takes no configuration and produces deterministic telemetry.
- **`carla`** is validated against the full CARLA session schema — map, weather preset or
  custom weather, ego vehicle blueprint, control mode, random seed, traffic and
  pedestrian counts, sun angle, spectator position, recording, and sensor blueprints.
  Synchronous mode and the `0.05 s` fixed delta are pinned, so runs stay reproducible.

Set `controlMode: io` when the participant drives with the steering hardware,
`autopilot` for an automated ego vehicle, and `external` when something else controls it.

Saving requires `admin` or `researcher`, and a saved configuration is what the
`simulator` readiness check looks for.

## Sensors

The screen joins three things: the driver catalogue read from
`services/io-client/drivers/`, the device registry, and the current condition's
assignments.

- **Refresh sensor drivers** re-reads the manifests. A manifest that fails validation is
  rejected with `SENSOR_CATALOGUE_INVALID` and the specific issues.
- **Apply defaults** attaches every catalogued driver that has a registered device, at
  each channel's declared sample rate, marking the steering wheel as required.
- **Save Sensor Configuration** persists the assignment: per-channel sample rates, the
  `required` flag, whether the device records media, and free-form metadata.

Marking a device **required** has two consequences: readiness blocks until the device is
`connected` and configured, and a mid-session disconnect fails the session rather than
continuing.

::: tip Testing without hardware
Enable the **Synthetic Sensor Suite** and save. It supplies heart rate, ECG, blood
pressure, SpO2, respiration, steering, and eye tracking, all labelled simulated.
Existing studies must save their sensor configuration again to pick up new channels;
snapshots already taken by created sessions are left alone.
:::

## Participant View

The layout editor places widgets for the selected condition.

- Drag from the catalogue onto the canvas; the inspector edits geometry, window mode,
  input mode, target display, bindings, and style overrides.
- Widget geometry is constrained by the manifest's `minSize`.
- Each widget needs a target display. When a desktop overlay host is connected, display
  ids are validated against it.
- **Launch** opens a widget or the whole layout as a preview, using each binding's
  `preview` value. Preview state is in-memory only and never touches a saved layout or a
  live session.

The editor autosaves drafts and keeps an explicit **Save Layout**. Saving is
transactional across conditions with an expected revision per layout; if another session
changed a layout in the meantime the whole save is rejected rather than partially
applied.

## Trigger Rules

Trigger rules are condition-scoped and evaluated against every session event.

A rule has a name, a boolean `expression`, an `actionType`, an `actionConfig`, an
`enabled` flag, a `priority`, and a `cooldownMs`.

Expressions combine `and`, `or`, `not` with comparisons — `eq`, `ne`, `gt`, `gte`, `lt`,
`lte`, `in` — against a dotted `path` into the event payload, compared to a literal
`value` or to another path with `valuePath`.

```json
{
  "operator": "and",
  "expressions": [
    { "operator": "gt", "path": "speed", "value": 30 },
    { "operator": "eq", "path": "modality", "value": "driving" }
  ]
}
```

Action types: `widget.update`, `overlay.command`, `session-condition.advance`, and
`simulator.command`. `cooldownMs` prevents a rule from firing repeatedly on a
high-frequency stream; per-session rule state is tracked in `trigger_rule_state`.

## Sessions

A session pairs one participant with an ordered queue of conditions. Selecting no
conditions queues every active condition in its configured order.

Sessions can be created while the study is `configured`, `ready`, or `running`. Every
selected condition must be active and belong to the study.

## Before You Run

Work the Quick Start checklist on Overview until every blocking item is green, then
**Mark Configured** and **Mark Ready**. The details of each check are in
[Study Readiness](/operations/study-readiness).

## Read Next

- [Study Readiness](/operations/study-readiness)
- [Running A Session](/operations/running-a-session)
- [Widgets And Layouts](/reference/widgets-and-layouts)
