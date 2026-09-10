# Migration & Backfill Scripts — Catalog and Run Status

Purpose: one place that lists every script under `src/migration/`, what it does, whether it's
safe to re-run, and — most importantly — whether it has actually been **run against
production** vs only against local dev. Update this file whenever a migration/backfill is run
against an environment.

Legend: ✅ run · ⚠️ partially run / stale · ❌ never run · — not applicable to that environment

## Extraction (read-only, pulls from live iLend / legacy Fineract API)

| Script | Purpose | Local | Production |
|---|---|---|---|
| `extract.ts` (`extractLegacy`) | Pulls foundation roster: offices, staff, clients, groups, products, charges. Writes checksummed archive under `.migration-data/`. | ✅ | ✅ (via `sync-recent.ts` runs) |
| `extract-loans.ts` | Pulls full loan history (schedule + transactions) per client/group, resumable. | ✅ | ✅ (via `sync-recent.ts`) |
| `extract-savings.ts` | Pulls full savings account + transaction history. | ✅ | ✅ (via `sync-recent.ts`) |

## One-time archive import (bulk initial migration, run once per environment)

| Script | Purpose | Local | Production |
|---|---|---|---|
| `import-foundation.ts` | Imports offices/staff/clients/groups/products/charges from archive. | ✅ | ✅ |
| `import-archive-loans.ts` | Imports groups, group membership, and full loan history from archive (no live calls). | ✅ | ✅ |
| `import-archive-savings.ts` | Imports savings accounts + transactions from archive. | ✅ | ✅ |
| `import-client.ts` / `import-client-documents.ts` | Per-client import + document metadata. | ✅ | ✅ |
| `import-groups.ts` | Group roster/membership import. | ✅ | ✅ |
| `import-loans.ts` / `import-loan-charges.ts` / `import-loan-documents.ts` / `import-loan-guarantors.ts` / `import-loan-notes.ts` | Loan sub-entity importers used by the archive import pipeline. | ✅ | ✅ |
| `import-savings.ts` / `import-savings-transactions.ts` | Savings importers used by the archive import pipeline. | ✅ | ✅ |

## Live incremental sync (re-runnable, hits `ilendloans.net` directly)

| Script | Purpose | Local | Production |
|---|---|---|---|
| `sync-recent.ts` | **The** tool to pull fresh iLend data since the last import and reconcile it into whichever DB `DATABASE_URL` points at (extracts foundation + loan history + savings history live, then calls `importFoundation` / `importArchiveGroupsAndLoans({ syncExistingLoans: true })` / `syncExistingSavingsAccountsFromArchive`). Requires `LEGACY_*` env vars + an existing `Organization` + `testadmin@sovlend.com` user in the target DB. | ✅ run repeatedly, most recently **2026-09-09** (archive `ilend-sync-2026-09-09T09-07-01-237Z`) | ⚠️ **first run in progress as of 2026-09-09** (via throwaway `sovlend-migration-tmp:latest` builder-stage container `sync-recent-run` on the prod host, network-joined to both `sovlend_backend` and `sovlend_egress`) — this is why production showed stale client/loan data (e.g. Sanyu Agnes / LEGACY-1074) compared to local. **Before this run, production had never had this script executed against it.** |

## One-off backfills (idempotent, fix specific data gaps after import)

