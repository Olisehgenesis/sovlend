# Environment variable security (dotenvx)

SovLend loads all runtime configuration from `.env` files via [dotenvx](https://dotenvx.com/) --
already the case for `npm run dev` / `npm run worker` (`package.json`'s scripts wrap the real
command in `dotenvx run --`), and now also for `npm run build` / `npm run start`. This doc covers
the encryption half: every `.env` in every environment (local, beta, production) should have its
**values** encrypted at rest, so the file is safe even if it's ever accidentally exposed (a
misdirected backup, a screen share, a leaked server snapshot, a careless `cat` in a shared
terminal). Variable **names stay exactly as-is** -- only the values become ciphertext.

## How it works (mental model)

dotenvx uses public-key encryption per `.env` file:

- `DOTENV_PUBLIC_KEY` is written as a comment at the top of the encrypted `.env` file itself --
  it's not a secret, anyone can see it, it's only used to encrypt.
- `DOTENV_PRIVATE_KEY` lives in a **separate** `.env.keys` file, next to `.env` but never
  committed. This is the only thing that can decrypt the values. Losing it means the `.env` file
  is permanently unreadable (keep a copy in your password manager / secrets vault, not just on
  the server).
- Anything that runs through `dotenvx run -- <command>` transparently decrypts `.env` into
  `process.env` for that command's process only -- the file on disk stays encrypted the whole
  time.

This means an encrypted `.env` is safe to commit to git, safe to send in Slack, safe to back up
in plaintext storage -- **`.env.keys` is the one file that must be treated like a password**.

## One-time setup per environment (local, beta, production)

Each environment (your laptop, the beta server, the production server) has its own `.env` and
its own `.env.keys` -- they are never shared between environments, and `.env.keys` never leaves
the machine it was generated on (copy it out to a password manager as a backup, don't copy it
*to* another server).

```bash
# 1. Copy the template and fill in real values for this environment.
cp .env.example .env
$EDITOR .env

# 2. Encrypt it in place. This rewrites .env with ciphertext values and creates .env.keys
#    alongside it (or appends to it, if one already exists for another env var group).
npx dotenvx encrypt -f .env

# 3. Confirm decryption works before trusting it:
npx dotenvx run --ignore=MISSING_ENV_FILE -- node -e "console.log(!!process.env.DATABASE_URL)"
# -> should print `true`

# 4. Store .env.keys somewhere durable OUTSIDE the repo/server (password manager, 1Password,
#    Bitwarden -- dotenvx has native integrations, see https://dotenvx.com/docs/1password).
#    If this machine is lost and you didn't back up .env.keys, the .env file cannot be recovered
#    -- you'd have to rebuild it from scratch with new secrets (rotating everything).
```

`.gitignore` already excludes every `.env*` file and, redundantly, `.env.keys*`/`*.env.keys`
explicitly (belt-and-suspenders, since `.env.keys` is the one file that must never be committed
under any circumstance -- everything else in the `.env*` family is merely *not currently*
committed by convention, since we haven't opted into checking encrypted `.env` files into git
yet). `.env.example` is the one exception -- it holds only variable names/comments, never real
values, and is meant to be committed so anyone can see what configuration exists.

## Adding a new environment variable

1. Add the (empty or placeholder) key to `.env.example` with a short comment on what it's for and
   which module reads it.
2. Add the real value to your local `.env`, then re-run `npx dotenvx encrypt -f .env` (safe to
   run repeatedly -- already-encrypted values are left alone, only new plaintext values get
   encrypted).
3. Repeat step 2 on beta and production when you deploy the code that reads the new variable.

## Rotating a secret or the encryption key itself

- **Rotating a secret's value** (e.g. `BLINK_API_KEY` compromised): edit `.env` with the new
  plaintext value for that one key, re-run `npx dotenvx encrypt -f .env` -- only that line
  changes.
- **Rotating the encryption keypair itself** (e.g. `.env.keys` leaked): `npx dotenvx rotate` (or
  delete `.env.keys` and re-run `encrypt` against a decrypted copy) generates a fresh keypair and
  re-encrypts every value -- the old `.env.keys` becomes useless afterward, which is the point.

## Current variables

See `.env.example` for the full, documented list (database/cache, auth, price providers, the
read-only legacy migration source, Blink Lightning, SMS, and backup/restic credentials). Keep
that file in sync whenever a new `process.env.*` reference is added to the codebase.
