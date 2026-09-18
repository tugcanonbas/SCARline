# Study Readiness

Readiness is the checkpoint between design-time configuration and a participant run.
`GET /api/v1/studies/:studyId/readiness` returns exactly nine checks, evaluated live
against both configuration and current component health.

Each check reports:

| Field | Meaning |
| --- | --- |
| `key` | Which check |
| `status` | `ready` or `not_ready` |
| `blocking` | Whether it prevents `configured → ready` |
| `blockingCode` | Machine-readable reason when not ready |
| `message` | Operator-facing explanation |
| `correctionRoute` | The screen that fixes it |
| `details` | Ids and counts for the affected objects |

`ready` at the top level is true when every **blocking** check is `ready`. Non-blocking
checks are warnings: they surface real problems but do not stop the transition.

## The Nine Checks

| Key | Blocking | Ready when |
| --- | --- | --- |
| `participants` | Yes | At least one participant exists |
| `conditions` | Yes | At least one active condition exists |
| `simulator` | Yes | Every active condition has a simulator configuration **and** Sim-Bridge is reporting |
| `sensors` | Yes | Every required device is configured, `connected`, and the IO Client is reporting |
| `participant_view` | Yes | Every active condition has a participant layout with at least one enabled, resolvable widget |
| `desktop_host` | No | A desktop overlay host is connected, selected, and ready |
| `displays` | No | Every desktop widget targets a display the selected host actually has |
| `widget_renderer` | No | The renderer each widget needs is available |
| `study_status` | No | The study is `ready`, `running`, `completed`, or `archived` |

## Blocking Codes

| Code | Meaning | Fix |
| --- | --- | --- |
| `PARTICIPANT_REQUIRED` | No participants | Add one under Participants |
| `CONDITION_REQUIRED` | No active conditions | Create one under Conditions |
| `SIMULATOR_CONFIGURATION_REQUIRED` | A condition has no simulator configuration | Save it under Simulator Setup; `details.missingConditionIds` names them |
| `SIMULATOR_UNAVAILABLE` | Sim-Bridge is not reporting | Check `scarline status` and the sim-bridge container |
| `REQUIRED_SENSOR_CONFIGURATION_MISSING` | A required device has no enabled sensors | Configure its channels under Sensors |
| `REQUIRED_SENSOR_UNAVAILABLE` | A required device is not `connected`, or the IO Client is silent | Connect the hardware; check the IO Client |
| `PARTICIPANT_LAYOUT_REQUIRED` | A condition has no participant layout | Create one under Participant View |
| `PARTICIPANT_WIDGET_REQUIRED` | A layout exists but is empty | Place at least one widget |
| `PARTICIPANT_WIDGET_UNAVAILABLE` | A placed widget is no longer in the catalogue | Refresh the widget catalogue or replace the widget |

## Warning Codes

| Code | Meaning |
| --- | --- |
| `DESKTOP_HOST_UNAVAILABLE` | No desktop overlay host is connected |
| `DESKTOP_HOST_SELECTION_REQUIRED` | Several hosts are connected and none is selected |
| `DESKTOP_HOST_NOT_READY` | The selected host is connected but not ready |
| `DISPLAY_ASSIGNMENT_MISSING` | A desktop widget targets a display the host does not have |
| `WIDGET_RENDERER_UNAVAILABLE` | The desktop renderer is unavailable — start the session in browser mode instead |
| `STUDY_NOT_MARKED_READY` | The study is still `draft` or `configured` |

## Where It Appears

- **Overview → Quick Start** renders the checklist, each item linking to its
  `correctionRoute`.
- **Mark Ready** is replaced by a link to the first blocking check's correction route
  while readiness is failing.
- `POST /studies/:studyId/transition` to `ready` re-evaluates inside the transaction and
  rejects with the blocking check's code, message, and the full readiness payload.

Readiness is computed on every request, so a component that comes back healthy clears
its check on the next page load without any manual reset.

## Operational Checklist

Before a participant arrives, confirm beyond the automated checks:

- the session exists and queues the intended conditions in the intended order
- the correct simulator is running — mock and CARLA both satisfy the `simulator` check,
  and using the wrong one is a protocol error the platform cannot detect
- optional sensors you intend to use are actually streaming, not just configured
- participant windows land on the right physical screens
- any deviation is noted before the run: mock instead of CARLA, a missing optional
  sensor, a substituted display, a last-minute condition change, or a decision to
  proceed degraded

Those notes are what make a degraded run interpretable later.

## Read Next

- [Running A Session](/operations/running-a-session)
- [Study And Session Lifecycle](/platform/lifecycle)
- [Error Codes](/reference/error-codes)
