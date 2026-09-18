# Ports And Endpoints

Every published port binds to `127.0.0.1`. Nothing in the default stack is reachable from
another machine.

## Published Ports

| Port | Service | Configured by |
| --- | --- | --- |
| `5173` | Admin Panel | `services.admin_panel.port` |
| `8088` | CoreAPI (REST + WebSocket) | `platform.port` |
| `4000` | Overlay Web | `services.overlay_web.port` |
| `9000` | Sim-Bridge | `sim_bridge.port` |
| `5432` | PostgreSQL | `database.port` |
| `5672` | RabbitMQ AMQP | `rabbitmq.port` |
| `15672` | RabbitMQ management UI | `rabbitmq.management_port` |

## Host-Only Ports

Not published through Compose; bound by host processes or inside containers.

| Port | Service | Configured by |
| --- | --- | --- |
| `8081` | IO Client health | `services.io_client.health_port` |
| `8082` | CARLA adapter health | `simulator.carla.health_port` |
| `2000` | CARLA RPC | `simulator.carla.port` |
| `2001`, `2002` | CARLA streaming and secondary | derived from `port` |
| `4040` | Documentation dev server | `npm run dev:docs` only |

`scarline doctor` probes all of these and warns when one is already in use.

## In-Network Names

Services inside the Compose network address each other by service name.

| Name | Port | Used by |
| --- | --- | --- |
| `database` | `5432` | CoreAPI |
| `rabbitmq` | `5672` | CoreAPI, Sim-Bridge, IO Client |
| `core-api` | `8088` | Admin Panel (`CORE_API_ORIGIN`) |
| `sim-bridge` | `9000` | Mock Simulator, CARLA client |
| `host.docker.internal` | `2000` | CARLA client → the CARLA server on the host |

## HTTP Endpoints

### CoreAPI — `http://localhost:8088`

| Path | Notes |
| --- | --- |
| `/health` | Liveness, unauthenticated |
| `/ready` | Readiness, `503` until dependencies are up |
| `/api/v1/*` | REST surface |
| `/ws` | Browser WebSocket |
| `/overlay-control` | Desktop overlay host WebSocket |
| `/overlay-runtime` | Widget renderer WebSocket |

### Admin Panel — `http://localhost:5173`

| Path | Notes |
| --- | --- |
| `/` | Redirects by bootstrap and auth state |
| `/healthz` | Container healthcheck |
| `/docs/` | Documentation site |
| `/overlay/*` | Widget assets for the layout editor |
| `/api/*` | Internal proxies so the browser never holds an access token |

### Overlay Web — `http://localhost:4000`

| Path | Notes |
| --- | --- |
| `/healthz` | Container healthcheck |
| `/runtime-config.json` | CoreAPI origins for the renderer |
| `/launcher/:layoutId` | Layout renderer shell |
| `/widget/:instanceId` | Single-widget renderer shell |
| `/assets/*`, `/images/*`, `/icons/*` | Widget assets |
| `/dist.css`, `/widget-runtime.js` | Shared widget assets |
| `/client.js`, `/bridge.js`, `/browser-position.js` | Renderer plumbing |
| `/overlay-shell.css`, `/favicon.ico` | Shell assets |

### Sim-Bridge — `http://localhost:9000`

| Path | Notes |
| --- | --- |
| `/health` | Liveness |
| `/ready` | Readiness |
| `/adapter` | Adapter WebSocket (`sim_bridge.adapter_path`) |

### IO Client and CARLA adapter

| Path | Notes |
| --- | --- |
| `http://127.0.0.1:8081/health` | IO Client |
| `http://127.0.0.1:8082/health` | CARLA adapter |

## Origins In Configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `api.allowed_origins` | `http://localhost:5173`, `http://localhost:4000` | CORS and auth-mutation origin check |
| `services.overlay_web.public_origin` | `http://localhost:4000` | Embedded in renderer launch URLs |
| `CORE_API_ORIGIN` | `http://core-api:8088/api/v1` | Admin Panel, server-side |
| `PUBLIC_CORE_API_ORIGIN` | `http://localhost:8088/api/v1` | Admin Panel, browser-facing |
| `PUBLIC_CORE_API_WEBSOCKET_ORIGIN` | `ws://localhost:8088` | Admin Panel WebSocket |
| `PUBLIC_DOCS_URL` | `/docs/` | Documentation link target |
| `ORIGIN` | `http://localhost:5173` | SvelteKit form-action origin |

Changing a browser-visible port means changing `api.allowed_origins` too, or sign-in
fails with `ORIGIN_DENIED`.

## Changing A Port

1. Edit the key in `config.yml`.
2. Update `api.allowed_origins` and `services.overlay_web.public_origin` if a
   browser-visible origin changed.
3. Update the matching `PUBLIC_*` environment values in `compose.yml`.
4. `scarline doctor`, then `scarline stop && scarline start`.

## Read Next

- [Configuration Keys](/reference/configuration)
- [Docker Compose Stack](/cli/compose)
- [Runtime Topology](/platform/runtime-topology)
