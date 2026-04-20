# Active Session Operations

The `Active Study Controls` surface is where live supervision happens.

## Primary Responsibilities During A Run

- start the session from a `created` state
- monitor telemetry and component health
- pause and resume when operationally necessary
- trigger manual widget actions when the protocol calls for them
- add notes when anomalies, interruptions, or operator interventions occur
- complete or cancel the session explicitly

## Live State You Should Watch

- current session status
- telemetry freshness
- sensor status
- overlay/widget behavior
- simulator connectivity
- component degradation or disconnects

## Session State Rules

- only `created` sessions should be started
- `running` sessions can be paused, completed, or cancelled
- `paused` sessions can resume or be cancelled
- explicit completion/cancellation matters for downstream evidence integrity

## If Something Goes Wrong Mid-Run

1. stabilize the participant experience first
2. decide whether the correct action is pause, continue, or controlled cancel
3. capture an operator note with enough context for later interpretation
4. recover the failing dependency in order if the session is recoverable

## Related Reference

- [Study Lifecycle](/platform/study-lifecycle)
- [Realtime And Events](/reference/realtime-and-events)
- [Incidents And Recovery](/operations/incidents-and-recovery)
