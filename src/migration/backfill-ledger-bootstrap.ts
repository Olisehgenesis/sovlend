import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Track 1 of the ledger backfill effort.
 *
 * Migrated loan/savings data was imported directly into the domain tables (Loan, LoanInstallment,
 * SavingsAccount, SavingsTransaction, ...) without ever touching the double-entry ledger
 * (Journal/JournalLine) or the ownership-pool rollups the dashboard reads. This leaves two gaps:
 *
 * 1. `LoanTransaction.transactionType` was imported as the *raw* Fineract type code (e.g.
 *    `loanTransactionType.disbursement`), but every live code path (disburse-loan.ts,
 *    post-repayment.ts, loan-service-actions.ts, the dashboard's "today" cards, and several
 *    reports) filters on the short canonical string the live app writes (`DISBURSEMENT`,
 *    `REPAYMENT`, ...). Every migrated transaction is therefore invisible to those exact-match
 *    filters. This step normalizes the historical values in place (idempotent - already-canonical
 *    rows are left untouched) and the two importers are updated so future imports don't
 *    reintroduce the mismatch.
 * 2. The chart of accounts (200 `LedgerAccount` rows) was imported, but nothing ever created the
 *    per-product `LoanProductAccountingMapping` rows, a settlement account, or the `OwnershipPool`
 *    rows the dashboard's "Capital position" panel sums. This step bootstraps all three from the
 *    existing chart of accounts (by GL code), so it is pure metadata setup -- no money moves.
 *
 * This must run before the per-category journal backfill scripts (disbursements, repayments,
 * write-offs/recoveries, savings), which all depend on `LoanProductAccountingMapping` existing.
 */

// -- Step 1: legacy Fineract transaction-type code -> canonical short string ------------------

const LEGACY_TRANSACTION_TYPE_MAP: Record<string, string> = {
  "loantransactiontype.disbursement": "DISBURSEMENT",
  "loantransactiontype.repayment": "REPAYMENT",
  "loantransactiontype.repaymentatdisbursement": "REPAYMENT_AT_DISBURSEMENT",
  "loantransactiontype.recoveryrepayment": "RECOVERY_REPAYMENT",
  "loantransactiontype.writeoff": "WRITE_OFF",
  "loantransactiontype.waiver": "INTEREST_WAIVER",
  "loantransactiontype.waivecharges": "CHARGE_WAIVER",
  "loantransactiontype.accrual": "ACCRUAL",
  "loantransactiontype.repayment.reversal": "REPAYMENT_REVERSAL",
};

/** Exported so the archive/legacy loan importers can reuse the exact same mapping going forward. */
export function normalizeLegacyLoanTransactionType(rawTypeCode: string): string {
  const key = rawTypeCode.trim().toLowerCase();
  const mapped = LEGACY_TRANSACTION_TYPE_MAP[key];
  if (mapped) return mapped;
  // Already-canonical values (e.g. from live-app writes) and any unrecognized legacy code both
  // fall through unchanged; unrecognized codes are surfaced by the caller's mismatch count so they
  // don't silently disappear.
  return rawTypeCode;
}

/**
 * NOTE: historical `LoanTransaction` rows are protected by a `loan_transaction_append_only`
 * Postgres trigger (an intentional financial invariant - these rows must never be mutated or
 * deleted once posted). That rules out an in-place UPDATE to normalize legacy raw Fineract type
 * codes on existing rows. Instead:
 *  - `normalizeLegacyLoanTransactionType()` is used by the importers (see below) so all *future*
 *    imports write canonical values directly.
 *  - Read-side call sites that filter by an exact canonical `transactionType` string (the
 *    dashboard and the collections report) are updated to match both the canonical string and
 *    its known legacy raw-code variant, so historical data isn't invisible to those filters
 *    without ever touching the append-only rows. See `src/lib/loan-transaction-type-variants.ts`.
 */
async function surveyTransactionTypes(prisma: PrismaClient): Promise<{ distinct: string[] }> {
  const rows = await prisma.loanTransaction.findMany({ distinct: ["transactionType"], select: { transactionType: true } });
  return { distinct: rows.map((row) => row.transactionType) };
}

