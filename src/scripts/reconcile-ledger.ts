/**
 * READ-ONLY ledger reconciliation / monitoring script.
 *
 * This script performs NO writes of any kind against the application database. It only ever
 * calls `prisma.<model>.findMany` / `count` (grep it yourself: there is no `.create(`,
 * `.update(`, `.delete(`, `.upsert(`, or `$executeRaw` anywhere below). It is safe to run
 * repeatedly, in CI, or on a schedule against a dev/staging replica. It is NOT wired up to
 * connect anywhere in particular -- it simply uses `DATABASE_URL` from the environment via the
 * shared `@/lib/prisma` client, so make sure that variable points at a local/dev database
 * before running it. Never point it at production.
 *
 * ## What it checks
 *
 *   1. Global double-entry balance: total DEBIT `JournalLine.amountMinor` must equal total
 *      CREDIT `JournalLine.amountMinor`, across every `Journal`/`JournalLine` row in the
 *      database (all statuses), broken down by currency.
 *   2. Per-journal balance: every individual `Journal`'s own lines must net to zero
 *      (debits == credits) *within that journal*. This should never fail -- if it does, the
 *      posting engine itself has a bug (not just a missing-entries gap).
 *   3. Ledger vs. business-level derived balances:
 *      3a. Savings liability: the ledger's view of each client-savings liability GL account
 *          (identified via chart-of-accounts codes, same convention as
 *          `src/migration/backfill-ledger-savings.ts`) vs. the sum of that account's mapped
 *          `SavingsTransaction.amountMinor` rows (the client-visible balance). If no such
 *          liability accounts exist yet in this database, that gap is reported explicitly
 *          instead of erroring out.
 *      3b. Loan principal receivable: the ledger's view of each loan product's principal
 *          receivable GL account vs. the sum of `principalOutstandingMinor` derived from
 *          `LoanInstallment` rows for loans on that product (the same helper the app itself
 *          uses for "outstanding").
 *   4. Known gap detector: flags every `SavingsAccount` that has `SavingsTransaction` rows but
 *      NO `Journal` activity referencing any of them. As of the forensic audit, savings
 *      deposits/withdrawals never post journal entries, so this is EXPECTED to show most/all
 *      savings accounts as failing -- that is the current baseline, not a bug in this script.
 *   5. Standing-order sweep leg check: for every standing-order-sweep loan repayment
 *      (`LoanTransaction.externalReference === "Standing order sweep"`), confirms both legs are
 *      present and reconcile: the mirrored `SavingsTransaction` withdrawal, and the posted,
 *      balanced `Journal` for the loan-repayment leg, whose settlement-account debit amount must
 *      equal the savings withdrawal amount. Flags orphaned/mismatched/unbalanced sweeps.
 *
 * ## How to run
 *
 *   pnpm exec tsx src/scripts/reconcile-ledger.ts
 *
 * `DATABASE_URL` (read from `.env` / `.env.local`, standard Next.js/Prisma convention) must point
 * at the database you want to inspect. Point it at a local/dev database only.
 *
 * ## How to interpret output
 *
 * Each section prints PASS/FAIL (or INFO for known/expected gaps that aren't actionable bugs in
 * the tool) with the offending rows or totals. The final "Summary" table lists every check's
 * status. The process exits with code 1 if any check that represents a genuine invariant
 * violation fails (per-journal imbalance, global imbalance, or an unmatched standing-order sweep
 * leg), so this is ready to be wired into CI or a scheduled job. The "known gap" checks (#3a's
 * savings-liability drift and #4's savings-journal coverage) are expected to show failures today
 * per the forensic audit and are reported as INFO/FAIL-but-known rather than blocking exit code
 * failures on their own -- see the `exitAffecting` flag on each check below if you want to change
 * that once the accounting-engine fixes and backfill land.
 */
import { prisma } from "@/lib/prisma";
import { principalOutstandingMinor } from "@/modules/lending/domain/loan-outstanding";
import {
  SAVINGS_LIABILITY_FALLBACK_CODE,
  SAVINGS_PRODUCT_LIABILITY_CODES,
} from "@/migration/backfill-ledger-bootstrap";

function fmt(n: bigint): string {
  const sign = n < 0n ? "-" : "";
  return sign + (n < 0n ? -n : n).toLocaleString("en-US");
}

type CheckResult = {
  name: string;
  status: "PASS" | "FAIL" | "INFO";
  exitAffecting: boolean;
  detail: string;
};

const results: CheckResult[] = [];

