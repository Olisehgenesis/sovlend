#!/usr/bin/env bash
# Pull a read-only copy of the production Postgres database onto the local
# Docker Postgres (port 5433) so this laptop can fork live data.
#
# Direction is production → localhost only. This script never SSHes a restore,
# never runs DROP/CREATE on the remote, and aborts if DATABASE_URL is not a
# loopback address.
#
# Usage:
#   pnpm db:pull-prod
#   pnpm db:pull-prod -- --yes
#   pnpm db:pull-prod -- --from-file .local-db-fork/sovlend-prod-....dump
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SSH_HOST="${SOVLEND_SSH_HOST:-sovlend}"
PROD_CONTAINER="${SOVLEND_PROD_POSTGRES_CONTAINER:-sovlend-postgres-1}"
LOCAL_CONTAINER="${SOVLEND_LOCAL_POSTGRES_CONTAINER:-sovlend-postgres-1}"
DUMP_DIR="${ROOT}/.local-db-fork"
YES=0
FROM_FILE=""

usage() {
  cat <<'EOF'
Pull production Postgres onto the local Docker database (localhost:5433).

  --yes          Skip the confirmation prompt
  --from-file F  Restore an existing custom-format dump instead of dumping prod
  -h, --help     Show this help

Override hosts with SOVLEND_SSH_HOST / SOVLEND_PROD_POSTGRES_CONTAINER /
SOVLEND_LOCAL_POSTGRES_CONTAINER if needed.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1; shift ;;
    --from-file)
      FROM_FILE="${2:?--from-file needs a path}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown flag: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { echo "error: $*" >&2; exit 1; }

is_loopback_host() {
  case "$1" in
    localhost|127.0.0.1|::1) return 0 ;;
    *) return 1 ;;
  esac
}

local_db_target() {
  # dotenvx prints a banner on stdout; keep only the TSV line from node.
  pnpm exec dotenvx run --ignore=MISSING_ENV_FILE -f .env.local -- node -e '
    const raw = process.env.DATABASE_URL;
    if (!raw) {
      console.error("DATABASE_URL is not set in .env.local");
      process.exit(1);
    }
    const url = new URL(raw);
    const database = url.pathname.replace(/^\//, "").split("?")[0] || "sovlend";
    process.stdout.write([url.hostname, url.port || "5432", database].join("\t") + "\n");
  ' | awk -F '\t' 'NF==3 { line=$0 } END { if (!line) { exit 1 } print line }'
}

ensure_local_postgres() {
  if docker inspect -f '{{.State.Health.Status}}' "$LOCAL_CONTAINER" >/dev/null 2>&1; then
    return 0
  fi
  log "starting local postgres + redis"
  pnpm exec dotenvx run -f .env --ignore=MISSING_ENV_FILE -- docker compose up -d postgres redis >/dev/null
  for _ in $(seq 1 30); do
    if docker inspect -f '{{.State.Health.Status}}' "$LOCAL_CONTAINER" 2>/dev/null | grep -q healthy; then
      return 0
    fi
    sleep 2
  done
  die "local container $LOCAL_CONTAINER did not become healthy"
}

dump_production() {
  local dest="$1"
  local remote_user remote_db
  remote_user="$(ssh -o BatchMode=yes "$SSH_HOST" "docker exec $PROD_CONTAINER printenv POSTGRES_USER")"
  remote_db="$(ssh -o BatchMode=yes "$SSH_HOST" "docker exec $PROD_CONTAINER printenv POSTGRES_DB")"
  [[ -n "$remote_user" && -n "$remote_db" ]] || die "could not read production POSTGRES_USER/POSTGRES_DB"
  log "dumping production ${remote_db} from ${SSH_HOST} (container ${PROD_CONTAINER})"
  ssh -o BatchMode=yes "$SSH_HOST" \
    "docker exec $PROD_CONTAINER pg_dump -U ${remote_user} -d ${remote_db} --format=custom --no-owner --no-acl" \
    > "$dest"
  [[ -s "$dest" ]] || die "production dump was empty"
  log "dump saved $(du -h "$dest" | awk '{print $1}') → $dest"
}

restore_local() {
  local dump="$1"
  local local_user local_db
  local_user="$(docker exec "$LOCAL_CONTAINER" printenv POSTGRES_USER)"
  local_db="$(docker exec "$LOCAL_CONTAINER" printenv POSTGRES_DB)"
  [[ -n "$local_user" && -n "$local_db" ]] || die "could not read local POSTGRES_USER/POSTGRES_DB"

  log "replacing local database ${local_db} in ${LOCAL_CONTAINER}"
  docker exec -i "$LOCAL_CONTAINER" psql -U "$local_user" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${local_db}'
  AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "${local_db}";
CREATE DATABASE "${local_db}" OWNER "${local_user}";
SQL

  set +e
  docker exec -i "$LOCAL_CONTAINER" pg_restore \
    --username="$local_user" \
    --dbname="$local_db" \
    --no-owner \
    --no-acl \
    --verbose < "$dump"
  local status=$?
  set -e
  # pg_restore uses 1 for non-fatal object warnings (common with --clean/--if-exists).
  if [[ "$status" -gt 1 ]]; then
    die "pg_restore failed with exit ${status}"
  fi
  log "local fork ready (${local_db} on 127.0.0.1:5433)"
}

IFS=$'\t' read -r db_host db_port db_name < <(local_db_target)
is_loopback_host "$db_host" || die "refusing to restore: DATABASE_URL host is '${db_host}', not localhost. Put 127.0.0.1:5433 in .env.local."
[[ "$db_port" == "5433" || "$db_port" == "5432" ]] || die "refusing to restore: unexpected local port ${db_port}"

log "target local fork: ${db_host}:${db_port}/${db_name}"
log "this will DROP and recreate the local database. production is read-only."

if [[ "$YES" -ne 1 ]]; then
  if [[ ! -t 0 ]]; then
    die "refusing to replace the local database without --yes (stdin is not a TTY)"
  fi
  printf 'Type fork to continue: '
  read -r answer
  [[ "$answer" == "fork" ]] || die "aborted"
fi

ensure_local_postgres
mkdir -p "$DUMP_DIR"

dump_file="$FROM_FILE"
if [[ -z "$dump_file" ]]; then
  dump_file="${DUMP_DIR}/sovlend-prod-$(date -u +%Y%m%dT%H%M%SZ).dump"
  dump_production "$dump_file"
else
  [[ -s "$dump_file" ]] || die "dump file not found or empty: $dump_file"
  log "restoring from $dump_file"
fi

restore_local "$dump_file"
log "done. restart pnpm dev if it was connected to the old local database."
