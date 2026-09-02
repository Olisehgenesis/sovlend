#!/bin/sh
set -eu

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"

backup_dir="$(mktemp -d)"
trap 'rm -rf "$backup_dir"' EXIT
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="$backup_dir/sovlend-$timestamp.dump"

pg_dump --format=custom --no-owner --no-acl --file="$dump_file"
pg_restore --list "$dump_file" >/dev/null
sha256sum "$dump_file" > "$dump_file.sha256"
restic snapshots >/dev/null 2>&1 || restic init
restic backup "$backup_dir" --tag postgres --tag sovlend
restic forget --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune