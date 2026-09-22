#!/bin/sh
# Daily PostgreSQL dump to Backblaze B2 as readable gzipped SQL (not restic).
#
#   postgres/daily/sovlend-daily-YYYY-MM-DD.sql.gz
#   postgres/monthly/sovlend-monthly-YYYY-MM.sql.gz
#
# Keeps 21 dailies and 12 monthlies, then hard-deletes older files so the
# bucket cannot grow forever. Same-day reruns overwrite that day's object.
set -eu

if [ -z "${B2_APPLICATION_KEY_ID:-}" ] || [ -z "${B2_APPLICATION_KEY:-}" ]; then
  echo "backup skipped: B2_APPLICATION_KEY_ID / B2_APPLICATION_KEY are not set"
  exit 0
fi

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${B2_BUCKET:=jumpstart-v2}"
: "${BACKUP_PREFIX:=postgres}"
: "${BACKUP_KEEP_DAILY:=21}"
: "${BACKUP_KEEP_MONTHLY:=12}"

day="$(date -u +%Y-%m-%d)"
month="$(date -u +%Y-%m)"
daily_name="sovlend-daily-${day}.sql.gz"
monthly_name="sovlend-monthly-${month}.sql.gz"

export RCLONE_CONFIG_B2_TYPE=b2
export RCLONE_CONFIG_B2_ACCOUNT="$B2_APPLICATION_KEY_ID"
export RCLONE_CONFIG_B2_KEY="$B2_APPLICATION_KEY"
export RCLONE_CONFIG_B2_HARD_DELETE=true

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
dump_file="$workdir/$daily_name"

echo "dumping ${PGDATABASE} as ${daily_name}"
pg_dump --format=plain --no-owner --no-acl | gzip -9 > "$dump_file"
gzip -t "$dump_file"
header="$(gzip -dc "$dump_file" | head -n 5 || true)"
case "$header" in
  *"PostgreSQL database dump"*) ;;
  *)
    echo "dump does not look like PostgreSQL SQL" >&2
    exit 1
    ;;
esac
sha256sum "$dump_file" | awk '{print $1}' > "$dump_file.sha256"

remote_daily="b2:${B2_BUCKET}/${BACKUP_PREFIX}/daily"
remote_monthly="b2:${B2_BUCKET}/${BACKUP_PREFIX}/monthly"

rclone copyto "$dump_file" "${remote_daily}/${daily_name}"
rclone copyto "$dump_file.sha256" "${remote_daily}/${daily_name}.sha256"
rclone copyto "$dump_file" "${remote_monthly}/${monthly_name}"
rclone copyto "$dump_file.sha256" "${remote_monthly}/${monthly_name}.sha256"

echo "uploaded ${daily_name} and ${monthly_name}"

prune_keep() {
  remote="$1"
  pattern="$2"
  keep="$3"
  rclone lsf "$remote/" 2>/dev/null | grep "$pattern" | grep -v '\.sha256$' | sort -r | tail -n "+$((keep + 1))" | while IFS= read -r name; do
    [ -n "$name" ] || continue
    echo "deleting ${remote}/${name}"
    rclone deletefile "${remote}/${name}" || true
    rclone deletefile "${remote}/${name}.sha256" || true
  done
}

prune_keep "$remote_daily" '^sovlend-daily-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]\.sql\.gz$' "$BACKUP_KEEP_DAILY"
prune_keep "$remote_monthly" '^sovlend-monthly-[0-9][0-9][0-9][0-9]-[0-9][0-9]\.sql\.gz$' "$BACKUP_KEEP_MONTHLY"

echo "backup finished"
