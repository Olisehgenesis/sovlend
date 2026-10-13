# Production deployment

This is the production runbook for SovLend. Read it before changing or deploying
production. The production host is reached with the SSH alias `sovlend`; the
application checkout is `/root/apps/sovlend` and the deployed branch is `master`.

## Safety rules

- Never run bare `docker compose` against the production checkout. Its `.env`
  values are encrypted with dotenvx; Compose does not decrypt them and can pass
  ciphertext to containers when creating or recreating services.
- Wrap every production Compose command with
  `dotenvx run -f .env -- docker compose ...`.
- Never print or copy `.env`, `.env.keys`, decrypted environment variables,
  runtime override files, or full Compose configuration into logs, tickets, or
  chat. The production `.env.keys` and private database-connection override
  must stay on the server.
- Preserve server-local changes. In particular, inspect `git status` before
  pulling and do not overwrite or revert a modified `infra/caddy/Caddyfile`.
- Deploy only the services needed for the release. Do not restart PostgreSQL,
  Redis, Caddy, or unrelated containers as part of a normal application release.
- If PostgreSQL is unhealthy, investigate the cause and verify a read-only
  application database query before taking any action. Do not restart, recreate,
  or migrate an unhealthy database as part of a routine release. An
  application-only release may proceed only when database access is verified,
  the release is compatible with the existing schema, and it does not alter
  production data; otherwise stop. If a required backup cannot be verified or
  the release has unexpected schema/data migrations, stop. Do not try to fix an
  unhealthy database by recreating it.

The production checkout may have `compose.override.yaml` linked to a private
server-side override. Preserve that link and file. Do not copy the override into
Git or replace it with local values.

The running services may also use a versioned runtime Compose override outside
the checkout. Before deploying, inspect only the Compose file paths recorded on
the existing containers:

```bash
docker inspect sovlend-web-1 \
  --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}'
```

Use the same ordered `-f` file list for deployment that started the running
containers. Do not print the resolved Compose configuration: runtime overrides
can contain decrypted credentials and private connection settings.

## Prepare and validate locally

Start from the intended branch and inspect the exact changes:

```bash
git status --short --branch
git fetch origin
git log --oneline --decorate -5
git diff --check
```

Run the focused tests for the changed area, then the applicable checks:

```bash
pnpm test -- src/path/to/related.test.ts
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

Use `master` for production. Commit and push only when authorized; never force
push. Confirm the pushed commit is on `origin/master` before connecting to the
server.

## Pre-deployment checks

Check the host and its live services without printing secrets:

```bash
ssh sovlend
cd /root/apps/sovlend
git status --short --branch
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
docker inspect sovlend-postgres-1 --format '{{.State.Status}} {{.State.Health.Status}}'
curl -fsS http://127.0.0.1:3000/api/health
```

The production web and worker must be able to reach PostgreSQL. A green web
health endpoint alone is not proof of database access; check the database
connection using the running worker/application and verify the result without
printing its `DATABASE_URL`. If PostgreSQL reports unhealthy, investigate why
before any command that could recreate or migrate it.

Fetch and fast-forward the application checkout only after confirming that
incoming changes do not conflict with server-local modifications:

```bash
git fetch origin
git log --oneline HEAD..origin/master
git merge --ff-only origin/master
git rev-parse --short HEAD
```

If the checkout is not safe to fast-forward, stop. Do not stash, reset, discard,
or manually copy over its local changes.

## Back up before data/schema changes

For releases that change the schema or production data, take a fresh database
backup before migration. First require PostgreSQL to be healthy and verify the
application's database connection. Create a private, timestamped backup and
verify it is non-empty and readable:

```bash
mkdir -p /root/backups
chmod 700 /root/backups
umask 077
backup="/root/backups/sovlend-pre-$(date +%Y%m%d-%H%M%S).dump"
dotenvx run -f .env -- docker compose exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup"
test -s "$backup"
dotenvx run -f .env -- docker compose exec -T postgres \
  pg_restore --list < "$backup" >/dev/null
```

Do not proceed if the backup command fails or verification fails. Do not print
the dump contents. Keep backups access-restricted and follow the organization's
retention policy.

## Build and deploy the application

For schema changes, run only reviewed, additive/compatible migrations after a
verified backup and healthy database:

```bash
dotenvx run -f .env -- docker compose run --rm migrate
```

For a routine application-only release, build and replace only the web and
worker containers. The explicit `uploads-init` run is required when deploying
with `--no-deps`; it repairs the shared upload-volume ownership for UID/GID
`1001:1001`.

```bash
dotenvx run -f .env -- docker compose build web worker
dotenvx run -f .env -- docker compose run --rm --no-deps uploads-init
dotenvx run -f .env -- docker compose up -d --no-deps --wait --wait-timeout 180 web worker
```

If the running containers use a runtime override, include its existing path in
each command using `-f` in the same order as the container labels.

Do not use `--no-deps` for a release that requires a migration until the
migration has completed successfully. Do not run permission reseeds,
backfills, or other data-changing tasks unless the release explicitly requires
them and their impact is understood.

## Verify after deployment

Confirm the web and worker are running, the local health endpoint responds,
and a real read-only database query succeeds:

```bash
docker ps --filter name=sovlend-web --filter name=sovlend-worker \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
curl -fsS http://127.0.0.1:3000/api/health
dotenvx run -f .env -- docker compose exec -T worker node -e \
  'const {PrismaClient}=require("@prisma/client"); const db=new PrismaClient(); db.$queryRaw`SELECT 1`.then(()=>console.log("database query ok")).catch(e=>{console.error("database query failed");process.exitCode=1}).finally(()=>db.$disconnect())'
```

Also inspect the web/worker logs for startup errors and manually verify the
changed page/API with an authorized account. For General Ledger releases, verify
the all-account report and its date filters; do not treat the public health
endpoint as a substitute for checking the report itself.

## Rollback

Before building, record the currently running web and worker image IDs/tags and
retain those images until the release is accepted. If the application fails
health or smoke checks, restore the previous application images and recreate
only web/worker with Compose, still wrapped in `dotenvx run`. Never roll back a
database migration by recreating PostgreSQL or restoring a dump over live data
without an explicit recovery plan and authorization.

## Related guidance

- [Environment variable security](docs/ENV_SECURITY.md) explains dotenvx and
  encrypted environment handling.
- [AGENTS.md](AGENTS.md) directs future agents to this runbook before production
  changes.
