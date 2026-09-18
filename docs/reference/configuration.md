# Configuration Keys

Every key in `config.yml`, validated by `ScarlineConfigSchema`. The schema is `strict` —
an unknown key is an error. Defaults shown are the values in the repository's
`config.yml`; the schema itself requires all of them.

Paths resolve against the repository root.

## `version`

| Key | Type | Value |
| --- | --- | --- |
| `version` | literal | `1` |

## `bootstrap`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `admin_username` | string | `admin` | `^[a-zA-Z0-9_.-]+$`, 1–100 chars. Used only on an empty `users` table |

## `api`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `allowed_origins` | url[] | `http://localhost:5173`, `http://localhost:4000` | At least one. CORS and auth-mutation origin check |
| `command_timeout_seconds` | int > 0 | `120` | Lifecycle command deadline |
| `access_token_ttl_minutes` | int > 0 | `15` | |
| `refresh_token_ttl_days` | int > 0 | `30` | |
| `overlay_token_ttl_minutes` | int > 0 | `5` | Bootstrap tokens and overlay tickets |
| `overlay_renderer_session_ttl_hours` | int > 0 | `12` | Render-session cookie |
| `pagination_default_limit` | int 1–500 | `50` | Must not exceed the max |
| `pagination_max_limit` | int 1–1000 | `200` | |
| `event_batch_size` | int 1–10000 | `100` | |
| `event_flush_milliseconds` | int 10–60000 | `250` | |
| `exports_directory` | path | `./.runtime/exports` | |
| `widgets_directory` | path | `./widgets` | |
| `sensors_directory` | path | `./services/io-client/drivers` | |

## `platform`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `environment` | enum | `development` | `development`, `test`, `production` |
| `port` | port | `8088` | CoreAPI listen and publish port |
| `runtime_directory` | path | `./.runtime` | |
| `open_browser` | bool | `true` | |
| `startup_timeout_seconds` | int > 0 | `600` | `docker compose up --wait-timeout` |
| `shutdown_timeout_seconds` | int > 0 | `30` | Compose `down` and host-process `SIGTERM` grace |

## `docker`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `compose_file` | path | `compose.yml` | |
| `project_name` | string | `scarline` | `^[a-z0-9][a-z0-9_-]*$` |
| `remove_orphans` | bool | `true` | |

## `database`

| Key | Type | Default |
| --- | --- | --- |
| `host` | string | `database` |
| `port` | port | `5432` |
| `name` | string | `scarline` |
| `user` | string | `scarline` |

## `rabbitmq`

| Key | Type | Default |
| --- | --- | --- |
| `host` | string | `rabbitmq` |
| `port` | port | `5672` |
| `management_port` | port | `15672` |
| `user` | string | `scarline` |

## `sim_bridge`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `host` | string | `sim-bridge` | For container clients |
| `public_host` | string | `127.0.0.1` | For host-native clients |
| `port` | port | `9000` | |
| `adapter_path` | string | `/adapter` | `^/[a-z0-9/_-]*$` |
| `adapter_command_timeout_seconds` | int > 0 | `120` | |
| `adapter_heartbeat_interval_seconds` | int > 0 | `5` | Must be less than the stale timeout |
| `adapter_stale_timeout_seconds` | int > 0 | `15` | |
| `adapter_reconnect_grace_seconds` | int > 0 | `10` | |
| `maximum_websocket_message_bytes` | int 1024–16777216 | `1048576` | |
| `telemetry_maximum_hz` | number 0–1000 | `100` | |
| `command_journal` | path | `./.runtime/sim-bridge/command-journal.json` | Must resolve inside `platform.runtime_directory` |

## `simulator`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `default` | enum | `mock` | `carla` or `mock` |
| `autostart` | bool | `false` | Whether a bare `scarline start` starts a simulator |

