# Run Locally

Use this path when you need to make a code change and validate it against the current runtime model.

## Prerequisites

- Docker with Compose v2
- Node.js 20 or newer
- `pnpm`
- Python 3 for the process-manager IPC service

## Initial Setup

1. Install workspace dependencies.
2. Copy `.scarline.yaml.example` to `.scarline.yaml`.
3. Set host-specific values such as platform port, data directory, credentials, and optional CARLA path.

## Runtime Modes

| Mode | Command | Use When |
| --- | --- | --- |
| Production-style | `./scarline start` | You want the default multi-service runtime. |
| Development | `./scarline start --dev` | You are iterating on UI or service code with hot reload. |
| No CARLA | `./scarline start --no-carla` | You want the stack to boot without validating a CARLA host binary. |
| No overlay shell | `./scarline start --no-overlay` | You only need browser-based or backend validation. |
| Widget test | `./scarline start --widget-test` | You are validating overlay widgets and runtime behavior. |

## Primary Endpoints

- `/admin`
- `/api`
- `/ws`
- `/overlay`
- `/docs`

## Minimum Validation Loop

1. Make the change.
2. Update impacted docs under `docs/`.
3. Run focused checks first, then broader checks only if needed.
4. Validate one relevant launcher mode.

## Read Next

- [Builders Overview](/builders/)
- [Local Development](/builders/local-development)
- [Testing And Validation](/builders/testing-and-validation)
