# config.yml

`config.yml` at the repository root is the single source of non-secret configuration.
It is validated by `ScarlineConfigSchema` in `packages/contracts`, which is `strict`:
an unknown key is an error, not a warning.

The same file is read by the CLI, CoreAPI, and Sim-Bridge, and mounted read-only into
the CoreAPI, Admin Panel, Sim-Bridge, IO Client, and CARLA client containers. Changing
it requires a restart — nothing reloads it at run time, and no UI screen edits it.

Every relative path resolves against the repository root.

## `version`

Must be `1`. It gates future schema migrations.

## `bootstrap`

```yaml
bootstrap:
  admin_username: admin
```

`admin_username` is used only when the `users` table is empty. CoreAPI then creates that
account with `BOOTSTRAP_ADMIN_PASSWORD`, assigns the `admin` role, and marks the
password as needing a change. Letters, digits, `_`, `.`, and `-` only.

## `api`

CoreAPI behaviour.

| Key | Meaning |
| --- | --- |
| `allowed_origins` | Browser origins allowed for CORS and accepted on authentication mutations. A login from an origin outside this list is rejected with `ORIGIN_DENIED`. |
| `command_timeout_seconds` | Deadline for a session lifecycle command before it is marked `timed_out` |
| `access_token_ttl_minutes` | Access token lifetime |
| `refresh_token_ttl_days` | Refresh cookie lifetime |
| `overlay_token_ttl_minutes` | Lifetime of single-use overlay bootstrap and WebSocket tickets |
| `overlay_renderer_session_ttl_hours` | Lifetime of the overlay renderer cookie |
| `pagination_default_limit` | Default page size; must not exceed `pagination_max_limit` |
| `pagination_max_limit` | Hard cap on page size |
| `event_batch_size` | Event batching size |
| `event_flush_milliseconds` | Event batching interval |
| `exports_directory` | Where export archives are written |
| `widgets_directory` | Root of the widget catalogue |
| `sensors_directory` | Root of the sensor driver manifests |

## `platform`

| Key | Meaning |
| --- | --- |
| `environment` | `development`, `test`, or `production` |
| `port` | The port CoreAPI listens on and publishes (default `8088`) |
| `runtime_directory` | Root of generated runtime state |
| `open_browser` | Whether the platform should open a browser on start |
| `startup_timeout_seconds` | Passed to `docker compose up --wait-timeout` |
| `shutdown_timeout_seconds` | Compose `down` timeout and the host-process `SIGTERM` grace period |

## `docker`

| Key | Meaning |
| --- | --- |
| `compose_file` | Compose file the CLI drives — `compose.yml` |
| `project_name` | Compose project name, used for `docker compose -p <name>` |
| `remove_orphans` | Adds `--remove-orphans` to `up` and `down` |

## `database` and `rabbitmq`

```yaml
database:
  host: database
  port: 5432
  name: scarline
  user: scarline

rabbitmq:
  host: rabbitmq
  port: 5672
  management_port: 15672
  user: scarline
```

Hosts are Compose service names because the services that read them run inside the
Compose network. Passwords come from `.env`, never from here.

## `sim_bridge`

| Key | Meaning |
| --- | --- |
| `host` | Service name adapters inside Compose connect to |
| `public_host` | Address host-native diagnostic clients use (`127.0.0.1`) |
| `port` | Sim-Bridge HTTP and WebSocket port (`9000`) |
| `adapter_path` | WebSocket path adapters register on (`/adapter`) |
| `adapter_command_timeout_seconds` | Deadline for a command sent to an adapter |
| `adapter_heartbeat_interval_seconds` | Heartbeat interval requested from adapters |
| `adapter_stale_timeout_seconds` | Missed-heartbeat window before an adapter counts as stale; must be greater than the heartbeat interval |
| `adapter_reconnect_grace_seconds` | How long a session binding survives a disconnect |
| `maximum_websocket_message_bytes` | Adapter frame size limit |
| `telemetry_maximum_hz` | Upper bound on telemetry published per adapter |
| `command_journal` | Journal path; must resolve inside `platform.runtime_directory` |

The bridge itself always listens on all container interfaces.

## `simulator`

```yaml
simulator:
  default: mock
  autostart: false
```

`default` is the simulator used by a bare `scarline start`, and it only starts
automatically when `autostart` is `true`. `scarline start --simulator carla|mock`
overrides it.

### `simulator.carla`

CARLA runs on the host operating system and is owned by the CLI. The Python adapter runs
in the `carla` Compose profile and connects back to it.

| Key | Meaning |
| --- | --- |
| `version` | Pinned to `0.9.16` |
| `executable` | Path to `CarlaUE4.sh`, or `null` when CARLA is not installed |
| `public_host` | `127.0.0.1` — where the CLI probes the RPC endpoint |
| `host` | `host.docker.internal` — how the containerised adapter reaches CARLA |
| `port` | `2000`; CARLA also uses `2001` and `2002` |
| `quality` | `Low` or `Epic` |
| `additional_arguments` | Extra CLI arguments for the CARLA launcher |
| `synchronous_mode` / `fixed_delta_seconds` | Pinned to `true` / `0.05` for reproducibility |
| `adapter_id` / `priority` | Adapter identity and selection priority (lower wins) |
| `reconnect_interval_seconds` | Adapter reconnect backoff |
| `health_port` | Adapter health endpoint (`8082`) |
| `command_journal` / `media_directory` | Adapter runtime paths |
| `control_timeout_milliseconds` | How long a real-time vehicle control stays authoritative |

### `simulator.mock`

| Key | Meaning |
| --- | --- |
| `enabled` | Whether the Mock Simulator may be started |
| `telemetry_hz` | Deterministic telemetry rate, at most 20 |
| `adapter_id` / `priority` | Adapter identity and priority (`100`, so CARLA wins when both are registered) |
| `reconnect_interval_seconds` | Reconnect backoff |
| `command_journal` | Journal path |

## `services`

Which services the CLI expects and how they are reached.

```yaml
services:
  core_api:       { enabled: true }
  admin_panel:    { enabled: true, port: 5173 }
  sim_bridge:     { enabled: true }
  overlay_web:    { enabled: true, port: 4000, public_origin: http://localhost:4000 }
  desktop_overlay:{ enabled: true }
  io_client:      { enabled: true, runtime: docker, ... }
```

`overlay_web.public_origin` is the origin CoreAPI embeds in renderer launch URLs, so it
must be reachable from the machine that renders participant windows.

`io_client.runtime` chooses where the IO Client runs:

| Value | Behaviour |
| --- | --- |
| `docker` | Started through the `io-docker` Compose profile |
| `host` | Started by the CLI from `.runtime/io-client/venv`, which `scarline setup` creates |

Other IO Client keys: `python_executable`, `heartbeat_interval_seconds` (must be less
than `stale_timeout_seconds`), `stale_timeout_seconds`, `health_port`, `command_journal`,
`media_directory`, `mock_enabled`, `batch_max_samples`, and `batch_max_milliseconds`.

## `logging`

```yaml
logging:
  level: info          # trace | debug | info | warn | error
  directory: ./.runtime/logs
```

## Changing Configuration Safely

1. Edit `config.yml`.
2. `scarline doctor` — it reports schema errors, port conflicts, and missing paths.
3. `scarline stop && scarline start`.

The read-only values are visible in the Admin Panel under **Settings → System
Settings**, which also states that `config.yml` owns configuration and the CLI owns
process lifecycle.

## Read Next

- [Secrets And .env](/cli/secrets)
- [Configuration Keys](/reference/configuration)
- [Docker Compose Stack](/cli/compose)
