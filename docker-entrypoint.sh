#!/bin/sh
set -e

DATA_DIR="/app/data"
if [ -n "${SQLITE_DB_PATH}" ]; then
  DATA_DIR=$(dirname "${SQLITE_DB_PATH}")
fi
mkdir -p "${DATA_DIR}"

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${DATA_DIR}" || true
  exec su-exec node "$@"
fi

exec "$@"
