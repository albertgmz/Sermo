#!/usr/bin/env bash
# `docker compose` for the running release on the test server: ./compose.sh ps, logs -f web, ...
set -euo pipefail
cd "$(dirname "$0")"
SERMO_TAG=$(cat current-tag) COMPOSE_FILE=compose.yaml:compose.vps.yaml exec docker compose "$@"
