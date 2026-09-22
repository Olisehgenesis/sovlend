#!/bin/sh
# Download a named gzipped SQL dump from B2. Does not restore it.
#
#   restore.sh sovlend-daily-2026-09-22.sql.gz
#
# Then, on an empty throwaway database only:
#   gzip -dc that-file.sql.gz | psql
set -eu

if [ -z "${B2_APPLICATION_KEY_ID:-}" ] || [ -z "${B2_APPLICATION_KEY:-}" ]; then
  echo "B2_APPLICATION_KEY_ID / B2_APPLICATION_KEY are required" >&2
  exit 1
fi

name="${1:?usage: restore.sh sovlend-daily-YYYY-MM-DD.sql.gz}"
: "${B2_BUCKET:=jumpstart-v2}"
: "${BACKUP_PREFIX:=postgres}"

touch /tmp/rclone.conf
export RCLONE_CONFIG=/tmp/rclone.conf
export RCLONE_CONFIG_B2_TYPE=b2
export RCLONE_CONFIG_B2_ACCOUNT="$B2_APPLICATION_KEY_ID"
export RCLONE_CONFIG_B2_KEY="$B2_APPLICATION_KEY"
export RCLONE_CONFIG_B2_HARD_DELETE=true

case "$name" in
  sovlend-daily-*.sql.gz) ;;
  *)
    echo "name must be sovlend-daily-YYYY-MM-DD.sql.gz" >&2
    exit 1
    ;;
esac

dest="./$name"
rclone copyto "b2:${B2_BUCKET}/${BACKUP_PREFIX}/daily/${name}" "$dest"
echo "downloaded $dest"
echo "restore on a throwaway database with: gzip -dc $dest | psql"
