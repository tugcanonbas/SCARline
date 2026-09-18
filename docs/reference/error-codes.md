# Error Codes

Every CoreAPI failure returns the same envelope:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "STUDY_NOT_FOUND",
    "message": "Study not found.",
    "details": { },
    "requestId": "req-42"
  }
}
```

`code` matches `^[A-Z][A-Z0-9_]*$` and is stable — treat it as API. `requestId` ties the
response to a CoreAPI log line.

## Generic

| Code | Status | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Schema validation failed; `details.issues` lists the problems |
| `NOT_FOUND` | 404 | No such route |
| `CONFLICT` | 409 | Unique constraint violated |
| `RESOURCE_IN_USE` | 409 | Foreign key violated |
| `REQUEST_ERROR` | 4xx | An unclassified client error |
| `INTERNAL_ERROR` | 500 | Unexpected failure; logged, details never leaked |

## Authentication

| Code | Status | Meaning |
| --- | --- | --- |
| `AUTHENTICATION_REQUIRED` | 401 | Missing or malformed bearer token |
| `INVALID_CREDENTIALS` | 401 | Wrong username or password, or a disabled account |
| `INVALID_ACCESS_TOKEN` | 401 | Token signature, audience, or expiry rejected |
| `REFRESH_TOKEN_REQUIRED` | 401 | No refresh cookie |
| `INVALID_REFRESH_TOKEN` | 401 | Unknown token — a replay revokes the session |
| `EXPIRED_REFRESH_TOKEN` | 401 | Past its lifetime |
| `AUTH_SESSION_REVOKED` | 401 | Session revoked by logout, deactivation, or replay detection |
| `INVALID_WEBSOCKET_TICKET` | 401 | Ticket unknown, expired, or already used |
| `USER_NOT_FOUND` | 401/404 | The principal no longer exists |
| `USER_DISABLED` | 401 | The account is deactivated |
| `INVALID_CURRENT_PASSWORD` | 400 | Wrong current password on change |
| `PASSWORD_CHANGE_REQUIRED` | 403 | Change the password before using this endpoint |
| `ORIGIN_DENIED` | 403 | Origin missing from `api.allowed_origins` |
| `FORBIDDEN` | 403 | The account lacks a required role |
| `STUDY_ACCESS_DENIED` | 403 | Not a study member and not an admin |
| `INVALID_ROLES` | 400 | One or more role names are unknown |
| `DISABLED_REASON_REQUIRED` | 400 | Deactivating a user needs a reason |

## Studies And Configuration

| Code | Status | Meaning |
| --- | --- | --- |
| `STUDY_NOT_FOUND` | 404 | |
| `STUDY_CONFIGURATION_LOCKED` | 409 | The study is not `draft` or `configured` |
| `ACTIVE_SESSION_EXISTS` | 409 | A session is prepared or running |
| `STUDY_PARTICIPANTS_LOCKED` | 409 | Participants are locked after completion |
| `STUDY_HAS_HISTORY` | 409 | A study with sessions must be archived, not deleted |
| `INVALID_STUDY_TRANSITION` | 409 | That status change is not allowed |
| `STUDY_NOT_READY` | 409 | Readiness failed — `details.readiness` has the checks |
| `STUDY_NOT_CONFIGURED` | 409 | Sessions need a `configured`, `ready`, or `running` study |
| `CONDITION_NOT_FOUND` | 404 | |
| `CONDITION_REQUIRED` | 409 | At least one condition is required |
| `TEMPLATE_CONDITION_NOT_FOUND` | 404 | The clone source is not in this study |
| `PARTICIPANT_NOT_FOUND` | 404 | |
| `PARTICIPANT_HAS_HISTORY` | 409 | A participant with sessions cannot be deleted |
| `DEVICE_NOT_FOUND` | 404 | |
| `CONDITION_DEVICE_NOT_FOUND` | 404 | |
| `SENSOR_IN_USE` | 409 | Disable the configuration instead of deleting the sensor |
| `TRIGGER_NOT_FOUND` | 404 | |
| `WIDGET_CATALOGUE_INVALID` | 409 | A `widget.json` failed validation; `details.issues` lists them |
| `SENSOR_CATALOGUE_INVALID` | 409 | A driver manifest failed validation |

Readiness blocking codes — `PARTICIPANT_REQUIRED`, `CONDITION_REQUIRED`,
`SIMULATOR_CONFIGURATION_REQUIRED`, `SIMULATOR_UNAVAILABLE`,
`REQUIRED_SENSOR_CONFIGURATION_MISSING`, `REQUIRED_SENSOR_UNAVAILABLE`,
`PARTICIPANT_LAYOUT_REQUIRED`, `PARTICIPANT_WIDGET_REQUIRED`,
`PARTICIPANT_WIDGET_UNAVAILABLE` — are documented in
[Study Readiness](/operations/study-readiness).

## Sessions

| Code | Status | Meaning |
| --- | --- | --- |
| `SESSION_NOT_FOUND` | 404 | |
| `COMMAND_NOT_FOUND` | 404 | No such lifecycle command |
| `SESSION_COMMAND_PENDING` | 409 | Another command is `queued` or `processing` |
| `INVALID_SESSION_TRANSITION` | 409 | Not a legal edge for the current status |
| `ABORT_REASON_REQUIRED` | 400 | `abort` needs a reason |
| `NO_SESSION_CONDITIONS` | 409 | A session needs at least one condition |
| `INVALID_SESSION_CONDITION` | 409 | A condition is archived or from another study |
| `SESSION_NOT_READY` | 409 | The session is not in `ready` |
| `SESSION_NOT_RUNNING` | 409 | Start the session first |
| `SESSION_NOT_LIVE` | 409 | The session is not `running` or `paused` |
| `SESSION_CONDITION_NOT_LIVE` | 409 | The session condition is not active |
| `NO_ACTIVE_CONDITION` / `ACTIVE_CONDITION_NOT_FOUND` | 409 | No condition is active |
| `NO_NEXT_CONDITION` | 409 | Nothing left to advance to |
| `SIMULATOR_NOT_READY` | 409 | No simulator adapter is available |
| `IO_CLIENT_NOT_READY` | 409 | The IO Client is not reporting |

## Layouts, Widgets, And Overlay

| Code | Status | Meaning |
| --- | --- | --- |
| `LAYOUT_NOT_FOUND` | 404 | |
| `LAYOUT_VERSION_CONFLICT` | 409 | A layout changed since you loaded it — reload and reapply |
| `LAYOUT_DISPLAY_UNAVAILABLE` | 409 | A widget targets a display the host does not have |
| `WIDGET_INSTANCE_NOT_FOUND` | 404 | |
| `WIDGET_UNAVAILABLE` | 409 | The widget is no longer in the catalogue |
| `WIDGET_HIDDEN` | 409 | A hidden widget cannot submit actions |
| `WIDGET_OUT_OF_SCOPE` | 403 | The widget is outside this renderer's scope |
| `WIDGET_NOT_IN_ACTIVE_CONDITION` | 409 | The widget belongs to another condition |
| `UNDECLARED_WIDGET_ACTION` | 400 | The manifest does not declare that action |
| `UNDECLARED_WIDGET_BINDING` | 400 | The manifest does not declare that binding |
| `INVALID_WIDGET_BINDING_VALUE` | 400 | The value does not match the declared type |
| `EMPTY_WIDGET_UPDATE` | 400 | An update with nothing to change |
| `INTERACTION_REQUEST_CONFLICT` | 409 | The same request id was reused with a different payload |
| `INTERACTION_CONDITION_CHANGED` | 409 | The condition advanced mid-interaction |
| `ACTIVE_WINDOW_NOT_FOUND` | 404 | No such open participant window |
| `WINDOW_CONFIGURATION_CHANGED` | 409 | The window's revision moved on |
| `BROWSER_FALLBACK_NOT_LIVE` | 409 | Browser rendering needs a live session |
| `PREVIEW_RELAUNCH_REQUIRED` | 409 | Relaunch the preview from Participant View |
| `PREVIEW_CAPACITY_REACHED` | 503 | The preview's request budget is exhausted |
| `OVERLAY_SCOPE_MISMATCH` | 403 | The request is outside the credential's scope |
| `OVERLAY_SESSION_REQUIRED` | 401 | No renderer session cookie |
| `INVALID_OVERLAY_SESSION` | 401 | The renderer cookie is invalid or expired |
| `INVALID_OVERLAY_SECRET` | 401 | Wrong `x-overlay-control-secret` |
| `INVALID_OVERLAY_TOKEN` | 401 | The control token is invalid |
| `INVALID_OVERLAY_TICKET` | 401 | The overlay WebSocket ticket is invalid or used |
| `INVALID_OVERLAY_BOOTSTRAP` | 401 | The bootstrap token is invalid or expired |
| `OVERLAY_BOOTSTRAP_REUSED` | 401 | A single-use bootstrap token was presented twice |
| `INVALID_DESKTOP_WINDOW_MODE` | 400 | Desktop commands require `transparent_electron` |

### Overlay Command Failures

Raised by the realtime hub and mapped to HTTP status:

| Code | Status | Meaning |
| --- | --- | --- |
| `OVERLAY_UNAVAILABLE` | 503 | No desktop overlay host is connected |
| `OVERLAY_HOST_NOT_CONNECTED` | 503 | The named host is not connected |
| `OVERLAY_DISCONNECTED` | 503 | The host disconnected before acknowledging |
| `OVERLAY_HOST_SELECTION_REQUIRED` | 409 | Several hosts are connected — select one |
| `OVERLAY_COMMAND_REJECTED` | 409 | The host refused the command |
| `OVERLAY_COMMAND_TIMEOUT` | 504 | No acknowledgement in time |
| `INVALID_OVERLAY_COMMAND` | 400 | Malformed command |
| `OVERLAY_COMMAND_FAILED` | 500 | Unclassified overlay failure |

## Exports

| Code | Status | Meaning |
| --- | --- | --- |
| `EXPORT_NOT_FOUND` | 404 | |
| `EXPORT_TARGET_NOT_FOUND` | 404 | The scoped object does not exist |
| `EXPORT_NOT_READY` | 409 | The job has not completed |
| `EXPORT_RUNNING` | 409 | A running job cannot be deleted |
| `EXPORT_ARTIFACT_MISSING` | 404 | The archive is gone from disk |
| `INVALID_EXPORT_PATH` | 500 | The artifact path escapes `api.exports_directory` |

## System

| Code | Status | Meaning |
| --- | --- | --- |
| `PROCESS_MANAGER_UNAVAILABLE` | 503 | The process-manager socket is unreachable — expected, since the CLI owns process lifecycle |
| `INVALID_CURSOR` | 400 | A malformed pagination cursor |

## WebSocket

The socket reports every subscription failure as `INVALID_SUBSCRIPTION`, with the reason
in `message`. See [Realtime Channels](/reference/realtime).

## Read Next

- [CoreAPI Routes](/reference/core-api)
- [Troubleshooting](/getting-started/troubleshooting)
- [Incidents And Recovery](/operations/incidents-and-recovery)
