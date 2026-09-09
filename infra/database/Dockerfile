# syntax=docker/dockerfile:1

ARG POSTGRES_VERSION=16-alpine

FROM postgres:${POSTGRES_VERSION}

LABEL org.opencontainers.image.title="SCARline PostgreSQL" \
      org.opencontainers.image.description="PostgreSQL with the SCARline schema and seed data"

ENV POSTGRES_DB=scarline

# The upstream PostgreSQL entrypoint executes top-level *.sql files only when
# the data directory is empty. The numbered entry point uses psql \ir commands
# to load the dependency-ordered files copied into the sibling directories.
COPY --chown=postgres:postgres schema.sql /docker-entrypoint-initdb.d/10-scarline-schema.sql
COPY --chown=postgres:postgres init/ /docker-entrypoint-initdb.d/init/
COPY --chown=postgres:postgres tables/ /docker-entrypoint-initdb.d/tables/
COPY --chown=postgres:postgres triggers/ /docker-entrypoint-initdb.d/triggers/
COPY --chown=postgres:postgres migrations/ /docker-entrypoint-initdb.d/migrations/
COPY --chown=postgres:postgres seeds/ /docker-entrypoint-initdb.d/seeds/

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD pg_isready --quiet \
      --username "${POSTGRES_USER:-postgres}" \
      --dbname "${POSTGRES_DB:-scarline}" || exit 1
