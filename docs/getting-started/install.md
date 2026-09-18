# Install And First Run

This page takes a clean machine to a running platform and a signed-in administrator.

## 1. Install The Workspace

```bash
git clone <repository-url>
cd SCARline
npm install
```

`npm install` installs the npm workspaces and then runs a `postinstall` step that
builds `@scarline/contracts` and `@scarline/cli`, builds the Electron desktop overlay,
and links the `scarline` executable into npm's global executable directory.

Verify the link:

```bash
scarline --help
```

If the command is not found, npm's global executable directory is not on your `PATH`.
Node version managers normally configure this. You can also run the CLI without the
global link:

```bash
npm run dev:cli -- --help
```

## 2. Run Setup

```bash
scarline setup
```

`setup` does four things and is safe to run repeatedly:

1. Locates the repository root and validates `config.yml` against the shared schema.
2. Creates or completes `.env`, generating any missing secret. Existing values are
   never overwritten or printed, and the file is set to mode `600` on Linux and macOS.
3. Creates the `.runtime/` directory tree.
4. Creates the IO Client Python virtual environment when the IO Client is configured to
   run on the host.

::: warning The bootstrap password is not random
Every secret is generated as 32 random bytes except `BOOTSTRAP_ADMIN_PASSWORD`, which
is copied verbatim from `.env.example` (`scarline`). It exists only to create the first
administrator, and CoreAPI forces a password change at first sign-in. Change it in
`.env` before exposing the platform beyond a local machine.
:::

See [Secrets And .env](/cli/secrets) for what each secret protects.

## 3. Check The Host

```bash
scarline doctor
```

`doctor` is read-only. It verifies Node.js 22+, npm 10+, Docker, Docker Compose, a
reachable Docker daemon, a valid `config.yml`, complete `.env` secrets and their file
permissions, the runtime directory layout, the IO Client Python environment, the sensor
driver directory, that the Compose file parses, that the ports the stack needs are
free, that the Electron overlay host is built, and the CARLA executable when simulator
autostart is enabled.

Each check reports `PASS`, `WARN`, or `FAIL`, and the command exits non-zero when any
check fails. A port reported as `WARN` is usually a SCARline service that is already
running.

## 4. Start The Platform

```bash
scarline start
```

This runs `docker compose up --detach --build --wait` for the configured services, then
starts the host-side processes (the Electron desktop overlay, and the IO Client when it
is configured for the host runtime). The command prints a per-service status table when
the stack is up.

Simulator selection:

| Command | Result |
| --- | --- |
| `scarline start` | Uses `simulator.default` when `simulator.autostart` is `true`; otherwise starts no simulator adapter |
| `scarline start --simulator mock` | Starts the Mock Simulator adapter (the `mock` Compose profile) |
| `scarline start --simulator carla` | Starts the CARLA host server and the CARLA adapter (the `carla` Compose profile) |
| `scarline start --no-sim` | Forces the Mock Simulator; use this on hosts where CARLA is unavailable |
| `scarline start --mock-io` | Enables the synthetic sensor suite in the IO Client |

CARLA 0.9.16 requires a Linux or Windows host. On macOS, `scarline start --simulator carla`
fails with a clear message; use `--no-sim` instead.

You cannot switch simulator types while the stack is up. Run `scarline stop` first.

## 5. Confirm It Is Up

```bash
scarline status
```

Then check the endpoints:

| Endpoint | Expected |
| --- | --- |
| `http://localhost:8088/health` | CoreAPI liveness, always `healthy` when the process is up |
| `http://localhost:8088/ready` | `200` once PostgreSQL, RabbitMQ, and the administrator bootstrap are ready |
| `http://localhost:5173` | Admin Panel |
| `http://localhost:4000/healthz` | Overlay Web |
| `http://localhost:9000/ready` | Sim-Bridge |
| `http://localhost:15672` | RabbitMQ management UI |

The Admin Panel redirects to `/startup` until CoreAPI reports ready, so a redirect loop
at first start usually means `/ready` is still returning `503`.

## 6. Sign In

Open `http://localhost:5173`.

The first administrator is created by CoreAPI, not by an onboarding wizard. When the
`users` table is empty, CoreAPI inserts one account using `bootstrap.admin_username`
from `config.yml` (`admin` by default) and `BOOTSTRAP_ADMIN_PASSWORD` from `.env`, and
assigns it the `admin` role.

That account is created with `password_reset_required`, so the first sign-in redirects
to `/change-password` and no other screen is reachable until the password is changed.
The new password must be at least 12 characters. Changing it revokes the refresh cookie,
so you sign in again with the new credential.

## 7. Stop The Platform

```bash
scarline stop
```

`stop` terminates the desktop overlay, the IO Client, and the CARLA driver, then runs
`docker compose down` across the `mock`, `carla`, and `io-docker` profiles, and finally
stops the CARLA host server. Runtime data under `.runtime/` is preserved, so the
database survives a stop/start cycle.

## Read Next

- [Run Your First Study](/getting-started/first-study)
- [CLI Commands](/cli/commands)
- [config.yml](/cli/configuration)
- [Troubleshooting](/getting-started/troubleshooting)
