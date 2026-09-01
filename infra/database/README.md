# SCARline database

This directory contains the PostgreSQL schema for SCARline. SQL files are kept
small by responsibility while `schema.sql` remains the canonical bootstrap
entry point.

## Layout

```text
infra/database/
├── schema.sql              # Bootstrap: initial migration, then seed data
├── init/                   # Extensions and shared database functions
├── tables/                 # One dependency-ordered baseline file per table
├── triggers/               # Cross-table trigger installation
├── migrations/             # Ordered, forward-only schema changes
└── seeds/                  # Idempotent reference/default data
```

Numeric prefixes document execution order. Baseline table files own their
table, constraints, and indexes. Cross-table behavior belongs under
`triggers/`.

## Model boundaries

- `studies` are the top-level research entity.
- Platform users use RBAC; research participants are separate entities.
- Widgets and devices are global registries. Conditions own their
  experiment-specific configuration and usage.
- A session is one participant's run of a study and may execute multiple
  conditions through `session_conditions`.
- Runtime configuration is snapshotted for reproducibility.
- Runtime events belong to a session and may additionally belong to a session
  condition.
- Extensible and plugin-specific configuration is stored as JSONB.
- Session analytics and summary tables are intentionally omitted for now.

## Bootstrap a new database

Run the entry point from any working directory:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/database/schema.sql
```

`schema.sql` applies the initial schema transaction and then the seed
transaction. Both are idempotent for a fresh or already-initialized database.

To install only the schema, without development/default data:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f infra/database/migrations/0001_initial_schema.sql
```

To reapply only the idempotent seeds:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/database/seeds/seed.sql
```

## Run with Docker

Build from the database directory so the Docker build context contains only
the database assets:

```sh
docker build -t scarline-database:local infra/database
```

Start PostgreSQL with a named data volume and load its secret from the root
`.env` file:

```sh
docker run --name scarline-database \
  --env-file .env \
  -p 5432:5432 \
  -v scarline-postgres-data:/var/lib/postgresql/data \
  scarline-database:local
```

The image defaults to a database named `scarline`. The upstream PostgreSQL
entrypoint applies `schema.sql` only when the data directory is empty. Apply
later migrations explicitly to an existing named volume; restarting the
container does not replay initialization scripts.

## Add a schema change

1. Do not edit an already-deployed migration.
2. Add the next ordered migration, for example
   `migrations/0002_add_session_label.sql`.
3. Make the migration transactional when PostgreSQL permits it.
4. Append the migration to `schema.sql` before `seeds/seed.sql` so new
   databases reach the current schema.

The table files referenced by `0001_initial_schema.sql` form the initial
baseline. Freeze the files under `init/`, `tables/`, and `triggers/` once that
baseline is deployed. Later production changes must be expressed only as new
migration files so fresh installs replay the same history as existing systems.
