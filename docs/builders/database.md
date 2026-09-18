# Database Changes

The schema lives in `infra/database/`, is loaded into the database image at build time,
and is applied by the PostgreSQL entrypoint **only when the data directory is empty**.

```text
infra/database/
├── Dockerfile              PostgreSQL 16-alpine plus the schema assets
├── schema.sql              Bootstrap entry point
├── init/                   Extensions and shared functions
├── tables/                 One dependency-ordered baseline file per table
├── triggers/               Cross-table trigger installation
├── migrations/             Ordered, forward-only schema changes
└── seeds/                  Idempotent reference data
```

`schema.sql` runs the migrations in order and then the seeds. Numeric prefixes document
execution order.

## The Baseline Is Frozen

`migrations/0001_initial_schema.sql` includes every file under `init/`, `tables/`, and
`triggers/`. Those files are the deployed baseline and **must not be edited** — a change
there would apply to fresh installs and silently skip existing ones.

Every later change is a new migration file.

## Adding A Migration

1. Create the next ordered file, for example
   `migrations/0003_add_session_label.sql`.
2. Make it transactional where PostgreSQL allows, and idempotent:

```sql
\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS label VARCHAR(200);

CREATE INDEX IF NOT EXISTS idx_sessions_label
  ON sessions(label);

COMMIT;
```

3. Append it to `schema.sql` **before** `seeds/seed.sql`, so a fresh database reaches the
   current schema by replaying the same history.
4. Update the matching schema in `packages/contracts` and the CoreAPI queries.
5. Update [Database Schema](/reference/database).

Never edit a migration that has been applied anywhere.

## Applying To An Existing Database

Restarting the container does **not** replay initialisation scripts. Apply a new
migration explicitly:

```bash
docker compose -p scarline exec -T database \
  psql -U scarline -d scarline -v ON_ERROR_STOP=1 < infra/database/migrations/0003_add_session_label.sql
```

Or, from the host with `psql` installed:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/database/migrations/0003_add_session_label.sql
```

In development, discarding the volume is often simpler — and irreversible:

```bash
scarline stop
rm -rf .runtime/postgres
scarline start
```

## Model Boundaries

Hold these when adding tables:

- `studies` is the top-level research entity.
- Platform **users** use RBAC; research **participants** are a separate entity and are
  never authentication subjects.
- Widgets and devices are **global registries**. Conditions own the experiment-specific
  configuration and usage of them.
- A session is one participant's run and executes several conditions through
  `session_conditions`.
- Runtime configuration is **snapshotted** for reproducibility.
- Runtime events belong to a session, and optionally to a session condition.
- Extensible or plugin-specific configuration is JSONB.

## Conventions

| Convention | Detail |
| --- | --- |
| Primary keys | `UUID ... DEFAULT uuid_generate_v4()`, except high-volume append-only tables which use `BIGSERIAL` |
| Timestamps | `TIMESTAMPTZ`, with `created_at` defaulting to `NOW()` |
| `updated_at` | Maintained by the shared trigger in `triggers/001_updated_at.sql` |
| Enumerations | `VARCHAR` with a `CHECK` constraint, mirroring the Zod enum |
| Flexible data | `JSONB`, defaulting to `'{}'::jsonb` |
| Cascades | `ON DELETE CASCADE` down the study hierarchy, `SET NULL` for actor references |
| Indexes | Defined in the same file as the table, partial where the query is |

Keep the `CHECK` constraint and the Zod enum in sync. They are two halves of the same
invariant, and drift between them shows up as a `500` rather than a `400`.

## Accessing The Database

Only CoreAPI connects to PostgreSQL, through the pool in
`services/core-api/src/infrastructure/database.ts`: at most 10 connections, a 3-second
connection timeout, a 30-second idle timeout, and a **10-second statement timeout**.

A query that could exceed 10 seconds needs pagination or an index, not a longer timeout.

For manual inspection:

```bash
docker compose -p scarline exec database psql -U scarline -d scarline
```

## Read Next

- [Database Schema](/reference/database)
- [Contracts And CoreAPI](/builders/contracts-and-core-api)
- [Runtime Directory](/cli/runtime-directory)
