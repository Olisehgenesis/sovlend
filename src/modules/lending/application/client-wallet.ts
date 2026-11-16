import type { PrismaClient } from "@prisma/client";

import { loadFoldedLoanCharges } from "@/modules/reports/domain/portfolio-charges";
import { sumSavingsByAccount } from "@/modules/savings/domain/account-balance";

import { loanOutstandingMinor as outstandingOnLoan } from "../domain/loan-outstanding";

// A client's wallet is two sub-accounts: savings (asset the client holds) and loans
// (asset the company holds, liability for the client). Net balance = savings - loans owed.
// Disbursing a loan credits the loan sub-account (increases what the client owes) without
// touching savings; a repayment debits the loan sub-account and, if paid from the wallet,
// debits savings by the same amount.
export type ClientWalletSummary = Readonly<{
  currencyCode: string;
  savingsBalanceMinor: bigint;
  loanOutstandingMinor: bigint;
  netBalanceMinor: bigint;
}>;

export const OPEN_LOAN_STATUSES = ["ACTIVE", "IN_ARREARS", "OVERPAID"] as const;

export async function getClientWalletSummary(prisma: PrismaClient, clientId: string): Promise<ClientWalletSummary> {
  const [savingsAccounts, loans] = await Promise.all([
    prisma.savingsAccount.findMany({ where: { clientId }, select: { id: true, currencyCode: true } }),
    prisma.loan.findMany({
      where: { clientId, status: { in: [...OPEN_LOAN_STATUSES] } },
      include: { installments: true },
    }),
  ]);
  const [savingsBalances, foldedCharges] = await Promise.all([
    sumSavingsByAccount(prisma, savingsAccounts.map((account) => account.id)),
    loadFoldedLoanCharges(prisma, loans),
  ]);

  const currencyCode = savingsAccounts[0]?.currencyCode ?? loans[0]?.denominationCurrency ?? "UGX";

  const savingsBalanceMinor = savingsAccounts.reduce(
    (sum, account) => sum + (savingsBalances.get(account.id) ?? 0n),
    0n,
  );

  const loanOutstandingMinor = loans.reduce(
    (sum, loan) => sum + outstandingOnLoan(loan.installments, loan, foldedCharges.get(loan.id) ?? []),
    0n,
  );

  return {
    currencyCode,
    savingsBalanceMinor,
    loanOutstandingMinor,
    netBalanceMinor: savingsBalanceMinor - loanOutstandingMinor,
  };
}
