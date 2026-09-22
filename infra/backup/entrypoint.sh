#!/bin/sh
set -eu
echo "backup container starting"
/usr/local/bin/backup.sh || echo "WARN: immediate backup failed; cron will retry at 01:17 UTC"
exec crond -f -l 2
