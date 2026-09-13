# Widget interactions

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
