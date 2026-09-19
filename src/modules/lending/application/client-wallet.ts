import type { PrismaClient } from "@prisma/client";

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
    prisma.savingsAccount.findMany({ where: { clientId }, include: { transactions: true } }),
    prisma.loan.findMany({
      where: { clientId, status: { in: [...OPEN_LOAN_STATUSES] } },
      include: {
        installments: true,
        charges: { select: { name: true, amountMinor: true, status: true, dueOn: true } },
      },
    }),
  ]);

  const currencyCode = savingsAccounts[0]?.currencyCode ?? loans[0]?.denominationCurrency ?? "UGX";

  const savingsBalanceMinor = savingsAccounts.reduce(
    (sum, account) => sum + account.transactions.reduce((accSum, transaction) => accSum + transaction.amountMinor, 0n),
    0n,
  );

  const loanOutstandingMinor = loans.reduce(
    (sum, loan) => sum + outstandingOnLoan(loan.installments, loan, loan.charges),
    0n,
  );

  return {
    currencyCode,
    savingsBalanceMinor,
    loanOutstandingMinor,
    netBalanceMinor: savingsBalanceMinor - loanOutstandingMinor,
  };
}
