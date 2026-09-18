# Start And Stop

## Before A Session Day

```bash
scarline doctor
```

Run it before the first start of the day. It is read-only and catches the problems that
otherwise surface halfway through a participant run: a stale Docker daemon, a port taken
by something else, a missing CARLA binary, an IO Client environment that was never
built.

## Starting

```bash
scarline start                     # configured default
scarline start --simulator mock    # deterministic simulator
scarline start --simulator carla   # CARLA on the host (Linux or Windows)
scarline start --no-sim            # force mock — the option for macOS
scarline start --mock-io           # add the synthetic sensor suite
```

Startup blocks until every service passes its healthcheck or
`platform.startup_timeout_seconds` elapses. Building images on the first run takes
several minutes; later starts are fast.

You cannot switch simulator type while the stack is up. `scarline stop` first.

## Verifying

```bash
scarline status
```

Read it top to bottom:

1. **Host processes** — desktop overlay, IO Client, CARLA server. Each is `running` with
   a PID, `healthy`/`unhealthy`, or `stopped`.
2. **Missing services** — named explicitly when an expected Compose service is absent.
3. **Phase** — `running`, `starting`, `stopped`, or `degraded`.
4. **Service table** — per-service state and health.

Exit code `0` means everything expected is healthy; `1` means something is not.

Then check the UI: **Dashboard** for component health and recent activity, and
**Settings → System Status** for CoreAPI readiness, runtime components, and connected
desktop hosts. Both are read-only views of the same state.

## The Minimum Healthy Path

Verify in this order — each depends on the ones above it:

1. `database` — `pg_isready`
2. `rabbitmq` — diagnostics ping
3. `core-api` — `GET /ready` returns `200`
4. `admin-panel` and `overlay-web` — `/healthz`
5. `sim-bridge` plus a registered adapter of the type you plan to use
6. `io-client` and the drivers your protocol requires
7. Desktop overlay, if the protocol uses transparent windows

A study cannot be marked ready without steps 1–5, and cannot pass the sensor check
without step 6 when it has required devices.

## Stopping

```bash
scarline stop
```

Stop terminates host processes first, then takes the Compose stack down across all
profiles, then stops the CARLA server. `.runtime/` is preserved, so the database,
message state, journals, and exports all survive.

Before stopping, make sure no session is still `running` or `paused`. A session left
non-terminal keeps its study out of `completed` and leaves an incomplete record. Use
**Complete** or **Abort** in Active Study first.

## Restarting

`scarline restart` is not implemented yet:

```bash
scarline stop && scarline start
```

To restart a single container without disturbing the rest:

```bash
docker compose -p scarline restart core-api
```

## Reading Logs

```bash
docker compose -p scarline logs -f core-api
```

Host processes log to `.runtime/logs/`: `desktop-overlay.log`, `io-client.log`,
`carla-server.log`, `carla-driver.log`.

`scarline logs` is not implemented yet.

## After Changing Configuration

`config.yml` is read at process start and mounted read-only into containers. Nothing
reloads it.

```bash
scarline doctor && scarline stop && scarline start
```

## Read Next

- [CLI Commands](/cli/commands)
- [Study Readiness](/operations/study-readiness)
- [Incidents And Recovery](/operations/incidents-and-recovery)
