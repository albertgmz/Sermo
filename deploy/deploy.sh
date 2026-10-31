#!/usr/bin/env bash
# Deploys one commit on the test server: `deploy.sh <commit>`, started detached by
# .github/workflows/deploy.yml once it has copied the release's files to /opt/sermo/incoming. It
# keeps the running release's files in previous/, backs up the database just before the new images
# start, checks the site through the ingress, and on failure puts back the previous files, images
# and that backup (the new release may already have migrated the database, which the previous one
# cannot read).
set -euo pipefail

cd /opt/sermo
export COMPOSE_FILE=compose.yaml:compose.vps.yaml
tag=$1
previous=$(cat current-tag 2>/dev/null || true)
files="compose.yaml compose.vps.yaml Caddyfile.vps deploy.sh compose.sh"
volume=sermo_sermo_data
mkdir -p backups previous
# The workflow logs in to the registry for this run.
trap 'docker logout ghcr.io > /dev/null 2>&1 || true' EXIT

check() {
  local path
  for path in / /robots.txt /sitemap.xml /health; do
    docker compose exec -T ingress wget -q -O /dev/null "http://127.0.0.1:8080$path" || {
      echo "check failed: $path"
      return 1
    }
  done
}

# A consistent copy (VACUUM INTO) made by the running backend, or by a one-off container of the new
# image when none runs; nothing when the volume holds no database yet.
backup=
backup_database() {
  local vacuum="require('node:fs').rmSync('/data/deploy-backup.db', { force: true }); new (require('bun:sqlite').Database)('/data/sermo.db').run(\"VACUUM INTO '/data/deploy-backup.db'\")"
  if [ -n "$previous" ] && [ -n "$(SERMO_TAG=$previous docker compose ps -q --status running sermo)" ]; then
    SERMO_TAG=$previous docker compose exec -T sermo bun -e "$vacuum"
  elif docker run --rm -v "$volume:/data:ro" alpine:3 test -f /data/sermo.db; then
    docker compose run --rm --no-deps -T sermo bun -e "$vacuum"
  else
    return 0
  fi
  backup=sermo-$(date -u +%Y%m%d-%H%M%S)-${previous:0:8}.db
  docker run --rm -v "$volume:/data" -v "$PWD/backups:/backup" alpine:3 \
    sh -c "mv /data/deploy-backup.db /backup/$backup && chown $(id -u):$(id -g) /backup/$backup"
  echo "backup backups/$backup ($(stat -c %s "backups/$backup") bytes)"
  # The newest three are kept.
  ls -1t backups/sermo-*.db | tail -n +4 | xargs -r rm --
}

if [ -n "$previous" ]; then
  for f in $files; do cp "$f" previous/; done
fi
for f in $files; do cp "incoming/$f" .; done

export SERMO_TAG=$tag
docker compose pull sermo web tunnel
backup_database
if docker compose up -d --no-build --remove-orphans --wait --wait-timeout 300 && check; then
  echo "$tag" > current-tag
  # Best effort, never a failure: one request per policy page fills the web app's cache of its text.
  for path in /privacy /terms /cookies /legal /rules /contact; do
    docker compose exec -T ingress wget -q -O /dev/null "http://127.0.0.1:8080$path" || true
  done
  # Images of releases other than this one and the previous one.
  docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^ghcr\.io/albertgmz/sermo(-web)?:' \
    | grep -vE ":($tag|${previous:-none})\$" | xargs -r docker rmi > /dev/null || true
  echo "deployed $tag"
  exit 0
fi

echo "deploy of $tag failed"
docker compose logs --tail 50 sermo web || true
if [ -z "$previous" ]; then
  echo "FAILED: no previous release to go back to; the site is down"
  exit 1
fi
for f in $files; do cp "previous/$f" .; done
export SERMO_TAG=$previous
docker compose stop sermo web
if [ -n "$backup" ]; then
  docker compose run --rm --no-deps -T -v "$PWD/backups:/backup:ro" sermo \
    sh -c "rm -f /data/sermo.db-wal /data/sermo.db-shm && cp /backup/$backup /data/sermo.db"
fi
if docker compose up -d --no-build --wait --wait-timeout 300 && check; then
  echo "rolled back to $previous"
else
  echo "FAILED: the rollback to $previous did not come up either; the site is down"
fi
exit 1
