# Widget interactions

Health readings, Sensor Health and Speedometer now separate `preview` examples
from runtime `default` values. A binding's `source` is `live`, `study` or
`presentation`; condition configuration and researcher overrides are study
content. Preview launches use examples and cannot consume a live session's data.
Missing, invalid, stale or disconnected measurements display `—`. No routine
pending/success notifications are shown.

Heart Rate, Blood Pressure, SpO2 and Respiration plot **received reading trends**
over the last 60 seconds, with a shared scale for the two blood-pressure values.
The ECG trace plots only `vitals.ecg_samples` over eight seconds; BPM never
generates an ECG shape or a rhythm diagnosis. Sample values determine the vertical
scale. Gaps break the line. Stale traces remain dimmed as history while current
numbers clear. Source details are available in **Active Study → Widget data
sources**, including last-sample time, waiting/stale/disconnected states and
researcher overrides. The speed gauge requires both speed and a positive speed
limit; it never fills from an example or a missing value converted to zero.

CoreAPI unpacks I/O batches (`heartRateBpm`, `ecgSamples` and the `ecg` channel's
scalar `value`) and retains bounded, timestamped histories in memory. New I/O
batches carry `sampleTimestamps`; older batches use `sourceTimestamp` and
`sampleRate`. ECG packet arrays use their own sample rate, ending at the packet's
reading timestamp. Renderers receive the current history at most ten times per
second and draw once per animation frame. This delivery limit does not discard
samples from the bounded widget history. Silent streams still expire normally.
Each popup subscribes only to its own widget; the layout launcher receives
lifecycle events without sensor histories.
Duplicate/late packets cannot rewind the plot. Reload/reconnect uses the cached
timestamps; a CoreAPI restart returns to waiting until new samples arrive.

Binding mappings accept an existing dotted path string, or
`{"path":"vitals.heart_rate","sourceKey":"driver:heart_rate"}` to select a
particular source. Multiple sources for the same measurement require selection;
their data is never silently mixed. External ECG mappings may supply
`vitals.ecg_samples` as `[{"timestamp":1750000000000,"value":0.25}]`; timestamps
are Unix milliseconds, and a null value is a gap. `staleAfterMs` is per binding:
the supplied defaults are 5 seconds for continuous readings, 2 seconds for ECG,
and 60 seconds for blood-pressure readings. These are display freshness settings.

Sensor Health counts **observed I/O channels**, not all configured sensors, and
labels that denominator explicitly. A connected device or WebSocket alone does
not establish streaming. `driver:mock` remains identified as that upstream source;
its data is simulated. Real hardware is needed to produce physical measurements.

For a hardware-free test, enable **Synthetic Sensor Suite** under **Sensors**,
then **Save Sensor Configuration** before creating the next test session. The
suite supplies varying heart rate, ECG, blood pressure, SpO2 and respiration,
alongside steering and eye tracking. Existing studies need to save their sensor
configuration again to select the new channels; already created session snapshots
are left intact. Sensor setup is editable only in draft/configured studies. Use
a new draft test study if the existing study is already running or completed.
Launch the live widgets from **Active Study**. Charts and source
diagnostics label this data **Simulated**. The ECG is a generated test signal with
changing rate and amplitude; it is not a physiological recording or diagnosis.
Sensor Health lists all observed channels in a scrollable area at its existing
window size. Blood pressure displays systolic above diastolic.

Sensor event names preserve channel keys such as `heart_rate` and `eye_tracking`.
These names are accepted by the shared RabbitMQ envelope contract. Low-rate
channels publish each reading immediately when waiting for the next reading
would exceed the configured batch interval.

Launch a widget or layout from Participant View to test its controls. Active Call
supports mute, hold, and exclusive Bluetooth/speaker selection. Music supports
simulated play/pause and progress through the configured track duration. These
controls simulate study content; they do not place calls, route device audio or
play an audio file. Other declared actions continue to emit interaction events.

Widgets use the existing `SCARline.send` and binding/trigger API. The shared
runtime gives each click a request ID, disables controls while awaiting the
result, and shows an error only when an action fails. Routine pending and success
notifications are hidden; confirmed changes appear in the controls themselves.
When a response is lost, **Retry**
uses the same ID to retrieve the result without applying a toggle twice. Hidden
widgets cannot submit actions, including through direct renderer requests.

CoreAPI holds live state in the current session condition alongside researcher
overrides. Each accepted interaction is saved with an outbox audit event in the
same transaction. Researcher changes and reset use the same lock and revision;
old responses cannot overwrite newer state. Reconnecting delivers a complete
snapshot, including cleared bindings. Interactions from an earlier condition or
a different widget scope are rejected.

Participant View test launches receive an independent preview ID. Their state
survives window reloads and WebSocket reconnects but is held only in CoreAPI
memory. Relaunching or restarting CoreAPI resets it. Preview state never changes
the saved layout, a live session or participant event data. Inactive previews
expire after 24 hours; a preview can record up to 4,096 requests before relaunch.
The editor's embedded thumbnails remain static; use its launch controls for an
interactive test window.

For Music, `media.position_seconds` and `media.duration_seconds` can configure
the simulated position and duration. Existing time labels are also supported.
`media.playback_started_at` is the runtime clock anchor in Unix milliseconds.
Progress is calculated from the anchor without polling or a database write on
each tick. Researcher playback changes rebase the clock; reset restores the
condition's configured starting values.

Run `npm run test:widgets` for the isolated Chromium and Electron checks. They use
real widgets, renderer HTTP routes and the WebSocket hub with fixture study
data. CoreAPI's `widget-interactions.test.ts` covers state transitions, audit
rollback, duplicate requests, scope checks and researcher control.