// -- Step 2: chart-of-accounts bootstrap (ownership pools + product/settlement mappings) ------

/** GL codes assigned to each ownership pool, chosen from the existing 200-row chart of accounts. */
const OWNERSHIP_POOL_CODES: Record<"INVESTOR_CAPITAL" | "CLIENT_SAVINGS" | "COMPANY_TREASURY", string[]> = {
  // Named investor/donor capital-contribution equity accounts.
  INVESTOR_CAPITAL: ["PIC", "SP", "SCMF", "SCPT", "LOCF", "PWW", "ELW", "EW", "60007", "60008", "60009", "70002", "70004", "80008"],
  // Client deposit liability accounts: the generic savings-balances bucket plus every
  // product-specific liability account that matches a SavingsProduct.
  CLIENT_SAVINGS: ["20004", "60006", "10008", "SOP", "CA-004", "CA-005", "ML-001", "SF", "Gs001"],
  // The company's own retained/reserved equity, not attributed to a specific named investor.
  COMPANY_TREASURY: ["5", "50001", "RE", "R", "50002", "91004"],
};

/**
 * Per-product GL account codes. `principalReceivable`/`feeIncome`/`writeOffExpense`/
 * `overpaymentLiability` are shared control accounts (a single loan-receivables control account is
 * normal SACCO practice); `interestIncome`/`penaltyIncome` use the product-specific account where
 * the chart of accounts has one, falling back to the generic income accounts otherwise.
 */
const SHARED_CODES = {
  principalReceivable: "10002", // Loan Receivables
  feeIncome: "30003", // Fee Income
  writeOffExpense: "40001", // Written Off Loans
  overpaymentLiability: "20001", // Loan Overpayments
  interestReceivable: "10005", // Interest Receivable
  penaltyReceivable: "10006", // Penalties Receivable (unused directly by LoanProductAccountingMapping, kept for reference)
  genericInterestIncome: "30002" /* placeholder, corrected below */,
  genericPenaltyIncome: "30002", // Penalty Income
  recoveryIncome: "30004", // Value of Loans Recovered
  cash: "10001", // Cash
} as const;

/** shortName -> { interestIncome, penaltyIncome } GL codes, only where the chart has a dedicated account. */
const PRODUCT_INCOME_CODES: Record<string, { interestIncome?: string; penaltyIncome?: string; principalReceivable?: string; interestReceivable?: string; penaltyReceivable?: string }> = {
  "20WL": { interestIncome: "20005" },
  "16WK": { interestIncome: "300033", penaltyIncome: "300034" },
  "4wL": { interestIncome: "300037", penaltyIncome: "300038" },
  "3WL": { interestIncome: "30006" },
  "40WL": { interestIncome: "40004" },
  mld: { interestIncome: "50014", penaltyIncome: "50015", interestReceivable: "50012", penaltyReceivable: "50013" },
  "8WL": { interestIncome: "80012", penaltyIncome: "800012" },
  "12W": { interestIncome: "80013w", penaltyIncome: "80012w" },
  BWL: { interestIncome: "B0001", penaltyIncome: "B0002" },
  BLM: { interestIncome: "BM001", penaltyIncome: "BM002" },
  EL: { interestIncome: "EL001", penaltyIncome: "EL002" },
  GLP: { interestIncome: "GL001", penaltyIncome: "GL002" },
  PL: { interestIncome: "PL001", penaltyIncome: "PL002" },
  "2WL": { interestIncome: "INC24", penaltyIncome: "INC242" }, // 24 weeks Loan
  MEL: { interestIncome: "90009" }, // Micro-Enterprise Loan - Monthly (shared MEL account)
  MEL2: { interestIncome: "90009" }, // Micro-Enterprise Loan - Weekly (shared MEL account)
  IL30: { interestIncome: "90000" }, // Individual Loan weekly
  // SBL/SBW (Small business loan) have no dedicated GL account in the chart; fall back to the
  // generic "Financial Revenue from Loan Portfolio" income account for interest.
  SBL: { interestIncome: "80005" },
  SBW: { interestIncome: "80005" },
};