function record(name: string, status: "PASS" | "FAIL" | "INFO", exitAffecting: boolean, detail: string) {
  results.push({ name, status, exitAffecting, detail });
}

// --- 1. Global double-entry balance (ALL journal lines, every status, by currency) -----------

async function checkGlobalBalance() {
  console.log("\n=== 1. Global double-entry balance (all Journal/JournalLine rows, any status) ===");
  const lines = await prisma.journalLine.findMany({
    select: { direction: true, amountMinor: true, account: { select: { currencyCode: true } } },
  });

  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  for (const line of lines) {
    const key = line.account.currencyCode;
    const entry = totals.get(key) ?? { debit: 0n, credit: 0n };
    if (line.direction === "DEBIT") entry.debit += line.amountMinor;
    else entry.credit += line.amountMinor;
    totals.set(key, entry);
  }

  let anyMismatch = false;
  const lines2: string[] = [];
  for (const [currency, entry] of totals) {
    const diff = entry.debit - entry.credit;
    if (diff !== 0n) anyMismatch = true;
    lines2.push(`  ${currency}: debit=${fmt(entry.debit)} credit=${fmt(entry.credit)} diff=${fmt(diff)} [${diff === 0n ? "OK" : "MISMATCH"}]`);
  }
  if (totals.size === 0) lines2.push("  No journal lines found in this database.");
  const detail = lines2.join("\n");
  console.log(detail);
  record("1. Global debit=credit balance", anyMismatch ? "FAIL" : "PASS", true, detail);
}

// --- 2. Per-journal balance --------------------------------------------------------------------

async function checkPerJournalBalance() {
  console.log("\n=== 2. Per-journal balance (every Journal's own lines must net to zero) ===");
  const journals = await prisma.journal.findMany({
    select: {
      id: true,
      referenceType: true,
      referenceId: true,
      status: true,
      lines: { select: { direction: true, amountMinor: true, account: { select: { currencyCode: true } } } },
    },
  });

  const offenders: string[] = [];
  for (const journal of journals) {
    const totals = new Map<string, { debit: bigint; credit: bigint }>();
    for (const line of journal.lines) {
      const entry = totals.get(line.account.currencyCode) ?? { debit: 0n, credit: 0n };
      if (line.direction === "DEBIT") entry.debit += line.amountMinor;
      else entry.credit += line.amountMinor;
      totals.set(line.account.currencyCode, entry);
    }
    for (const [currency, entry] of totals) {
      if (entry.debit !== entry.credit) {
        offenders.push(
          `  Journal ${journal.id} (${journal.referenceType}/${journal.referenceId ?? "-"}, status=${journal.status}) UNBALANCED in ${currency}: debit=${fmt(entry.debit)} credit=${fmt(entry.credit)}`,
        );
      }
    }
  }
  const summary = `  Checked ${journals.length} journals; ${offenders.length} unbalanced.`;
  console.log(summary);
  for (const line of offenders) console.log(line);
  const detail = [summary, ...offenders].join("\n");
  record("2. Per-journal balance", offenders.length > 0 ? "FAIL" : "PASS", true, detail);
}

// --- 3a. Savings liability: SavingsTransaction shadow balance vs. GL ledger movement -----------

