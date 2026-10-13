# SovLend

SovLend is a growth-oriented, multi-currency microfinance platform for lending, savings, investor capital, treasury operations, and auditable settlement through UGX, BTC, and USDC channels.

The repository currently contains the architecture foundation and an operations dashboard. It is not ready to custody or move real funds.

## Stack

- Next.js 16, React 19, and TypeScript
- PostgreSQL 17 and Prisma
- Redis and BullMQ workers
- Integer minor-unit money values and Decimal.js rates
- Docker Compose and Caddy TLS
- Daily gzipped SQL dumps to Backblaze B2
- Sonner accessible toasts
- Better Auth with email/password, admin controls, sessions, and WebAuthn passkeys
- Vitest and ESLint

## Local Development

```bash
cp .env.example .env
docker compose up -d postgres redis
pnpm db:generate
pnpm dev
```

Open `http://localhost:3000`.

Create the first migration after reviewing the schema:

```bash
pnpm exec prisma migrate dev --name foundation
```

Create the first administrator after applying the schema:

```bash
pnpm dlx auth@1.7.2 create-admin --config ./src/lib/auth.ts --email admin@example.com --name "SovLend Admin" --role admin
```

Public registration is disabled. Administrators create users from `/admin/users` and assign their organization, office, and operational role. Better Auth stores password hashes in PostgreSQL `Account` records; plaintext passwords are never stored. Users register passkeys from `/settings/security` after their first sign-in.

Run the BullMQ process separately:

```bash
pnpm worker
```

## Validation

```bash
pnpm test
pnpm lint
pnpm db:validate
pnpm build
docker compose --env-file .env.example config
```

## Production

Read [DEPLOYMENT.md](DEPLOYMENT.md) before production work. Production uses an
encrypted dotenvx environment and requires wrapping all Docker Compose commands
with `dotenvx run`; bare Compose commands can recreate services with encrypted
ciphertext in place of their real environment values. Keep `.env.keys` and
server-specific overrides private.

Passkeys require HTTPS in production. `localhost` is the only supported insecure development origin.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module boundaries, reminders, financial invariants, pricing policy, growth stages, and security gates. The legacy system map is in [SYSTEM_AUDIT.md](SYSTEM_AUDIT.md).
