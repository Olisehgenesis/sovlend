/**
 * ============================================================================================
 * ⚠️  LOCAL / DEV DATABASE ONLY. NEVER RUN THIS AGAINST THE PRODUCTION `sovlend` DATABASE. ⚠️
 * ============================================================================================
 *
 * Historical catch-up backfill for the savings-journal gap described in the forensic accounting
 * audit: `postSavingsTransaction` / `recordSavingsTransactionInTransaction`
 * (src/modules/savings/application/post-savings-transaction.ts) historically recorded a
 * `SavingsTransaction` row for every teller/API deposit and withdrawal but never posted the
 * matching double-entry `Journal`/`JournalLine` rows. The accounting-engine fix on this branch
 * (see `resolveSavingsLiabilityAccountId` in `savings-ledger.ts`) makes *new* transactions post a
 * journal correctly; this script closes the gap for transactions recorded *before* that fix
 * landed, so the GL retroactively reflects reality.
 *
 * ## Scope: which `SavingsTransaction` rows this covers
 *
 * This targets ONLY rows with `transactionType` in `("DEPOSIT", "WITHDRAWAL")` -- the exact
 * uppercase values `recordSavingsTransactionInTransaction` writes today. It deliberately does
 * NOT touch the Title-Case `"Deposit"` / `"Withdrawal"` / `"Pay Charge"` / `"Waive Charge"` rows
 * that came from the original core-banking data migration (see `import-savings-transactions.ts`)
 * -- those are a separate, already-built migration track
 * (`src/migration/backfill-ledger-savings.ts`, `pnpm run migration:backfill-ledger-savings`) with
 * its own hardcoded chart-of-accounts mapping and its own `referenceType`
 * (`SAVINGS_TRANSACTION_BACKFILL`) and idempotency-key prefix (`backfill:savings:`). Running that
 * script is a separate decision outside this script's mandate; the two scripts cannot collide
 * because they select disjoint `transactionType` values and use different `referenceType` /
 * idempotency-key prefixes.
 *
 * ## The internal-mirror-transaction question
 *
 * Some `DEPOSIT`/`WITHDRAWAL` `SavingsTransaction` rows are NOT client-facing movements at all --
 * they are mirrors that exist purely so a savings balance display reflects a movement whose real
 * double-entry accounting was (or will be) posted on the loan side. Posting an independent journal
 * for these would double-count the liability movement. Two such mirror shapes exist in the
 * codebase today (see `post-savings-transaction.ts`'s `postJournal` doc-comment):
 *
 *   1. Loan-disbursement credit / undo-disbursal mirrors (`disburse-loan.ts`,
 *      `loan-service-actions.ts`'s `executeUndoDisbursal`, idempotency keys built by
 *      `buildLoanDisbursementSavingsIdempotencyKey`, prefix `loan-disbursement:`): these call
 *      `recordSavingsTransactionInTransaction` WITHOUT a `settlementAccountId`, so
 *      `settlementAccountId` is NULL on the resulting row. A live call today would compute
 *      `shouldPostJournal = postJournal !== false && Boolean(settlement)` = false for these, since
 *      there is no settlement account to debit/credit. We reproduce that exact rule here: any
 *      candidate row with a NULL `settlementAccountId` is excluded.
 *   2. Standing-order-sweep withdrawal mirrors (`execute-standing-order-sweep.ts`): these DO carry
 *      a real `settlementAccountId` (the sweep's dedicated settlement account), but the call site
 *      explicitly passes `postJournal: false` because `postRepayment`'s own loan-repayment journal
 *      already debits that same settlement account's ledger account for the swept amount --
 *      posting a second journal here would double-post that leg. `postJournal` is a call-time flag,
 *      not a column, so it isn't visible on the historical row directly, but the mirror is
 *      deterministically identifiable by its idempotency-key SUFFIX `:savings-mirror` (built as
 *      `` `${dedupKey}:savings-mirror` `` -- exactly what the sibling monitoring script
 *      (`reconcile-ledger.ts`, check 5) uses to find it from the other direction). We exclude any
 *      candidate row whose `idempotencyKey` ends with `:savings-mirror`.
 *
 * Any row that has a non-null `settlementAccountId` AND does not match either mirror pattern is
 * treated as a genuine client-facing deposit/withdrawal that should have posted a journal and
 * didn't -- that's exactly what this script backfills. As a safety net, any row this script would
 * otherwise skip for "no settlement account" is logged individually so an unexpected new mirror
 * shape doesn't silently vanish from the report.
 *
 * ## Additive only -- never mutates existing rows
 *
 * This script only ever creates NEW `Journal` + `JournalLine` rows and reads (`.findMany` /
 * `.findUnique`). Grep it yourself: there is exactly one `.update(` call in the whole file, and it
 * targets only the `Journal` row the SAME database transaction created a few lines above it (a DB
 * trigger requires creating as PENDING, inserting lines, then flipping to POSTED -- POSTED
 * journals cannot have lines added after the fact, see the comment at that call site). There is no
 * `.delete(` or `.upsert(` anywhere, and no `.update(` ever targets a pre-existing row. No
 * `SavingsTransaction`, `AuditEvent`, or any previously-existing `Journal`/`JournalLine` row is
 * ever read-modified. Backfilled
 * journals are distinguishable from live ones via `referenceType: "SAVINGS_HISTORICAL_BACKFILL"`
 * and a narration prefixed `"[Historical backfill]"`, and use the ORIGINAL
 * `SavingsTransaction.createdAt` as the journal's `businessDate` so the entry lands in the correct
 * historical accounting period, not today.
 *
 * ## How to run
 *
 *   Dry run (default, ZERO writes):  pnpm exec tsx src/scripts/backfill-savings-journals.ts
 *   Commit (writes, LOCAL DB ONLY):  pnpm exec tsx src/scripts/backfill-savings-journals.ts --commit
 *
 * `--commit` additionally requires the environment variable
 * `I_UNDERSTAND_THIS_IS_LOCAL_ONLY=yes` to be set, as a deliberate extra guardrail against an
 * accidental production run -- the script refuses to write without it. `DATABASE_URL` is read
 * from the environment via the shared `@/lib/prisma` client, same as every other script in this
 * repo; point it at a local/dev database (e.g. the docker-compose Postgres on 127.0.0.1:5433)
 * before running with `--commit`. NEVER point it at production, with or without `--commit`.
 *
 * ## Output
 *
 * Prints a full plan: how many candidate rows were examined, how many will get a backfilled
 * journal vs. how many were excluded and why, a running total-debits-vs-total-credits check on
 * what WOULD be created (must always be zero, since each journal is balanced by construction), and
 * a per-liability-account before/after reconciliation (SavingsTransaction-derived balance vs. GL
 * net) so the gap-closing effect is visible before committing to anything.
 */
