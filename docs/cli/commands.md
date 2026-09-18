# CLI Commands

```text
scarline
├── setup      Configure the local SCARline environment
├── start      Start SCARline services
├── stop       Stop SCARline services
├── restart    Restart SCARline services      (not implemented yet)
├── status     Show the status of SCARline services
├── doctor     Check the local SCARline environment
└── logs       Show SCARline service logs     (not implemented yet)
```

`scarline --help` lists the commands; `scarline <command> --help` prints that command's
usage. Every command locates the repository root by walking up from the working
directory for a `package.json` named `scarline` next to a `config.yml`, so you can run
it from any subdirectory.

## `scarline setup`

Takes no options. Idempotent.

1. Finds the repository root and validates `config.yml` against `ScarlineConfigSchema`.
   Invalid configuration fails with the offending key path and reason.
2. Ensures `.env`. Missing secrets are appended, existing values are preserved and never
   printed, and the file is set to mode `600` on Linux and macOS.
3. Creates the `.runtime/` tree with mode `700`.
4. Creates the IO Client Python virtual environment at
   `.runtime/io-client/venv` and installs `services/io-client` into it in editable mode —
   only when the IO Client is enabled and `services.io_client.runtime` is `host`.
   It requires Python 3.12 or newer.

Output reports the repository path, configuration validity, what happened to `.env`,
the runtime path, and the IO Client Python interpreter.

**Exit codes:** `0` on success, `1` on any failure.

## `scarline doctor`

Takes no options. Read-only — it never starts, stops, or writes anything.

| Check | Fails when |
| --- | --- |
| Repository | The repository root cannot be located |
| Node.js | Older than v22 |
| npm | Older than v10 |
| Docker | `docker --version` fails |
| Docker Compose | `docker compose version` fails |
| Docker daemon | `docker info` cannot reach a server |
| Configuration | `config.yml` is invalid |
| Secrets | `.env` is missing or a secret is absent or malformed |
| `.env` permissions | The file is group- or world-accessible (skipped on Windows) |
| Runtime / Runtime layout | `.runtime/` is missing, unwritable, or incomplete |
| IO Client Python | Host runtime and Python is older than 3.12 |
| IO Client environment | The virtual environment is missing |
| Sensor drivers | `api.sensors_directory` is missing or unreadable |
| Compose file | Missing, unreadable, or `docker compose config` rejects it |
| Port *N* | Never fails — reports `WARN` when a port is already in use |
| Desktop overlay | Electron or the built host entry point is missing |
| Simulator | The configured CARLA executable is missing, when autostart is on |

The summary line counts passes, warnings, and failures. The command exits `1` if any
check failed; warnings alone still exit `0`.

## `scarline start`

```text
scarline start [--no-sim | --simulator carla|mock] [--mock-io]
```

| Flag | Effect |
| --- | --- |
| *(none)* | Starts `simulator.default` when `simulator.autostart` is `true`; otherwise starts no simulator adapter |
| `--simulator mock` | Enables the `mock` Compose profile |
| `--simulator carla` | Starts the CARLA host server and enables the `carla` Compose profile |
| `--no-sim` | Forces the Mock Simulator — the option for hosts that cannot run CARLA |
| `--mock-io` | Starts the IO Client with the synthetic sensor suite enabled |

Sequence:

1. Load and validate configuration and secrets.
2. Resolve the simulator selection. `--simulator carla` on a non-Linux, non-Windows host
   is rejected. `--simulator mock` when `simulator.mock.enabled` is `false` is rejected.
3. Refuse to start if the *other* simulator type is already running — stop first.
4. Start the CARLA host server when CARLA is selected. If a CARLA RPC endpoint is
   already reachable, the CLI attaches to it instead of spawning a second one.
5. Run `docker compose up --detach --build --wait --wait-timeout <platform.startup_timeout_seconds>`
   with the selected profiles, plus `--remove-orphans` when `docker.remove_orphans` is
   `true`.
6. Verify that every expected service is present and the stack is healthy. On failure,
   any CARLA server the command started is stopped again and the platform state is
   recorded as `degraded`.
7. Start the Electron desktop overlay when `services.desktop_overlay.enabled`.
8. Start the IO Client on the host when it is enabled and `runtime` is `host`; when
   `runtime` is `docker` it comes up through the `io-docker` Compose profile instead.
9. Start the CARLA keyboard driver when CARLA is selected.
10. Write `.runtime/state/platform.json` and print the service table.

Re-running `start` while the stack is already healthy is safe: it re-attaches the host
processes and reports the existing state.

## `scarline stop`

Takes no options.

1. Stop the desktop overlay, the IO Client, and the CARLA keyboard driver. Each gets
   `SIGTERM`, then `SIGKILL` after `platform.shutdown_timeout_seconds`.
2. Run `docker compose down --timeout <platform.shutdown_timeout_seconds>` across the
   `mock`, `io-docker`, and `carla` profiles.
3. Stop the CARLA host server.
4. Record the stopped state.

Runtime data under `.runtime/` is preserved, including the PostgreSQL and RabbitMQ
volumes.

## `scarline status`

Takes no options. Reports, in order:

- `desktop-overlay: running, PID <n>` or `stopped`
- `io-client: healthy|unhealthy, PID <n>` — or `managed by Docker Compose`
- `carla-server: healthy|unhealthy, PID <n>` or `stopped`
- any missing expected Compose services
- the overall phase: `running`, `starting`, `stopped`, or `degraded`
- the per-service Compose table

CARLA is reported as broken when the host server is running but unhealthy, or when the
host server and the containerised adapter disagree about being up; that forces the
phase to `degraded`.

**Exit codes:** `0` when everything expected is healthy, `1` when the phase is
`degraded`, a service is missing, or an enabled host process is not running.

## `scarline restart` and `scarline logs`

Registered, but not implemented. Each prints
`The scarline <name> command is not implemented yet.` and exits `0`.

Until they land:

```bash
scarline stop && scarline start
```

```bash
docker compose -p scarline logs -f core-api
```

Host-process logs are written to `.runtime/logs/` — `desktop-overlay.log`,
`io-client.log`, `carla-server.log`, and `carla-driver.log`.

## Running Without The Global Link

```bash
npm run dev:cli -- status
```

## Read Next

- [config.yml](/cli/configuration)
- [Docker Compose Stack](/cli/compose)
- [Start And Stop](/operations/start-and-stop)
