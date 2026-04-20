# Exports And Evidence

SCARline turns runtime behavior into a reviewable evidence set rather than leaving it as transient UI state.

## Evidence Sources

- session lifecycle records
- persisted event stream
- telemetry and sensor events
- trigger actions
- operator notes
- component health context

## Export Model

Export jobs can be requested for:

- a study
- a session
- the full dataset

Supported formats include `json`, `csv`, and `zip`.

## Operator Workflow

1. verify the session is complete or otherwise in the intended final state
2. inspect `Session Logs`
3. queue the export in `Exports`
4. monitor export progress
5. retrieve the generated artifact path once the job is complete

## Good Practice

- annotate anomalies before exporting
- prefer complete session context over raw telemetry alone
- keep study and condition metadata with downstream analysis artifacts