async function checkSavingsLedgerDrift() {
  console.log("\n=== 3a. Savings liability: SavingsTransaction balance vs. GL ledger movement ===");

  const liabilityCodes = new Set<string>([SAVINGS_LIABILITY_FALLBACK_CODE, ...Object.values(SAVINGS_PRODUCT_LIABILITY_CODES)]);
  const liabilityAccounts = await prisma.ledgerAccount.findMany({
    where: { code: { in: [...liabilityCodes] } },
    select: { id: true, code: true, name: true },
  });

  if (liabilityAccounts.length === 0) {
    const detail = "  No savings-liability GL accounts found in the chart of accounts (codes " + [...liabilityCodes].join(", ") + "). This is a known gap: the savings liability side of the ledger has not been set up/wired yet.";
    console.log(detail);
    record("3a. Savings liability vs. GL", "INFO", false, detail);
    return;
  }

  const accountIdByCode = new Map(liabilityAccounts.map((a) => [a.code, a.id]));
  const fallbackAccountId = accountIdByCode.get(SAVINGS_LIABILITY_FALLBACK_CODE);

  const products = await prisma.savingsProduct.findMany({ select: { id: true, shortName: true } });
  const liabilityAccountIdByProductId = new Map<string, string>();
  for (const product of products) {
    const code = SAVINGS_PRODUCT_LIABILITY_CODES[product.shortName];
    const accountId = code ? accountIdByCode.get(code) : undefined;
    if (accountId) liabilityAccountIdByProductId.set(product.id, accountId);
  }

  const accounts = await prisma.savingsAccount.findMany({
    select: { id: true, accountNumber: true, productId: true, transactions: { select: { amountMinor: true } } },
  });

  const shadowByLedgerAccountId = new Map<string, bigint>();
  let shadowUnmapped = 0n;
  for (const account of accounts) {
    const shadowBalance = account.transactions.reduce((sum, t) => sum + t.amountMinor, 0n);
    const ledgerAccountId = (account.productId ? liabilityAccountIdByProductId.get(account.productId) : undefined) ?? fallbackAccountId;
    if (!ledgerAccountId) {
      shadowUnmapped += shadowBalance;
      continue;
    }
    shadowByLedgerAccountId.set(ledgerAccountId, (shadowByLedgerAccountId.get(ledgerAccountId) ?? 0n) + shadowBalance);
  }

  const lines: string[] = [];
  let anyMismatch = false;
  let shadowTotal = 0n;
  let glTotal = 0n;
  for (const account of liabilityAccounts) {
    const shadow = shadowByLedgerAccountId.get(account.id) ?? 0n;
    const glLines = await prisma.journalLine.findMany({ where: { accountId: account.id }, select: { direction: true, amountMinor: true } });
    const gl = glLines.reduce((sum, l) => sum + (l.direction === "CREDIT" ? l.amountMinor : -l.amountMinor), 0n);
    const diff = shadow - gl;
    if (diff !== 0n) anyMismatch = true;
    shadowTotal += shadow;
    glTotal += gl;
    lines.push(`  ${account.code} (${account.name}): SavingsTransaction balance=${fmt(shadow)} GL net=${fmt(gl)} diff=${fmt(diff)} [${diff === 0n ? "OK" : "MISMATCH"}]`);
  }
  if (shadowUnmapped !== 0n) lines.push(`  (${fmt(shadowUnmapped)} minor units of savings balance across accounts on products with no mapped liability GL account -- excluded above)`);
  lines.push(`  TOTAL: SavingsTransaction balance=${fmt(shadowTotal)} GL net=${fmt(glTotal)} diff=${fmt(shadowTotal - glTotal)}`);
  console.log(lines.join("\n"));
  const detail = lines.join("\n");
  // This mismatch is the audit's documented Critical Fault #1 (live deposits/withdrawals don't
  // post journal entries) -- expected to fail today. Reported but not treated as a blocking
  // exit-code failure until the accounting-engine fix and savings backfill land; flip
  // `exitAffecting` to `true` once that's verified to hold.
  record("3a. Savings liability vs. GL", anyMismatch ? "FAIL" : "PASS", false, detail);
}

// --- 3b. Loan principal receivable: ledger vs. installment-derived outstanding -----------------

