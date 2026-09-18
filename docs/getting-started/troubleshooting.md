# Troubleshooting

Start with the two commands that answer most questions:

```bash
scarline doctor
```

```bash
scarline status
```

`doctor` checks the host and the configuration without touching the running stack.
`status` reports Compose service state plus the host processes (desktop overlay, IO
Client, CARLA server) and exits non-zero when anything expected is missing.

## Startup Fails

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Setup failed: Invalid config.yml: ...` | A key is missing, misspelled, or out of range | The message names the key path; compare against [config.yml](/cli/configuration) |
| `.env does not exist. Run scarline setup.` | Secrets were never generated | `scarline setup` |
| `Invalid .env: JWT_ACCESS_SECRET: String must contain at least 32 character(s)` | A secret was hand-edited too short | Delete that line and re-run `scarline setup` to regenerate it |
| `Docker Compose could not start the infrastructure` | A service failed its healthcheck | `docker compose -p scarline logs <service>` |
| `Infrastructure did not start every required service` | A Compose profile was not enabled | Check `services.*.enabled` in `config.yml` and the simulator flag you passed |
| `Mock Simulator is already running. Stop SCARline before switching simulator types.` | Simulator switch while running | `scarline stop`, then start with the other simulator |
| `CARLA 0.9.16 requires a supported Linux or Windows host` | Started with `--simulator carla` on macOS | Use `scarline start --no-sim` |

Secrets are redacted from Compose failure output, so error text is safe to paste into a
ticket.

## Sign-In Or Access Fails

| Symptom | Cause |
| --- | --- |
| Every page redirects to `/startup` | CoreAPI `/ready` is not returning `200`; PostgreSQL, RabbitMQ, or the admin bootstrap is not up |
| Redirect to `/change-password` and nothing else works | The account still has `password_reset_required`; set a password of at least 12 characters |
| `503 CoreAPI is unavailable` | The Admin Panel has a session but cannot reach CoreAPI at `CORE_API_ORIGIN` |
| `403 You do not have access to this screen` | The account lacks the role the route requires — see [Admin Panel And RBAC](/reference/admin-panel) |
| `403 STUDY_ACCESS_DENIED` | The account is not a member of that study and is not an admin |
| `403 ORIGIN_DENIED` on login | The browser origin is missing from `api.allowed_origins` in `config.yml` |

## Realtime Looks Stale

The Admin Panel opens `/ws` with a single-use ticket from
`POST /api/v1/auth/websocket-ticket`. If live panels stop updating:

1. Confirm CoreAPI is reachable at `PUBLIC_CORE_API_WEBSOCKET_ORIGIN`.
2. Confirm RabbitMQ is healthy — events reach browsers only after CoreAPI consumes them.
3. Check the outbox: unpublished rows accumulate in `event_outbox` when the broker is
   down and drain automatically once it returns.
4. Remember that a study's data policy can cap realtime delivery
   (`dataPolicy.realtime.maximumHz`) and sample persistence
   (`dataPolicy.persistence.mode`). Lifecycle, trigger, annotation, and error events are
   always delivered and always stored.

## Overlay Or Widgets Misbehave

| Symptom | Where to look |
| --- | --- |
| No participant windows open | Is the desktop overlay running? `scarline status`. Otherwise start the session in browser renderer mode |
| `OVERLAY_HOST_SELECTION_REQUIRED` | More than one desktop host is connected; select one before starting |
| Widget shows `—` for every value | The binding source is not streaming; check **Active Study → Widget data sources** |
| Widget opens but stays blank | Check Overlay Web at `/healthz` and the widget's `entry` file |
| `WIDGET_CATALOGUE_INVALID` on refresh | A `widget.json` failed schema validation; the response lists the issues |
| Window lands on the wrong screen | The saved `targetDisplay` no longer exists; reassign it in Participant View |

## The Simulator Or Sensors Are The Problem

- `SIMULATOR_UNAVAILABLE` in readiness means Sim-Bridge is not reporting a heartbeat.
  Component status goes stale after 15 seconds without one.
- `missingSimulatorCapabilities` means Sim-Bridge is up but no adapter of the configured
  type has registered. Check that the right Compose profile started.
- An adapter that misses `sim_bridge.adapter_stale_timeout_seconds` is treated as
  disconnected and its session binding is released after the reconnect grace period.
- `REQUIRED_SENSOR_UNAVAILABLE` means a device marked required is not `connected`, or
  the IO Client itself is not reporting.

## Nothing Above Matches

1. Note the session id, study id, and a timestamp.
2. Collect logs: `docker compose -p scarline logs <service>` for containers, and
   `.runtime/logs/` for host processes.
3. Follow the dependency order in [Incidents And Recovery](/operations/incidents-and-recovery).

## Read Next

- [CLI Commands](/cli/commands)
- [Error Codes](/reference/error-codes)
- [Incidents And Recovery](/operations/incidents-and-recovery)
