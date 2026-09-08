#!/usr/bin/env bash
set -euo pipefail

# Applies the fund migration and runs the corresponding seed/backfill steps on the deployed host.
# Assumes the target server already has the latest application code checked out in DEPLOY_PATH and
# a working docker compose deployment configured like compose.yaml in this repository.

REMOTE="${DEPLOY_HOST:?Set DEPLOY_HOST to the SSH target, e.g. deploy@example.com}"
DEPLOY_PATH="${DEPLOY_PATH:?Set DEPLOY_PATH to the deployed SovLend checkout on the remote host}"
SSH_BIN="${SSH_BIN:-ssh}"

"${SSH_BIN}" "${REMOTE}" "cd '${DEPLOY_PATH}' && docker compose run --rm worker pnpm db:migrate && docker compose run --rm worker pnpm migration:seed-funds && docker compose run --rm worker pnpm migration:backfill-loan-funds"