async function checkLoanReceivables() {
  console.log("\n=== 3b. Loan principal receivable: ledger vs. installment-derived outstanding ===");
  const products = await prisma.loanProduct.findMany({
    select: {
      id: true,
      name: true,
      accountingMapping: { select: { principalReceivableAccountId: true } },
      loans: {
        select: {
          principalWrittenOffMinor: true,
          status: true,
          installments: { select: { principalDueMinor: true, principalPaidMinor: true, principalWaivedMinor: true } },
        },
      },
    },
  });

  // Multiple products commonly share one control account (see LoanProductAccountingMapping
  // comments / SHARED_CODES.principalReceivable in backfill-ledger-bootstrap.ts) -- a single
  // shared account's "ledger" figure below will legitimately repeat across those products.
  // Track it by distinct account id too, so the aggregate total below isn't double-counted.
  const accountIdsSeen = new Map<string, bigint>(); // accountId -> ledgerNet, computed once
  const productCountByAccountId = new Map<string, number>();
  for (const product of products) {
    const accountId = product.accountingMapping?.principalReceivableAccountId;
    if (accountId) productCountByAccountId.set(accountId, (productCountByAccountId.get(accountId) ?? 0) + 1);
  }

  const lines: string[] = [];
  let anyMismatch = false;
  let anyUnmapped = false;
  let derivedTotal = 0n;
  for (const product of products) {
    const accountId = product.accountingMapping?.principalReceivableAccountId;
    if (!accountId) {
      anyUnmapped = true;
      lines.push(`  ${product.name}: no accounting mapping configured - skipped.`);
      continue;
    }
    const derivedOutstanding = product.loans.reduce(
      (sum, loan) => sum + principalOutstandingMinor(loan.installments, loan.principalWrittenOffMinor),
      0n,
    );
    derivedTotal += derivedOutstanding;
    let ledgerNet = accountIdsSeen.get(accountId);
    if (ledgerNet === undefined) {
      const glLines = await prisma.journalLine.findMany({ where: { accountId }, select: { direction: true, amountMinor: true } });
      ledgerNet = glLines.reduce((sum, l) => sum + (l.direction === "DEBIT" ? l.amountMinor : -l.amountMinor), 0n);
      accountIdsSeen.set(accountId, ledgerNet);
    }
    const diff = ledgerNet - derivedOutstanding;
    if (diff !== 0n) anyMismatch = true;
    const sharedNote = (productCountByAccountId.get(accountId) ?? 1) > 1 ? " (shared control account -- see note below)" : "";
    lines.push(`  ${product.name}: ledger=${fmt(ledgerNet)} derived=${fmt(derivedOutstanding)} diff=${fmt(diff)} [${diff === 0n ? "OK" : "MISMATCH"}]${sharedNote}`);
  }
  const distinctLedgerTotal = [...accountIdsSeen.values()].reduce((sum, v) => sum + v, 0n);
  lines.push(`  NOTE: several products share one principal-receivable control account by design; per-product "ledger" figures above repeat for those products.`);
  lines.push(`  TOTAL (derived outstanding, all products): ${fmt(derivedTotal)}`);
  lines.push(`  TOTAL (ledger net, distinct receivable accounts only, no double-count): ${fmt(distinctLedgerTotal)}`);
  console.log(lines.join("\n") || "  No loan products found.");
  const detail = lines.join("\n");
  record("3b. Loan receivable vs. GL", anyMismatch ? "FAIL" : anyUnmapped ? "INFO" : "PASS", false, detail);
}

// --- 4. Known gap: savings accounts with transactions but zero linked journal activity ---------

async function checkSavingsJournalCoverage() {
  console.log("\n=== 4. Savings accounts with SavingsTransaction rows but ZERO linked Journal activity ===");
  const accounts = await prisma.savingsAccount.findMany({
    where: { transactions: { some: {} } },
    select: { id: true, accountNumber: true, transactions: { select: { id: true } } },
  });

  if (accounts.length === 0) {
    const detail = "  No savings accounts with transactions found.";
    console.log(detail);
    record("4. Savings journal coverage", "INFO", false, detail);
    return;
  }

  const allTransactionIds = accounts.flatMap((a) => a.transactions.map((t) => t.id));
  const referencedJournals = await prisma.journal.findMany({
    where: { referenceId: { in: allTransactionIds } },
    select: { referenceId: true },
  });
  const referencedIds = new Set(referencedJournals.map((j) => j.referenceId));

  const uncovered = accounts.filter((a) => !a.transactions.some((t) => referencedIds.has(t.id)));
  const summary = `  ${uncovered.length} of ${accounts.length} savings accounts (with >=1 transaction) have NO Journal row referencing any of their SavingsTransaction ids.`;
  console.log(summary);
  if (uncovered.length > 0 && uncovered.length <= 20) {
    console.log(uncovered.map((a) => `    - ${a.accountNumber} (${a.transactions.length} transactions, uncovered)`).join("\n"));
  } else if (uncovered.length > 20) {
    console.log(`    (showing first 10 of ${uncovered.length}) ` + uncovered.slice(0, 10).map((a) => a.accountNumber).join(", "));
  }
  const detail = summary;
  // This is the audit's documented known baseline (Critical Fault #1) -- expected to show
  // most/all accounts uncovered today. INFO, not a blocking failure, until the fixes land.
  record("4. Savings journal coverage (known gap)", uncovered.length > 0 ? "FAIL" : "PASS", false, detail);
}

// --- 5. Standing-order sweep: both legs present, balanced, and amounts match ------------------

