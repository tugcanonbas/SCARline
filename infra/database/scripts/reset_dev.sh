#!/usr/bin/env sh
set -eu

if [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_DB:-}" ]; then
  echo "POSTGRES_USER and POSTGRES_DB are required" >&2
  exit 1
fi

psql "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST:-localhost}:${POSTGRES_PORT:-5432}/postgres" \
  -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};"

psql "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST:-localhost}:${POSTGRES_PORT:-5432}/postgres" \
  -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE ${POSTGRES_DB};"

psql "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST:-localhost}:${POSTGRES_PORT:-5432}/${POSTGRES_DB}" \
  -v ON_ERROR_STOP=1 \
  -f /workspace/infra/database/schema.sql \
  -f /workspace/infra/database/seed/seed_dev.sql
