import type { Prisma } from "@prisma/client";

const SAVINGS_PRODUCT_LIABILITY_CODES: Record<string, string> = {
  cs: "CA-004",
  GGS: "Gs001",
  LAS: "CA-005",
  MSA: "ML-001",
  GF: "SF",
  SFPI: "SF",
};

const SAVINGS_LIABILITY_FALLBACK_CODE = "20004";

export async function resolveSavingsLiabilityAccountId(
  transaction: Prisma.TransactionClient,
  savingsProductShortName: string | null | undefined,
) {
  const productCode = savingsProductShortName
    ? SAVINGS_PRODUCT_LIABILITY_CODES[savingsProductShortName]
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
