# SCARline

SCARline is organized as an npm workspace. Its CLI is a platform-neutral Node.js
package and supports Linux, macOS, and Windows.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Install from a clone

```sh
git clone <repository-url>
cd scarline
npm install
scarline setup
```

`scarline setup` validates `config.yml`, generates a `.env` with strong random
secrets when needed, and creates the ignored `.runtime/` directory structure.
It is safe to run repeatedly: existing secret values are never overwritten or
printed. `.env` is the only source for secrets and is excluded from Git.
Bootstrap and development settings live in `config.yml`; runtime state, logs,
and generated data live under `.runtime/`.

`npm install` installs the workspace dependencies and automatically builds the
CLI. It also links the executable into npm's global executable directory, so it
can be invoked directly from any directory:

```sh
scarline setup
scarline status
scarline --help
```

If the command is not found after installation, ensure npm's global executable
directory is on your `PATH`. Node version managers normally configure this for
you.

To remove the global development link later, run:

```sh
npm unlink --global @scarline/cli
```

During development, the CLI can also be run without a global link:

```sh
npm run dev:cli -- setup
```

## Build and package

The TypeScript build produces standard ESM JavaScript, so the same package runs
on all three supported operating systems:

```sh
npm run build
npm run package:cli
```

`package:cli` creates an installable `.tgz` package. npm generates a shell
launcher on Linux and macOS and a command shim on Windows from the package's
`scarline` binary declaration.

## Current commands

```text
scarline
├── setup
├── start
├── stop
├── restart
├── status
├── doctor
└── logs
```

`setup`, `start`, `status`, `stop`, and the read-only `doctor` diagnostics are
operational. The current lifecycle commands manage the PostgreSQL and RabbitMQ
Compose infrastructure while preserving data under `.runtime/`. `restart` and
`logs` retain placeholder behavior until their platform integrations are added.

## Documentation

The full documentation lives in `docs/` as a VitePress site and is served by the
Admin Panel, so it is available at `http://localhost:5173/docs` once the platform
is running — the sidebar's **Documentation** button opens it in a new tab.

To work on it without the platform:

```sh
npm run dev:docs      # http://localhost:4040/docs/
npm run build:docs    # docs/.vitepress/dist
```

| Section | Covers |
| --- | --- |
| Getting Started | Install, first run, first study, troubleshooting |
| CLI & Configuration | Commands, `config.yml`, `.env`, `.runtime/`, Compose |
| Platform | Architecture, topology, lifecycle, overlays, simulators, sensors, data, security |
| Operations | Running studies, readiness, sessions, logs, exports, recovery |
| Builders | Contracts, CoreAPI, widgets, adapters, drivers, schema, testing |
| Reference | Routes, channels, messaging, schema, config keys, ports, error codes |