| Script | Purpose | Re-run safe? | Local | Production |
|---|---|---|---|---|
| `backfill-officer-assignments.ts` | Populates `Loan.loanOfficerId` / `SavingsAccount.fieldOfficerId` from legacy Fineract staff data. | Yes | ✅ | ✅ |
| `backfill-client-group-officer.ts` | Follow-up to the above: propagates staff assignment onto `Client.assignedOfficerId` / `Group.staffId` (iLend's own client/group records have no staff field). | Yes | ✅ | ✅ |
| `fix-loan-officer-scope-to-own.ts` | Narrows loan officers promoted before "OWN" scope existed from office-wide to own-only visibility. | Yes (only touches already-promoted officers) | ✅ | ✅ |
| `promote-legacy-staff-to-accounts.ts` | Creates login accounts for legacy staff records. | Yes | ✅ | ✅ |
| `backfill-default-savings-accounts.ts` | Flags oldest ACTIVE savings account per client as `isDefault` (needed for standing-order sweep). | Yes | ✅ | ✅ |
| `ensure-standing-order-automation.ts` | Provisions standing-order sweep config per organization. | Yes | ✅ | ✅ |
| `backfill-legacy-loan-allocations.ts` | Backfills installment-level payment allocation for legacy transactions. | Yes | ✅ | ✅ |
| `backfill-legacy-transaction-attribution.ts` | Backfills `recordedBy` (savings only — loan-side is a **permanent, unbackfillable limitation**, no submitted-by field in legacy loan archive) and `settlementAccountId` (via `PAYMENT_TYPE_ALIASES`) on legacy transactions. | Yes | ✅ (loan settlement coverage 10.5%, savings 68.6%) | ❌ **never run** — loan settlement coverage only 9.1%, savings 65.5%. Confirmed gap: e.g. LEGACY-1074 txn 110847 ("Airtel Line Head Office") is unmatched on prod despite having a matching alias. **Needs to be run** (dry-run count first — touches many records on live financial data). |
| `backfill-reversed-transactions.ts` | Marks legacy `LoanTransaction` rows as reversed when Fineract's export already had `manuallyReversed: true`. | Yes | ✅ | ✅ |
| `backfill-loan-writeoffs.ts` | Two-phase: fills written-off principal/interest/fees/penalties minor amounts for pre-column WRITTEN_OFF loans; fixes outstanding-balance bug for written-off loans. | Yes | ✅ | ✅ |
| `backfill-loan-writeoff-metadata.ts` | Fills `Loan.writtenOffOn` / `writtenOffByName` from Fineract's `timeline.writeOff*` fields. | Yes | ✅ | ✅ |
| `seed-funds.ts` / `backfill-loan-funds.ts` | Seeds fund catalog, then backfills `Loan.fundId` from legacy data. | Yes | ✅ | ✅ |
| `seed-charge-definitions.ts` | Seeds standard charge catalog mirroring iLend's charge list. | Yes | ✅ | ✅ |
| `backfill-ledger-bootstrap.ts` (Track 1) | Bootstraps ownership-pool rollups + ledger entry points for migrated data that bypassed the domain-service posting flow. | Yes | ✅ | ⚠️ see below |
| `backfill-ledger-disbursements.ts` (Track 2) | Posts one aggregate DISBURSEMENT journal per historically disbursed loan. | Yes | ✅ | ✅ (referenceType `LOAN_DISBURSEMENT_BACKFILL`, 637 journals on prod) |
| `backfill-ledger-collections.ts` (Track 3) | Posts one aggregate REPAYMENT-COLLECTION journal per loan that ever received a payment (cash-basis, from `LoanInstallment.*PaidMinor`). | Yes | ✅ | ✅ (referenceType `LOAN_COLLECTION_BACKFILL`, 633 journals on prod) |
| `backfill-ledger-writeoffs.ts` (Track 4) | Posts write-off and recovery journals from `Loan.principalWrittenOffMinor`. | Yes | ✅ | ✅ (referenceTypes `LOAN_WRITE_OFF_BACKFILL` 124, `LOAN_RECOVERY_BACKFILL` 44 on prod) |
| `backfill-ledger-savings.ts` (Track 5) | Posts one journal per historical `SavingsTransaction` row (has real historical `createdAt`, unlike loans). | Yes | ✅ | ✅ (referenceType `SAVINGS_TRANSACTION_BACKFILL`, 3,627 journals on prod) |

Note: disbursement **fee** journals use a separate referenceType `LOAN_DISBURSEMENT_FEE_BACKFILL`
(549 on prod) — part of Track 2's disbursement backfill, posted alongside the principal journal
when a fee-at-disbursement was recorded.

## Known open gaps (as of 2026-09-09)

1. **Production had never run `sync-recent.ts`** until today — this is the root cause of
   production showing stale client/loan/savings data (balances, due dates, staff assignment)
   compared to local dev, which has been synced multiple times. First production run is
   in progress; re-verify flagged records (e.g. Sanyu Agnes / LEGACY-1074) once complete.
2. **`backfill-legacy-transaction-attribution.ts` has never been run against production.**
   Settlement-account coverage on prod is meaningfully behind local (loans 9.1% vs 10.5%,
   savings 65.5% vs 68.6%). Loan-side `recordedBy` is permanently unbackfillable on both
   environments (legacy archive has no submitted-by field for loan transactions).
3. **Unexplained inversion**: local dev's `savingsRecordedBy` coverage (2 rows) is far lower
   than production's (320 rows), despite local otherwise being fresher. Not yet root-caused —
   possibly local DB was reseeded/reset after an earlier backfill run that prod still retains.
4. Ledger coverage comparison between environments must always check **both** the native
   referenceTypes (`LOAN_REPAYMENT`, `LOAN_DISBURSEMENT`, `SAVINGS_TRANSACTION`, ...) used by
   live domain-service postings AND the `*_BACKFILL`-suffixed referenceTypes used by the
   Track 1-5 scripts above — querying only one set gives a false "0% journaled" result.

## Running scripts against production

Production's `web`/`worker` containers are slim Next.js standalone builds with no `src/`, no
`tsx`, and no devDependencies — migration/backfill TypeScript cannot run inside them, and the
bare host checkout at `/root/apps/sovlend` has no `node_modules`/node binaries either. Pattern
that works:

```sh
# On the production host, from the git checkout used for image builds:
docker build --target builder -t sovlend-migration-tmp:latest .

# Long-lived throwaway container with DB + internet access:
docker run -d --name migration-run \
  --network sovlend_backend \
  -v /root/apps/sovlend/.migration-data:/app/.migration-data \
  -e DATABASE_URL='postgresql://sovlend:<password>@postgres:5432/sovlend?schema=public' \
  -e LEGACY_BASE_URL='https://ilendloans.net/fineract-provider/api/v1' \
  -e LEGACY_TENANT_ID='jumpstart' \
  -e LEGACY_USERNAME='Robinah' \
  -e LEGACY_PASSWORD='<see local .env>' \
  --entrypoint sleep sovlend-migration-tmp:latest infinity
docker network connect sovlend_egress migration-run
docker exec migration-run sh -c 'touch /app/.env'   # scripts unconditionally loadEnvFile(".env")

docker exec -w /app migration-run npx tsx src/migration/<script>.ts

# Cleanup when done:
docker rm -f migration-run
```

`compose.yaml` networks: `frontend`, `egress` (internet), `backend` (`internal: true`, hosts
`postgres`/`redis`), `devhost`. Any script needing both DB + external HTTP needs both `backend`
and `egress` attached.