import { prisma } from "@/lib/prisma";
import { assertBalancedJournal } from "@/modules/ledger/domain/journal";
import { resolveSavingsLiabilityAccountId } from "@/modules/savings/application/savings-ledger";

const BACKFILL_REFERENCE_TYPE = "SAVINGS_HISTORICAL_BACKFILL";
const BACKFILL_IDEMPOTENCY_PREFIX = "backfill:savings-historical:";
const ELIGIBLE_TRANSACTION_TYPES = ["DEPOSIT", "WITHDRAWAL"] as const;

function fmt(n: bigint): string {
  const sign = n < 0n ? "-" : "";
  return sign + (n < 0n ? -n : n).toLocaleString("en-US");
}

type CandidateTransaction = {
  id: string;
  savingsAccountId: string;
  transactionType: string;
  amountMinor: bigint;
  settlementAccountId: string | null;
  idempotencyKey: string;
  createdAt: Date;
  savingsAccount: {
    accountNumber: string;
    currencyCode: string;
    productId: string | null;
    client: { organizationId: string; officeId: string } | null;
    group: { organizationId: string; officeId: string } | null;
    product: { shortName: string } | null;
  };
  settlementAccount: { name: string; ledgerAccountId: string } | null;
};

type PlannedJournal = {
  transactionId: string;
  accountNumber: string;
  transactionType: "DEPOSIT" | "WITHDRAWAL";
  businessDate: Date;
  officeId: string;
  currencyCode: string;
  idempotencyKey: string;
  narration: string;
  savingsLiabilityAccountId: string;
  lines: { accountId: string; direction: "DEBIT" | "CREDIT"; amountMinor: bigint; memo: string }[];
};

