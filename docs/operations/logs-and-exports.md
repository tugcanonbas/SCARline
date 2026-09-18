# Logs And Exports

## Session Logs

**Session Logs** (`/session-logs`) is the global event view across every study the
account can see. Backed by `GET /api/v1/session-events`.

Filters: `studyId`, `sessionId`, `eventType`, `modality`. Paging is cursor-based on
`(timestamp, id)` descending, with a default page of 100 and a maximum of 500 — stable
even while new events arrive.

Alongside the page, the response returns aggregates **for the current filter**, not for
the page:

| Aggregate | Meaning |
| --- | --- |
| `activeStudyCount` | Distinct studies in `configured`, `ready`, or `running` |
| `sessionCount` | Distinct sessions matched |
| `eventCount` | Events matched |
| `storedPayloadBytes` | On-disk size of the matched payloads |

Each row carries study and session context, the timestamp, event type, modality, source
type, source id and key, routing key, schema version, and the full payload.

**Session Log Detail** (`/session-logs/:id`) narrows to one session with a colour-coded
event timeline and an expandable event stream.

Access follows study membership: an admin sees everything, anyone else sees only events
from studies they belong to. The filter is applied in SQL, so both the page and the
aggregates respect it.

## Reading The Event Stream

Routing keys are structured, which makes them the fastest filter:

```text
events.<studyId>.<sessionId>.<modality>.<eventType>
```

| Modality | Typical events |
| --- | --- |
| `lifecycle` | `command-queued`, `command-processing`, `session-start`, `session-fail`, `command-timed-out` |
| `driving` | `vehicle.telemetry`, `simulator.collision`, `simulator.lane-invasion` |
| `health`, `attention`, … | `io.<channelKey>` sensor batches |
| `command` | `ack` acknowledgements from components |
| `trigger` | `rule-fired` |
| `annotation` | `created` — operator notes |
| `error` | `command-failed`, `command-timeout`, `sensor-disconnected`, `overlay-open-failed`, `simulator-cleanup-warning` |

An event on a `.lifecycle.`, `.trigger.`, `.annotation.`, or `.error.` key is always
stored, regardless of the study's sampling policy. Telemetry and sensor events are
subject to `dataPolicy.persistence`.

## Retention

A study whose `dataPolicy.persistence.retentionDays` is set has its old events deleted
by an hourly job. Left unset (the default), events are kept indefinitely.

Export before retention removes anything you need.

## Exports

**Exports** (`/exports`) queues background jobs. Requires `admin` or `researcher`.

| Option | Values |
| --- | --- |
| `scope` | `study`, `participant`, `session`, `session_condition` |
| `targetId` | The id of that object |
| `format` | `csv`, `json`, or `both` (default) |
| `pseudonymize` | Default `true` |
| `includeDemographics` | Default `false` |

`POST /api/v1/exports` returns `202` with a job id. A worker polls every 500 ms, claims
one job at a time with `FOR UPDATE SKIP LOCKED`, and broadcasts progress on the
`export.progress` channel. Jobs left `running` when CoreAPI restarts are requeued.

### What The Archive Contains

A ZIP with one file per table, in the requested formats:

| File | Rows |
| --- | --- |
| `studies.*` | Matched studies, without `created_by` |
| `conditions.*` | Every condition of those studies, in order |
| `participants.*` | Matched participants, pseudonymised unless disabled |
| `sessions.*` | Matched sessions, without `started_by_user_id` |
| `session_conditions.*` | Their conditions with configuration snapshots |
| `session_events.*` | The event stream, with user references stripped from payloads |

### Privacy Handling

- With `pseudonymize` on (the default), each participant code is replaced with a stable
  alias `participant-001`, `participant-002`, … within the archive.
- Demographic data is **omitted** unless `includeDemographics` is explicitly true.
- `created_by` and `started_by_user_id` are dropped.
- Event payloads are walked recursively and `createdBy`, `requestedBy`, `actorUserId`,
  and `startedByUserId` are removed at every depth.

The configuration snapshot in `session_conditions` is what makes an archive
self-describing: it records the simulator and sensor configuration the session actually
ran with, not the study's current settings.

### Downloading And Deleting

`GET /api/v1/exports/:id/download` streams the archive once the job is `completed`. The
resolved path must stay inside `api.exports_directory`; anything else fails with
`INVALID_EXPORT_PATH`.

Deleting a job removes the artifact from disk. A `queued` job is cancelled; a `running`
one cannot be deleted — wait for it to finish.

Artifacts live in `.runtime/exports/`. Deleting that directory leaves the job rows
behind with broken downloads.

## Operator Workflow

1. Confirm every session in scope reached a terminal status.
2. Review Session Logs and add any missing annotation **before** exporting.
3. Queue the export at the narrowest scope that answers your question.
4. Watch progress on the Exports screen.
5. Download the archive and keep the study and condition metadata with it — the
   `session_events` table alone is not interpretable without them.

## Read Next

- [Data And Realtime](/platform/data-and-realtime)
- [Database Schema](/reference/database)
- [CoreAPI Routes](/reference/core-api)
