import type { Prisma } from "@prisma/client";

// Legacy hardcoded chart-of-accounts lookup, kept as the final fallback for organizations that
// have not yet configured a SavingsProductAccountingMapping / SavingsAccountingDefaults row (see
// below). This is the same table backfill-ledger-bootstrap.ts / backfill-ledger-savings.ts use
// for the historical backfill, so live postings and the historical backfill stay consistent for
// unconfigured organizations.
const SAVINGS_PRODUCT_LIABILITY_CODES: Record<string, string> = {
  cs: "CA-004",
  GGS: "Gs001",
  LAS: "CA-005",
  MSA: "ML-001",
  GF: "SF",
  SFPI: "SF",
};

const SAVINGS_LIABILITY_FALLBACK_CODE = "20004";

export type SavingsLiabilityAccountLookup = Readonly<{
  organizationId: string;
  savingsProductId?: string | null;
  savingsProductShortName?: string | null;
}>;

/**
 * Resolves the "Client Savings Liability" ledger account credited on deposit / debited on
 * withdrawal, in priority order:
 *  1. A per-product override (SavingsProductAccountingMapping), the configurable equivalent of
 *     LoanProductAccountingMapping.
 *  2. The organization-wide default (SavingsAccountingDefaults), the configurable equivalent of
 *     LoanAccountingDefaults.
 *  3. The legacy hardcoded GL-code table above, so organizations that have not configured either
 *     model yet keep exactly today's behavior.
 * Accepts either the new object form or (for backward compatibility with existing call sites) a
 * bare product short name.
 */
export async function resolveSavingsLiabilityAccountId(
  transaction: Prisma.TransactionClient,
  lookup: SavingsLiabilityAccountLookup | string | null | undefined,
) {
  const params: SavingsLiabilityAccountLookup =
    typeof lookup === "string" || lookup == null
      ? { organizationId: "", savingsProductShortName: lookup }
      : lookup;

  if (params.savingsProductId) {
    const productMapping = await transaction.savingsProductAccountingMapping.findUnique({
      where: { productId: params.savingsProductId },
      select: { savingsLiabilityAccountId: true },
    });
    if (productMapping) return productMapping.savingsLiabilityAccountId;
  }

  if (params.organizationId) {
    const orgDefaults = await transaction.savingsAccountingDefaults.findUnique({
      where: { organizationId: params.organizationId },
      select: { savingsLiabilityAccountId: true },
    });
    if (orgDefaults?.savingsLiabilityAccountId) return orgDefaults.savingsLiabilityAccountId;
  }

  const productCode = params.savingsProductShortName
    ? SAVINGS_PRODUCT_LIABILITY_CODES[params.savingsProductShortName]
    : undefined;
  if (productCode) {
    const productAccount = await transaction.ledgerAccount.findFirst({
      where: { code: productCode },
      select: { id: true },
    });
    if (productAccount) return productAccount.id;
  }

  const fallback = await transaction.ledgerAccount.findFirst({
    where: { code: SAVINGS_LIABILITY_FALLBACK_CODE },
    select: { id: true },
  });
  if (!fallback) {
    throw new Error("Savings liability account is not configured");
  }
  return fallback.id;
}

export function buildLoanDisbursementSavingsIdempotencyKey(
  loanTransactionId: string,
  suffix: "credit" | "undo",
) {
  return `loan-disbursement:${loanTransactionId}:savings-${suffix}`;
}