async function checkStandingOrderSweeps() {
  console.log("\n=== 5. Standing-order sweep: loan-repayment leg + savings-withdrawal leg reconcile ===");

  const sweeps = await prisma.loanTransaction.findMany({
    where: { externalReference: "Standing order sweep", transactionType: "REPAYMENT" },
    select: { id: true, idempotencyKey: true, settlementAmountMinor: true, settlementAccountId: true, loan: { select: { accountNumber: true } } },
  });

  if (sweeps.length === 0) {
    const detail = "  No standing-order sweep repayments found in this database.";
    console.log(detail);
    record("5. Standing-order sweep legs", "INFO", false, detail);
    return;
  }

  let missingSavingsMirror = 0;
  let missingJournal = 0;
  let unbalancedJournal = 0;
  let amountMismatch = 0;
  let ok = 0;
  const offenders: string[] = [];

  for (const sweep of sweeps) {
    const accountLabel = sweep.loan.accountNumber;
    const mirrorKey = `${sweep.idempotencyKey}:savings-mirror`;
    const mirror = await prisma.savingsTransaction.findUnique({
      where: { idempotencyKey: mirrorKey },
      select: { id: true, amountMinor: true, savingsAccount: { select: { accountNumber: true } } },
    });
    if (!mirror) {
      missingSavingsMirror += 1;
      offenders.push(`  Loan ${accountLabel}: sweep repayment ${sweep.id} has NO mirrored SavingsTransaction withdrawal (expected idempotencyKey ${mirrorKey}) - orphaned leg.`);
      continue;
    }

    const journal = await prisma.journal.findFirst({
      where: { referenceType: "LOAN_REPAYMENT", referenceId: sweep.id },
      select: { id: true, status: true, lines: { select: { accountId: true, direction: true, amountMinor: true } } },
    });
    if (!journal) {
      missingJournal += 1;
      offenders.push(`  Loan ${accountLabel}: sweep repayment ${sweep.id} has NO Journal (referenceType=LOAN_REPAYMENT) - orphaned leg, savings side thinks ${fmt(-mirror.amountMinor)} was withdrawn with nothing backing it in the GL.`);
      continue;
    }

    const debitTotal = journal.lines.filter((l) => l.direction === "DEBIT").reduce((sum, l) => sum + l.amountMinor, 0n);
    const creditTotal = journal.lines.filter((l) => l.direction === "CREDIT").reduce((sum, l) => sum + l.amountMinor, 0n);
    if (debitTotal !== creditTotal) {
      unbalancedJournal += 1;
      offenders.push(`  Loan ${accountLabel}: sweep journal ${journal.id} is UNBALANCED (debit=${fmt(debitTotal)} credit=${fmt(creditTotal)}).`);
      continue;
    }

    // JournalLine.accountId is a LedgerAccount id, not a SettlementAccount id -- resolve the
    // settlement account's underlying ledger account id before looking for its debit line.
    const settlement = sweep.settlementAccountId
      ? await prisma.settlementAccount.findUnique({ where: { id: sweep.settlementAccountId }, select: { ledgerAccountId: true } })
      : null;
    const liabilityDebitLine = settlement
      ? journal.lines.find((l) => l.accountId === settlement.ledgerAccountId && l.direction === "DEBIT")
      : undefined;
    const debitedAmount = liabilityDebitLine?.amountMinor ?? 0n;
    const withdrawnAmount = -mirror.amountMinor; // stored negative for withdrawals

    if (!liabilityDebitLine || debitedAmount !== withdrawnAmount) {
      amountMismatch += 1;
      offenders.push(
        `  Loan ${accountLabel}: sweep journal ${journal.id} debits its settlement/liability account for ${fmt(debitedAmount)} but the savings mirror withdrawal (savings account ${mirror.savingsAccount.accountNumber}) is ${fmt(withdrawnAmount)} - amounts don't match, or wrong account debited.`,
      );
      continue;
    }
    ok += 1;
  }

  const summary = `  Checked ${sweeps.length} standing-order sweep repayments: ${ok} OK, ${missingSavingsMirror} missing savings mirror, ${missingJournal} missing loan-repayment journal, ${unbalancedJournal} unbalanced journal, ${amountMismatch} amount/account mismatch.`;
  console.log(summary);
  for (const line of offenders) console.log(line);
  const detail = [summary, ...offenders].join("\n");
  const anyFail = missingSavingsMirror + missingJournal + unbalancedJournal + amountMismatch > 0;
  record("5. Standing-order sweep legs", anyFail ? "FAIL" : "PASS", true, detail);
}

// --- main ---------------------------------------------------------------------------------------

async function main() {
  await checkGlobalBalance();
  await checkPerJournalBalance();
  await checkSavingsLedgerDrift();
  await checkLoanReceivables();
  await checkSavingsJournalCoverage();
  await checkStandingOrderSweeps();

  console.log("\n=== Summary ===");
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    console.log(`  ${r.name.padEnd(width)}  ${r.status}${r.exitAffecting ? "" : "  (informational - not blocking exit code)"}`);
  }

  const blockingFailure = results.some((r) => r.status === "FAIL" && r.exitAffecting);
  console.log(`\nOverall: ${blockingFailure ? "FAIL" : "PASS"}`);
  if (blockingFailure) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
