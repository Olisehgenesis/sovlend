#!/bin/sh
set -eu
echo "backup container starting; next dump is midnight Africa/Kampala"
exec crond -f -l 2