type SkipReason =
  | "already-has-journal"
  | "mirror-standing-order-sweep"
  | "mirror-no-settlement-account"
  | "missing-office-or-org"
  | "liability-account-unresolved"
  | "zero-amount";

async function main() {
  const commit = process.argv.includes("--commit");

  console.log("=== Savings historical journal backfill ===");
  console.log(commit ? "MODE: --commit (WILL WRITE)" : "MODE: dry-run (no writes)");
  console.log(
    "Safety reminder: this must only ever be run against a local/dev database. Never production.\n",
  );

  if (commit && process.env.I_UNDERSTAND_THIS_IS_LOCAL_ONLY !== "yes") {
    console.error(
      "Refusing to commit: set I_UNDERSTAND_THIS_IS_LOCAL_ONLY=yes to confirm this DATABASE_URL " +
        "points at a local/dev database, not production. Aborting without writing anything.",
    );
    process.exitCode = 1;
    return;
  }

  const candidates = (await prisma.savingsTransaction.findMany({
    where: { transactionType: { in: [...ELIGIBLE_TRANSACTION_TYPES] } },
    select: {
      id: true,
      savingsAccountId: true,
      transactionType: true,
      amountMinor: true,
      settlementAccountId: true,
      idempotencyKey: true,
      createdAt: true,
      savingsAccount: {
        select: {
          accountNumber: true,
          currencyCode: true,
          productId: true,
          client: { select: { organizationId: true, officeId: true } },
          group: { select: { organizationId: true, officeId: true } },
          product: { select: { shortName: true } },
        },
      },
      settlementAccount: { select: { name: true, ledgerAccountId: true } },
    },
    orderBy: { createdAt: "asc" },
  })) as CandidateTransaction[];

  console.log(`Examined ${candidates.length} SavingsTransaction rows with transactionType in (${ELIGIBLE_TRANSACTION_TYPES.join(", ")}).`);

  // Batch-fetch which of these already have ANY Journal referencing them (any referenceType --
  // being conservative so we never double-post even if some other process already covered one).
  const existingJournals = await prisma.journal.findMany({
    where: { referenceId: { in: candidates.map((c) => c.id) } },
    select: { referenceId: true },
  });
  const alreadyCoveredIds = new Set(existingJournals.map((j) => j.referenceId));

  const skipCounts: Record<SkipReason, number> = {
    "already-has-journal": 0,
    "mirror-standing-order-sweep": 0,
    "mirror-no-settlement-account": 0,
    "missing-office-or-org": 0,
    "liability-account-unresolved": 0,
    "zero-amount": 0,
  };
  const unexpectedNoSettlementRows: string[] = [];
  const unresolvedLiabilityErrors: string[] = [];
  const planned: PlannedJournal[] = [];

  for (const txn of candidates) {
    if (alreadyCoveredIds.has(txn.id)) {
      skipCounts["already-has-journal"] += 1;
      continue;
    }

    // Mirror shape 1: standing-order-sweep withdrawal mirror. Identifiable by idempotency-key
    // suffix regardless of settlement account (see header comment).
    if (txn.idempotencyKey.endsWith(":savings-mirror")) {
      skipCounts["mirror-standing-order-sweep"] += 1;
      continue;
    }

    // Mirror shape 2: loan-disbursement credit / undo-disbursal mirror. These never carry a
    // settlement account, matching exactly what live code's `Boolean(settlement)` check would do.
    if (!txn.settlementAccountId || !txn.settlementAccount) {
      skipCounts["mirror-no-settlement-account"] += 1;
      if (!txn.idempotencyKey.startsWith("loan-disbursement:")) {
        // Anomaly: a row with no settlement account that isn't a known mirror pattern. Flag it
        // for manual review rather than silently dropping it.
        unexpectedNoSettlementRows.push(
          `  ${txn.savingsAccount.accountNumber} / ${txn.id} (idempotencyKey=${txn.idempotencyKey}, type=${txn.transactionType}) -- no settlement account but does not match the known loan-disbursement mirror prefix.`,
        );
      }
      continue;
    }

    const amount = txn.amountMinor < 0n ? -txn.amountMinor : txn.amountMinor;
    if (amount === 0n) {
      skipCounts["zero-amount"] += 1;
      continue;
    }

    const organizationId = txn.savingsAccount.client?.organizationId ?? txn.savingsAccount.group?.organizationId;
    const officeId = txn.savingsAccount.client?.officeId ?? txn.savingsAccount.group?.officeId;
    if (!organizationId || !officeId) {
      skipCounts["missing-office-or-org"] += 1;
      continue;
    }

    let savingsLiabilityAccountId: string;
    try {
      // Reuse the EXACT resolution logic live transactions use today, so a backfilled entry
      // lands on the identical account a new transaction for this same account would use.
      savingsLiabilityAccountId = await resolveSavingsLiabilityAccountId(prisma, {
        organizationId,
        savingsProductId: txn.savingsAccount.productId,
        savingsProductShortName: txn.savingsAccount.product?.shortName ?? null,
      });
    } catch (error) {
      skipCounts["liability-account-unresolved"] += 1;
      unresolvedLiabilityErrors.push(
        `  ${txn.savingsAccount.accountNumber} / ${txn.id}: ${error instanceof Error ? error.message : error}`,
      );
      continue;
    }

    const transactionType = txn.transactionType as "DEPOSIT" | "WITHDRAWAL";
    const lines =
      transactionType === "DEPOSIT"
        ? [
            { accountId: txn.settlementAccount.ledgerAccountId, direction: "DEBIT" as const, amountMinor: amount, memo: txn.settlementAccount.name },
            { accountId: savingsLiabilityAccountId, direction: "CREDIT" as const, amountMinor: amount, memo: txn.savingsAccount.accountNumber },
          ]
        : [
            { accountId: savingsLiabilityAccountId, direction: "DEBIT" as const, amountMinor: amount, memo: txn.savingsAccount.accountNumber },
            { accountId: txn.settlementAccount.ledgerAccountId, direction: "CREDIT" as const, amountMinor: amount, memo: txn.settlementAccount.name },
          ];
    assertBalancedJournal(lines.map((line) => ({ ...line, currencyCode: txn.savingsAccount.currencyCode })));

    planned.push({
      transactionId: txn.id,
      accountNumber: txn.savingsAccount.accountNumber,
      transactionType,
      businessDate: txn.createdAt,
      officeId,
      currencyCode: txn.savingsAccount.currencyCode,
      idempotencyKey: `${BACKFILL_IDEMPOTENCY_PREFIX}${txn.idempotencyKey}`,
      narration: `[Historical backfill] ${transactionType === "DEPOSIT" ? "Deposit" : "Withdrawal"} ${txn.savingsAccount.accountNumber}`,
      savingsLiabilityAccountId,
      lines,
    });
  }

  console.log("\n=== Plan ===");
  console.log(`  Would create:                    ${planned.length} journals`);
  console.log(`  Already has a Journal (skipped):  ${skipCounts["already-has-journal"]}`);
  console.log(`  Standing-order-sweep mirror:      ${skipCounts["mirror-standing-order-sweep"]}`);
  console.log(`  Loan-disbursement mirror:         ${skipCounts["mirror-no-settlement-account"]}`);
  console.log(`  Missing office/organization:      ${skipCounts["missing-office-or-org"]}`);
  console.log(`  Liability account unresolved:     ${skipCounts["liability-account-unresolved"]}`);
  console.log(`  Zero amount:                      ${skipCounts["zero-amount"]}`);

  if (unexpectedNoSettlementRows.length > 0) {
    console.log("\n  ⚠ Unexpected no-settlement-account rows not matching the known mirror pattern (review these manually):");
    console.log(unexpectedNoSettlementRows.join("\n"));
  }
  if (unresolvedLiabilityErrors.length > 0) {
    console.log("\n  ⚠ Liability account resolution failures:");
    console.log(unresolvedLiabilityErrors.join("\n"));
  }

  // Running total-debits-vs-total-credits check on what WOULD be created.
  let plannedDebit = 0n;
  let plannedCredit = 0n;
  const byLiabilityAccount = new Map<string, { deposits: bigint; withdrawals: bigint; count: number }>();
  for (const journal of planned) {
    for (const line of journal.lines) {
      if (line.direction === "DEBIT") plannedDebit += line.amountMinor;
      else plannedCredit += line.amountMinor;
    }
    const entry = byLiabilityAccount.get(journal.savingsLiabilityAccountId) ?? { deposits: 0n, withdrawals: 0n, count: 0 };
    const amount = journal.lines.find((l) => l.accountId === journal.savingsLiabilityAccountId)!.amountMinor;
    if (journal.transactionType === "DEPOSIT") entry.deposits += amount;
    else entry.withdrawals += amount;
    entry.count += 1;
    byLiabilityAccount.set(journal.savingsLiabilityAccountId, entry);
  }

  console.log("\n=== Planned journal balance check ===");
  console.log(`  Total planned DEBIT:  ${fmt(plannedDebit)}`);
  console.log(`  Total planned CREDIT: ${fmt(plannedCredit)}`);
  console.log(`  Diff (must be 0):     ${fmt(plannedDebit - plannedCredit)}`);

  if (byLiabilityAccount.size > 0) {
    console.log("\n=== Planned entries by savings-liability GL account ===");
    const accounts = await prisma.ledgerAccount.findMany({
      where: { id: { in: [...byLiabilityAccount.keys()] } },
      select: { id: true, code: true, name: true },
    });
    const accountLabel = new Map(accounts.map((a) => [a.id, `${a.code} (${a.name})`]));
    for (const [accountId, entry] of byLiabilityAccount) {
      console.log(
        `  ${accountLabel.get(accountId) ?? accountId}: ${entry.count} journals, deposits=${fmt(entry.deposits)}, withdrawals=${fmt(entry.withdrawals)}, net credit=${fmt(entry.deposits - entry.withdrawals)}`,
      );
    }
  }

  await printReconciliation("BEFORE", [...byLiabilityAccount.keys()]);

  if (!commit) {
    console.log("\nDry run only -- no rows were written. Re-run with --commit (and I_UNDERSTAND_THIS_IS_LOCAL_ONLY=yes) on a LOCAL database to apply.");
    return;
  }

  if (planned.length === 0) {
    console.log("\nNothing to commit.");
    return;
  }

  console.log(`\nCommitting ${planned.length} backfilled journals...`);
  let createdCount = 0;
  let alreadyExistedCount = 0;
  for (const journal of planned) {
    try {
      const wasCreated = await prisma.$transaction(async (tx) => {
        const existing = await tx.journal.findUnique({ where: { idempotencyKey: journal.idempotencyKey } });
        if (existing) return false; // idempotent re-run safety
        // Must create as PENDING and insert lines BEFORE flipping to POSTED: a DB trigger from
        // migration `20260901190000_immutable_financial_records` rejects JournalLine inserts
        // against an already-POSTED Journal ("Lines of a posted journal cannot be changed"), the
        // same reason `recordSavingsTransactionInTransaction` and `backfillSavingsJournals` both
        // use this exact create -> createMany -> update(POSTED) sequence. The one `.update()` call
        // below only ever targets the Journal row this same transaction just created a moment
        // earlier -- it never touches a pre-existing row, so it doesn't violate "never touch
        // existing rows" (see header comment).
        const journalRow = await tx.journal.create({
          data: {
            officeId: journal.officeId,
            businessDate: journal.businessDate,
            referenceType: BACKFILL_REFERENCE_TYPE,
            referenceId: journal.transactionId,
            narration: journal.narration,
            idempotencyKey: journal.idempotencyKey,
          },
        });
        await tx.journalLine.createMany({
          data: journal.lines.map((line) => ({ journalId: journalRow.id, ...line })),
        });
        await tx.journal.update({ where: { id: journalRow.id }, data: { status: "POSTED", postedAt: new Date() } });
        return true;
      });
      if (wasCreated) createdCount += 1;
      else alreadyExistedCount += 1;
    } catch (error) {
      console.error(`  Failed for ${journal.accountNumber} / ${journal.transactionId}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`Created ${createdCount} of ${planned.length} planned journals (${alreadyExistedCount} already existed, idempotent no-op).`);

  await printReconciliation("AFTER", [...byLiabilityAccount.keys()]);
}

/**
 * Prints, per affected savings-liability GL account, the SavingsTransaction-derived balance
 * (client-visible truth) vs. the GL's own net movement on that account -- the same comparison
 * `reconcile-ledger.ts` check 3a makes. Read-only; safe to call before or after a commit.
 */
async function printReconciliation(label: "BEFORE" | "AFTER", liabilityAccountIds: string[]) {
  console.log(`\n=== Reconciliation (${label}) ===`);
  if (liabilityAccountIds.length === 0) {
    console.log("  No affected liability accounts to reconcile (nothing planned).");
    return;
  }

  const accounts = await prisma.ledgerAccount.findMany({
    where: { id: { in: liabilityAccountIds } },
    select: { id: true, code: true, name: true },
  });

  // Map every savings account onto the liability account it resolves to today, so the shadow
  // balance is computed the same way the live resolution logic would group it.
  const savingsAccounts = await prisma.savingsAccount.findMany({
    select: {
      id: true,
      productId: true,
      client: { select: { organizationId: true } },
      group: { select: { organizationId: true } },
      product: { select: { shortName: true } },
      transactions: { select: { amountMinor: true } },
    },
  });

  const shadowByAccountId = new Map<string, bigint>();
  for (const sa of savingsAccounts) {
    const organizationId = sa.client?.organizationId ?? sa.group?.organizationId;
    if (!organizationId) continue;
    let liabilityAccountId: string;
    try {
      liabilityAccountId = await resolveSavingsLiabilityAccountId(prisma, {
        organizationId,
        savingsProductId: sa.productId,
        savingsProductShortName: sa.product?.shortName ?? null,
      });
    } catch {
      continue;
    }
    if (!liabilityAccountIds.includes(liabilityAccountId)) continue;
    const balance = sa.transactions.reduce((sum, t) => sum + t.amountMinor, 0n);
    shadowByAccountId.set(liabilityAccountId, (shadowByAccountId.get(liabilityAccountId) ?? 0n) + balance);
  }

  let shadowTotal = 0n;
  let glTotal = 0n;
  for (const account of accounts) {
    const shadow = shadowByAccountId.get(account.id) ?? 0n;
    const glLines = await prisma.journalLine.findMany({ where: { accountId: account.id }, select: { direction: true, amountMinor: true } });
    const gl = glLines.reduce((sum, l) => sum + (l.direction === "CREDIT" ? l.amountMinor : -l.amountMinor), 0n);
    const diff = shadow - gl;
    shadowTotal += shadow;
    glTotal += gl;
    console.log(`  ${account.code} (${account.name}): SavingsTransaction balance=${fmt(shadow)} GL net=${fmt(gl)} diff=${fmt(diff)} [${diff === 0n ? "OK" : "GAP"}]`);
  }
  console.log(`  TOTAL: SavingsTransaction balance=${fmt(shadowTotal)} GL net=${fmt(glTotal)} diff=${fmt(shadowTotal - glTotal)}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
