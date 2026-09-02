# SovLend Implementation Status

Verified on 1 September 2026.

## Operational

- Docker: Caddy, Next.js, PostgreSQL 17, Redis and BullMQ worker are running.
- Better Auth: email/password, sessions, passkeys, admin user provisioning and protected routes.
- Backoffice: super-admin email allowlist, real system counts, migration history and investor invitation creation.
- Branch access: organization/office scopes, child-branch inheritance, approval limits and maker-checker loan approval service.
- Pricing: CoinGecko, Kraken, Coinbase, Fawaz, CurrencyFreaks, ExchangeRate-API and optional FreeCryptoAPI adapters.
- Rate cache: one-hour display cache, five-minute refresh, two-minute transaction freshness and immutable PostgreSQL snapshots.
- Investors: access requests, one-time hashed invitations, account creation, business access, Lightning invoice generation, QR display and payment verification.
- Migration: GET-only ILend extraction, retries, duplicate-page detection, checksummed archive, deterministic import and reconciliation.
- Imported data: 890 clients, two offices and UGX currency metadata. Financial account balances have not been imported.
- Imported configuration: 19 loan products and 200 verified GL accounts.
- Client operations: searchable branch-scoped directory, client creation and full-scope CSV export.
- Loan origination: application creation, product-limit validation, maker-checker approval and approved account creation.
- Loan servicing: deterministic flat/declining schedules, mapped disbursement, repayment component allocation, account schedule/transaction view and CSV export.
- Arrears: daily BullMQ classification, cure and automatic closure when no balance remains.
- Accounting setup: manager-controlled product and settlement mappings; disbursement and repayment fail closed until mappings exist.
- Data integrity: append-only price, audit, loan and savings transactions; posted journals are immutable and must balance per currency.
- Backup: backup container and schedule are present, but end-to-end backup currently fails until RESTIC_REPOSITORY and RESTIC_PASSWORD are configured; restore drill is pending re-verification.

## Not Yet A Complete Lending Product

The following remain separate implementation phases and must not be represented as complete:

- loan product creation/edit/versioning screens;
- repayment reversal, loan rejection, restructuring, write-off and recovery workflows;
- savings transaction workflows;
- treasury accounting mappings and final Lightning settlement posting;
- group, center, collateral, charge and document workflows;
- mobile-money integration and reconciliation;
- trial balance, arrears, aging and regulatory reports;
- full legacy loan, repayment, savings, journal and attachment migration.

Until those items and an independent security review are complete, SovLend must not move or custody real funds.