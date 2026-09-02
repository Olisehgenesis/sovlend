import type { AccountType, OwnershipType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
export { formatMinor } from "@/modules/money/domain/format-minor";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";

const activeStatuses = ["ACTIVE", "IN_ARREARS", "OVERPAID"] as const;

export async function loadDashboard(userId: string) {
  const [user, scope] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        organizationId: true,
        organization: { select: { name: true, baseCurrency: true } },
      },
    }),
    getUserDataScope(prisma, userId),
  ]);

  if (!user?.organizationId || !user.organization || !scope) return null;

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const loanScope = {
    office: { organizationId: user.organizationId },
    ...officeWhere(scope),
  };

  const [portfolio, dueInstallments, repayments, attentionLoans, ownershipPools, btcPrice] = await Promise.all([
    prisma.loan.aggregate({
      where: { ...loanScope, status: { in: [...activeStatuses] } },
      _sum: { principalMinor: true },
      _count: true,
    }),
    prisma.loanInstallment.findMany({
      where: { dueOn: { gte: today, lt: tomorrow }, loan: loanScope },
    }),
    prisma.loanTransaction.aggregate({
      where: {
        businessDate: { gte: today, lt: tomorrow },
        transactionType: "REPAYMENT",
        loan: loanScope,
      },
      _sum: { denominationAmountMinor: true },
      _count: true,
    }),
    prisma.loan.findMany({
      where: { ...loanScope, status: { in: ["ACTIVE", "IN_ARREARS", "OVERPAID"] } },
      select: {
        id: true,
        accountNumber: true,
        status: true,
        denominationCurrency: true,
        client: { select: { firstName: true, middleName: true, lastName: true } },
        group: { select: { name: true } },
        product: { select: { name: true } },
        installments: {
          where: { dueOn: { lt: tomorrow } },
          orderBy: { dueOn: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.ownershipPool.findMany({
      where: { organizationId: user.organizationId },
      select: {
        type: true,
        accounts: {
          select: {
            type: true,
            currencyCode: true,
            lines: { select: { direction: true, amountMinor: true } },
          },
        },
      },
    }),
    prisma.priceSnapshot.findFirst({
      where: { baseCode: "BTC", quoteCode: "USD", observedAt: { gt: new Date(now.getTime() - 60 * 60 * 1_000) } },
      orderBy: { observedAt: "desc" },
      select: { price: true, status: true, observedAt: true },
    }),
  ]);

  const dueTodayMinor = dueInstallments.reduce((total, installment) => total + outstanding(installment), 0n);
  const atRiskMinor = attentionLoans
    .filter((loan) => loan.status === "IN_ARREARS")
    .flatMap((loan) => loan.installments)
    .reduce((total, installment) => total + outstanding(installment), 0n);
  const portfolioMinor = portfolio._sum.principalMinor ?? 0n;

  return {
    organizationName: user.organization.name,
    officeName: scope.officeIds ? "Assigned offices" : "All offices",
    baseCurrency: user.organization.baseCurrency,
    generatedAt: now,
    metrics: {
      portfolioMinor,
      activeLoanCount: portfolio._count,
      dueTodayMinor,
      dueTodayCount: dueInstallments.length,
      collectedTodayMinor: repayments._sum.denominationAmountMinor ?? 0n,
      repaymentCount: repayments._count,
      portfolioAtRiskBps: portfolioMinor > 0n ? Number((atRiskMinor * 10_000n) / portfolioMinor) : 0,
    },
    attentionLoans: attentionLoans
      .map((loan) => ({
        id: loan.id,
        borrower: loan.client
          ? [loan.client.firstName, loan.client.middleName, loan.client.lastName].filter(Boolean).join(" ")
          : `Group: ${loan.group?.name ?? "Unknown"}`,
        account: loan.accountNumber,
        product: loan.product.name,
        currencyCode: loan.denominationCurrency,
        dueMinor: loan.installments.reduce((total, installment) => total + outstanding(installment), 0n),
        state: loan.status,
      }))
      .filter((loan) => loan.dueMinor > 0n || loan.state === "IN_ARREARS")
      .slice(0, 8),
    ownership: summarizeOwnership(ownershipPools, user.organization.baseCurrency),
    btcPrice: btcPrice
      ? { price: btcPrice.price.toFixed(2), status: btcPrice.status, observedAt: btcPrice.observedAt }
      : null,
  };
}

function outstanding(installment: {
  principalDueMinor: bigint;
  interestDueMinor: bigint;
  feesDueMinor: bigint;
  penaltiesDueMinor: bigint;
  principalPaidMinor: bigint;
  interestPaidMinor: bigint;
  feesPaidMinor: bigint;
  penaltiesPaidMinor: bigint;
}) {
  const amount =
    installment.principalDueMinor + installment.interestDueMinor + installment.feesDueMinor + installment.penaltiesDueMinor -
    installment.principalPaidMinor - installment.interestPaidMinor - installment.feesPaidMinor - installment.penaltiesPaidMinor;
  return amount > 0n ? amount : 0n;
}

function summarizeOwnership(
  pools: Array<{
    type: OwnershipType;
    accounts: Array<{
      type: AccountType;
      currencyCode: string;
      lines: Array<{ direction: "DEBIT" | "CREDIT"; amountMinor: bigint }>;
    }>;
  }>,
  currencyCode: string,
) {
  const totals = new Map<OwnershipType, bigint>();
  for (const pool of pools) {
    for (const account of pool.accounts) {
      if (account.currencyCode !== currencyCode) continue;
      const debit = account.lines.filter((line) => line.direction === "DEBIT").reduce((sum, line) => sum + line.amountMinor, 0n);
      const credit = account.lines.filter((line) => line.direction === "CREDIT").reduce((sum, line) => sum + line.amountMinor, 0n);
      const naturalBalance = account.type === "ASSET" || account.type === "EXPENSE" ? debit - credit : credit - debit;
      totals.set(pool.type, (totals.get(pool.type) ?? 0n) + naturalBalance);
    }
  }
  return totals;
}