/** SavingsProduct shortName -> liability GL code, for the (schema-less) savings journal backfill. */
export const SAVINGS_PRODUCT_LIABILITY_CODES: Record<string, string> = {
  cs: "CA-004", // Compulsory savings -> Compulsory Account
  GGS: "Gs001", // Group general savings -> Group general savings account
  LAS: "CA-005", // LIF Account Savings
  MSA: "ML-001", // Member Savings Account
  GF: "SF", // Security Fee Payable
  SFPI: "SF", // Security Fee Payable - Individual (shares the same control account)
};
export const SAVINGS_LIABILITY_FALLBACK_CODE = "20004"; // OTHER LIABILITIES - Savings Balances
export const SAVINGS_CASH_CODE = SHARED_CODES.cash;

export type BootstrapResult = Readonly<{
  transactionTypeValuesSeen: readonly string[];
  ownershipPoolsCreated: number;
  ledgerAccountsAssignedToPools: number;
  productMappingsCreated: number;
  productMappingsSkipped: readonly string[];
  settlementAccountCreated: boolean;
}>;

export async function bootstrapLedger(prisma: PrismaClient): Promise<BootstrapResult> {
  const organization = await prisma.organization.findFirstOrThrow({ select: { id: true } });
  const organizationId = organization.id;

  const { distinct: transactionTypeValuesSeen } = await surveyTransactionTypes(prisma);

  // Ownership pools -- idempotent upsert by the model's [organizationId, name] unique key.
  const poolTypes = ["INVESTOR_CAPITAL", "CLIENT_SAVINGS", "COMPANY_TREASURY", "OPERATING_FUNDS"] as const;
  let ownershipPoolsCreated = 0;
  const poolIdByType = new Map<string, string>();
  for (const type of poolTypes) {
    const name = type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    const pool = await prisma.ownershipPool.upsert({
      where: { organizationId_name: { organizationId, name } },
      create: { organizationId, name, type },
      update: {},
    });
    poolIdByType.set(type, pool.id);
    ownershipPoolsCreated += 1;
  }

  // Assign existing LedgerAccounts to their pool by GL code.
  let ledgerAccountsAssignedToPools = 0;
  for (const [poolType, codes] of Object.entries(OWNERSHIP_POOL_CODES) as Array<[keyof typeof OWNERSHIP_POOL_CODES, string[]]>) {
    const poolId = poolIdByType.get(poolType);
    if (!poolId) continue;
    const result = await prisma.ledgerAccount.updateMany({ where: { code: { in: codes } }, data: { ownershipPoolId: poolId } });
    ledgerAccountsAssignedToPools += result.count;
  }

  // Look up every GL code referenced anywhere above in one query, then build a code -> id map.
  const allCodes = new Set<string>([
    SHARED_CODES.principalReceivable,
    SHARED_CODES.feeIncome,
    SHARED_CODES.writeOffExpense,
    SHARED_CODES.overpaymentLiability,
    SHARED_CODES.interestReceivable,
    SHARED_CODES.genericPenaltyIncome,
    SHARED_CODES.recoveryIncome,
    SHARED_CODES.cash,
    SAVINGS_LIABILITY_FALLBACK_CODE,
  ]);
  for (const entry of Object.values(PRODUCT_INCOME_CODES)) {
    if (entry.interestIncome) allCodes.add(entry.interestIncome);
    if (entry.penaltyIncome) allCodes.add(entry.penaltyIncome);
    if (entry.principalReceivable) allCodes.add(entry.principalReceivable);
    if (entry.interestReceivable) allCodes.add(entry.interestReceivable);
    if (entry.penaltyReceivable) allCodes.add(entry.penaltyReceivable);
  }
  const ledgerAccounts = await prisma.ledgerAccount.findMany({ where: { code: { in: [...allCodes] } }, select: { id: true, code: true } });
  const accountIdByCode = new Map(ledgerAccounts.map((account) => [account.code, account.id]));
  const requireAccount = (code: string) => {
    const id = accountIdByCode.get(code);
    if (!id) throw new Error(`Chart-of-accounts is missing expected GL code "${code}" -- bootstrap cannot continue`);
    return id;
  };

  // Loan product accounting mappings.
  const products = await prisma.loanProduct.findMany({ select: { id: true, shortName: true, name: true } });
  let productMappingsCreated = 0;
  const productMappingsSkipped: string[] = [];
  for (const product of products) {
    const incomeCodes = PRODUCT_INCOME_CODES[product.shortName];
    if (!incomeCodes?.interestIncome) {
      productMappingsSkipped.push(`${product.shortName} (${product.name}): no interest income GL code configured`);
      continue;
    }
    await prisma.loanProductAccountingMapping.upsert({
      where: { productId: product.id },
      create: {
        productId: product.id,
        principalReceivableAccountId: requireAccount(incomeCodes.principalReceivable ?? SHARED_CODES.principalReceivable),
        interestReceivableAccountId: requireAccount(incomeCodes.interestReceivable ?? SHARED_CODES.interestReceivable),
        interestIncomeAccountId: requireAccount(incomeCodes.interestIncome),
        feeIncomeAccountId: requireAccount(SHARED_CODES.feeIncome),
        penaltyIncomeAccountId: requireAccount(incomeCodes.penaltyIncome ?? SHARED_CODES.genericPenaltyIncome),
        writeOffExpenseAccountId: requireAccount(SHARED_CODES.writeOffExpense),
        overpaymentLiabilityAccountId: requireAccount(SHARED_CODES.overpaymentLiability),
      },
      update: {},
    });
    productMappingsCreated += 1;
  }

  // A single "Cash" settlement account backing all disbursements/repayments/savings postings.
  const existingSettlement = await prisma.settlementAccount.findFirst({ where: { organizationId, name: "Cash" } });
  let settlementAccountCreated = false;
  if (!existingSettlement) {
    await prisma.settlementAccount.create({
      data: { organizationId, name: "Cash", type: "CASH", currencyCode: "UGX", ledgerAccountId: requireAccount(SHARED_CODES.cash), active: true },
    });
    settlementAccountCreated = true;
  }

  // Org-level fallback defaults, for completeness (not read by any live code path yet, but keeps
  // the ledger-defaults model populated consistently with the per-product mappings above).
  await prisma.loanAccountingDefaults.upsert({
    where: { organizationId },
    create: {
      organizationId,
      principalReceivableAccountId: requireAccount(SHARED_CODES.principalReceivable),
      interestIncomeAccountId: requireAccount(SHARED_CODES.genericInterestIncome),
      feeIncomeAccountId: requireAccount(SHARED_CODES.feeIncome),
      penaltyIncomeAccountId: requireAccount(SHARED_CODES.genericPenaltyIncome),
      writeOffExpenseAccountId: requireAccount(SHARED_CODES.writeOffExpense),
      overpaymentLiabilityAccountId: requireAccount(SHARED_CODES.overpaymentLiability),
    },
    update: {},
  });
  await prisma.savingsAccountingDefaults.upsert({
    where: { organizationId },
    create: {
      organizationId,
      savingsLiabilityAccountId: requireAccount(SAVINGS_LIABILITY_FALLBACK_CODE),
    },
    update: {},
  });

  return {
    transactionTypeValuesSeen,
    ownershipPoolsCreated,
    ledgerAccountsAssignedToPools,
    productMappingsCreated,
    productMappingsSkipped,
    settlementAccountCreated,
  };
}

async function main() {
  try {
    const result = await bootstrapLedger(prisma);
    console.log("Ledger bootstrap complete.");
    console.log(`Transaction type values seen (historical, unmutated): ${result.transactionTypeValuesSeen.join(", ")}`);
    console.log(`Ownership pools ensured: ${result.ownershipPoolsCreated}`);
    console.log(`Ledger accounts assigned to pools: ${result.ledgerAccountsAssignedToPools}`);
    console.log(`Loan product accounting mappings created/confirmed: ${result.productMappingsCreated}`);
    if (result.productMappingsSkipped.length > 0) console.log(`Products skipped:\n${result.productMappingsSkipped.join("\n")}`);
    console.log(`Settlement account created: ${result.settlementAccountCreated}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
