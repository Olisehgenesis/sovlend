#!/usr/bin/env bash
set -euo pipefail

# Guarded Compose wrapper for SovLend servers.
#
# NEVER run bare `docker compose` against a checkout whose .env is encrypted with dotenvx:
# Compose cannot decrypt the values, so the next time a service is recreated its environment
# is silently filled with `encrypted:...` ciphertext (healthchecks fail with "invalid
# connection option", and any env-reading service breaks). This is exactly how the production
# postgres container ended up unhealthy on 18 Oct 2026 -- see DEPLOYMENT.md "Safety rules".
#
# This wrapper makes the correct invocation the easy one: it always decrypts first, refuses to
# run when decryption fails (missing/mismatched .env.keys), and passes every argument through
# to Compose unchanged:
#
#   ./scripts/deploy/dc.sh ps
#   ./scripts/deploy/dc.sh -f /root/apps/sovlend-release-<sha>.yaml build web worker
#   ./scripts/deploy/dc.sh -f /root/apps/sovlend-release-<sha>.yaml up -d --no-deps --wait web worker
#
# Run it from the server checkout root (it locates .env relative to itself, so any cwd works).

cd "$(dirname "$0")/../.."

if [ ! -f .env ]; then
  echo "dc.sh: no .env found in $(pwd) -- run from a SovLend server checkout" >&2
  exit 1
fi

# Fail fast when .env cannot be decrypted instead of letting Compose substitute ciphertext
# into container environments. Probes POSTGRES_USER's shape only -- the value is never printed.
if ! dotenvx run -f .env -- sh -c '[ -n "${POSTGRES_USER:-}" ] && [ "${POSTGRES_USER#encrypted:}" = "$POSTGRES_USER" ]' >/dev/null 2>&1; then
  echo "dc.sh: .env did not decrypt (is .env.keys present and matching this .env?). Refusing to run Compose." >&2
  exit 1
fi

exec dotenvx run -f .env -- docker compose "$@"
