# Runtime Directory

`.runtime/` holds everything the platform generates at run time. `scarline setup`
creates it with mode `700`, and it is excluded from Git.

```text
.runtime/
├── postgres/            PostgreSQL data volume (bind-mounted into the database container)
├── rabbitmq/            RabbitMQ data volume
├── state/               platform.json — the CLI's record of the last known phase
├── processes/           PID records for host processes
├── logs/                Host-process logs
├── exports/             Generated export archives
├── sim-bridge/          Sim-Bridge command journal
├── mock-simulator/      Mock Simulator command journal
├── carla-client/        CARLA adapter journal
│   └── media/           CARLA sensor artifacts
└── io-client/           IO Client journal and, in host mode, its Python virtual environment
    └── media/           IO Client recordings
```

`scarline doctor` fails when any of these directories is missing and tells you to run
`scarline setup`.

## Process Records

`.runtime/processes/` holds one small JSON file per host process — `desktop-overlay.json`,
`io-client.json`, `carla-server.json`, `carla-driver.json` — each recording the PID and
start time. `scarline status` reads them and probes whether the PID is still alive; a
record whose process has died is removed automatically. That is why `status` can report
a host process independently of Docker.

## Platform State

`.runtime/state/platform.json` records the last phase the CLI observed
(`running`, `starting`, `stopped`, `degraded`), the Compose project name, and the
per-service Compose status. It is written atomically with mode `600` by `start`, `stop`,
and `status`. It is a report, not an input — the CLI never trusts it over a live
`docker compose ps`.

## Logs

| File | Written by |
| --- | --- |
| `desktop-overlay.log` | Electron overlay host |
| `io-client.log` | Host-mode IO Client |
| `carla-server.log` | CARLA host server |
| `carla-driver.log` | CARLA keyboard driver |

Containerised services log to Docker, not here:

```bash
docker compose -p scarline logs -f core-api
```

## Command Journals

Sim-Bridge, the Mock Simulator, the CARLA adapter, and the IO Client each persist a
command journal. A journal records the result of every command the component has
already executed, keyed by command id, so a component that restarts mid-command replays
the recorded result instead of executing it twice. `sim_bridge.command_journal` is
validated to resolve inside `platform.runtime_directory`.

## What Is Safe To Delete

| Path | Effect of deleting |
| --- | --- |
| `logs/` | Loses history only |
| `processes/` | Safe while the platform is stopped; deleting it while running orphans host processes |
| `state/` | Regenerated on the next CLI command |
| `exports/` | Loses generated archives; the `export_jobs` rows remain and their downloads then fail |
| `*/command-journal.json` | A restarting component may re-execute a command it had already completed |
| `rabbitmq/` | Discards queued messages; the outbox republishes what is still pending |
| `postgres/` | **Destroys every study, session, and event.** The next start bootstraps an empty database and re-creates the bootstrap administrator |

Stop the platform before deleting anything.

## Resetting To A Clean Database

```bash
scarline stop
rm -rf .runtime/postgres
scarline start
```

The database image applies the schema and seeds only when its data directory is empty,
so this is the supported way to start over in development. It is irreversible.

## Read Next

- [Docker Compose Stack](/cli/compose)
- [Database Schema](/reference/database)
- [Incidents And Recovery](/operations/incidents-and-recovery)