### `simulator.carla`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `version` | literal | `0.9.16` | |
| `executable` | path \| null | `your/path/to/CarlaUE4.sh` | `null` when CARLA is not installed |
| `public_host` | literal | `127.0.0.1` | |
| `host` | literal | `host.docker.internal` | |
| `port` | literal | `2000` | Also uses `2001` and `2002` |
| `quality` | enum | `Epic` | `Low` or `Epic` |
| `additional_arguments` | string[] | `[]` | |
| `synchronous_mode` | literal | `true` | Pinned |
| `fixed_delta_seconds` | literal | `0.05` | Pinned |
| `adapter_id` | string | `carla-primary` | `^[a-z][a-z0-9-]*$` |
| `priority` | int 0–10000 | `10` | Lower wins |
| `reconnect_interval_seconds` | int > 0 | `2` | |
| `health_port` | port | `8082` | |
| `command_journal` | path | `./.runtime/carla-client/command-journal.json` | |
| `media_directory` | path | `./.runtime/carla-client/media` | |
| `control_timeout_milliseconds` | int 100–10000 | `500` | Real-time control validity |

### `simulator.mock`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | bool | `true` | |
| `telemetry_hz` | number 0–20 | `20` | |
| `adapter_id` | string | `mock-primary` | |
| `priority` | int 0–10000 | `100` | |
| `reconnect_interval_seconds` | int > 0 | `2` | |
| `command_journal` | path | `./.runtime/mock-simulator/command-journal.json` | |

## `services`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `core_api.enabled` | bool | `true` | |
| `admin_panel.enabled` | bool | `true` | |
| `admin_panel.port` | port | `5173` | |
| `sim_bridge.enabled` | bool | `true` | |
| `overlay_web.enabled` | bool | `true` | |
| `overlay_web.port` | port | `4000` | |
| `overlay_web.public_origin` | url | `http://localhost:4000` | Embedded in renderer launch URLs |
| `desktop_overlay.enabled` | bool | `true` | |

### `services.io_client`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | bool | `true` | |
| `runtime` | enum | `docker` | `docker` or `host` |
| `python_executable` | path | `python` | Host runtime only; needs Python 3.12+ |
| `heartbeat_interval_seconds` | int > 0 | `5` | Must be less than the stale timeout |
| `stale_timeout_seconds` | int > 0 | `15` | |
| `health_port` | port | `8081` | |
| `command_journal` | path | `./.runtime/io-client/command-journal.json` | |
| `media_directory` | path | `./.runtime/io-client/media` | |
| `mock_enabled` | bool | `true` | Synthetic sensor suite; also `scarline start --mock-io` |
| `batch_max_samples` | int 1–10000 | `100` | |
| `batch_max_milliseconds` | int 10–10000 | `100` | |

## `logging`

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `level` | enum | `info` | `trace`, `debug`, `info`, `warn`, `error` |
| `directory` | path | `./.runtime/logs` | |

## Cross-Field Rules

| Rule | Message |
| --- | --- |
| `api.pagination_default_limit ≤ api.pagination_max_limit` | `pagination_default_limit must not exceed pagination_max_limit` |
| `sim_bridge.adapter_heartbeat_interval_seconds < adapter_stale_timeout_seconds` | `adapter_heartbeat_interval_seconds must be less than adapter_stale_timeout_seconds` |
| `services.io_client.heartbeat_interval_seconds < stale_timeout_seconds` | `heartbeat_interval_seconds must be less than stale_timeout_seconds` |
| `sim_bridge.command_journal` inside `platform.runtime_directory` | `sim_bridge.command_journal must resolve inside platform.runtime_directory` |

## Secrets

Secrets live in `.env`, never here. See [Secrets And .env](/cli/secrets).

| Key | Minimum |
| --- | --- |
| `POSTGRES_PASSWORD` | 1 char |
| `RABBITMQ_DEFAULT_PASS` | 1 char |
| `JWT_ACCESS_SECRET` | 32 chars |
| `REFRESH_TOKEN_PEPPER` | 32 chars |
| `BOOTSTRAP_ADMIN_PASSWORD` | 1–128 chars |
| `OVERLAY_CONTROL_SECRET` | 32 chars |
| `SIM_BRIDGE_ADAPTER_SECRET` | 32 chars |

## Read Next

- [config.yml](/cli/configuration)
- [Ports And Endpoints](/reference/ports)
- [Secrets And .env](/cli/secrets)
