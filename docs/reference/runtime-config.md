# Runtime Config

This page summarizes the runtime entry points, modes, and important environment/config values.

## Launcher Commands

- `./scarline start`
- `./scarline stop`
- `./scarline restart`
- `./scarline status`
- `./scarline logs [component]`
- `./scarline reset-db`

## Supported Start Flags

- `--dev`
- `--no-carla`
- `--no-overlay`
- `--no-browser`
- `--widget-test`

## Important Environment And Config Values

| Key | Purpose |
| --- | --- |
| `SCARLINE_PORT` | Public gateway port |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Database connectivity |
| `RABBITMQ_USER`, `RABBITMQ_PASSWORD` | Broker credentials |
| `SCARLINE_INTERNAL_API_TOKEN` | Internal service authorization |
| `PM_SOCKET_PATH` | Process-manager control path |
| `PUBLIC_DOCS_URL` | Admin docs link target |
| `WIDGETS_DIR` | CoreAPI widget catalogue root |
| `EXPORTS_DIR` | Export artifact directory |

## Service Defaults From Code

- CoreAPI: port `8080`
- Sim-Bridge: port `9000`
- public gateway: port `8088`
- overlay desktop control: port `4097`
- process-manager control: `127.0.0.1:4098` on macOS fallback
- I/O client health: `8081`
- mock simulator health: `8082`
- docs site: `4040`

## Public Path Routing

- `/admin`
- `/api`
- `/ws`
- `/overlay`
- `/docs`

## Process-Manager Command Paths

- `/carla/start`
- `/carla/stop`
- `/carla/restart`
- `/carla/status`
- `/overlay/reload`
- `/overlay/configure`
- `/overlay/windows/update`
- `/overlay/windows/open`
- `/restart`
- `/status`
