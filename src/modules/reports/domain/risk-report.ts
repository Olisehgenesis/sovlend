import type { LoanStatus, PrismaClient } from "@prisma/client";

import { officeWhere, type UserDataScope } from "@/modules/identity/application/data-scope";

export type RiskFilters = Readonly<{
  officeId?: string;
  loanOfficerId?: string;
}>;

export type RiskFilterOption = Readonly<{ id: string; name: string }>;
export type RiskFilterOptions = Readonly<{
  offices: RiskFilterOption[];
  loanOfficers: RiskFilterOption[];
}>;

export type AgingBucketKey = "CURRENT" | "1_30" | "31_60" | "61_90" | "90_PLUS";
export type VintageBucketKey = AgingBucketKey | "WRITTEN_OFF";

export const agingBucketOrder: AgingBucketKey[] = ["CURRENT", "1_30", "31_60", "61_90", "90_PLUS"];
export const vintageBucketOrder: VintageBucketKey[] = [...agingBucketOrder, "WRITTEN_OFF"];

export const agingBucketLabels: Record<AgingBucketKey, string> = {
  CURRENT: "Current",
  "1_30": "1-30 days",
  "31_60": "31-60 days",
  "61_90": "61-90 days",
  "90_PLUS": "90+ days",
};

export const vintageBucketLabels: Record<VintageBucketKey, string> = {
  ...agingBucketLabels,
  WRITTEN_OFF: "Written-off",
};

// Assumed provisioning ladder for portfolio reporting: Current 0%, 1-30 10%, 31-60 25%,
// 61-90 50%, 90+ 100%. This mirrors a common MFI / Uganda-style prudential policy.
export const provisioningRates: Record<AgingBucketKey, number> = {
  CURRENT: 0,
  "1_30": 10,
  "31_60": 25,
  "61_90": 50,
  "90_PLUS": 100,
};

const openRiskStatuses: LoanStatus[] = ["ACTIVE", "IN_ARREARS"];
const cohortStatuses: LoanStatus[] = ["ACTIVE", "IN_ARREARS", "OVERPAID", "WRITTEN_OFF", "CLOSED"];
const writeOffTransactionTypes = new Set(["WRITE_OFF", "loanTransactionType.writeOff"]);

type InstallmentSnapshot = {
  dueOn: Date;
  principalDueMinor: bigint;
  interestDueMinor: bigint;
  feesDueMinor: bigint;
  penaltiesDueMinor: bigint;
  principalPaidMinor: bigint;
  interestPaidMinor: bigint;
  feesPaidMinor: bigint;
  penaltiesPaidMinor: bigint;
  principalWaivedMinor: bigint;
  interestWaivedMinor: bigint;
  feesWaivedMinor: bigint;
  penaltiesWaivedMinor: bigint;
};

type PortfolioLoanSnapshot = {
  id: string;
  accountNumber: string;
  status: LoanStatus;
  principalMinor: bigint;
  denominationCurrency: string;
  officeId: string;
  officeName: string;
  loanOfficerId: string | null;
  loanOfficerName: string;
  borrowerName: string;
  productName: string;
  disbursedOn: Date | null;
  maturesOn: Date | null;
  outstandingPrincipalMinor: bigint;
  outstandingTotalMinor: bigint;
  daysOverdue: number;
  overdueSince: Date | null;
  agingBucket: AgingBucketKey;
};

export type AgingReport = Awaited<ReturnType<typeof loadAgingReport>>;
export type NonPerformingLoansReport = Awaited<ReturnType<typeof loadNonPerformingLoansReport>>;
export type ProvisioningReport = Awaited<ReturnType<typeof loadProvisioningReport>>;
export type RecoveriesReport = Awaited<ReturnType<typeof loadRecoveriesReport>>;
export type ParRollRateReport = Awaited<ReturnType<typeof loadParRollRateReport>>;

export function parseRiskFilters(input: { officeId?: string | string[]; loanOfficerId?: string | string[] }): RiskFilters {
  const officeId = asOptionalString(input.officeId);
  const loanOfficerId = asOptionalString(input.loanOfficerId);
  return {
    ...(officeId ? { officeId } : {}),
    ...(loanOfficerId ? { loanOfficerId } : {}),
  };
}

export function parseBoundedInteger(
  value: string | string[] | undefined,
  defaultValue: number,
  options: { min: number; max: number },
) {
  const parsed = Number.parseInt(asOptionalString(value) ?? "", 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(options.max, Math.max(options.min, parsed));
}

export async function loadRiskFilterOptions(prisma: PrismaClient, scope: UserDataScope): Promise<RiskFilterOptions> {
  const scopedWhere = officeWhere(scope);
  const [offices, loanOfficers] = await Promise.all([
    prisma.office.findMany({
      where: {
        organizationId: scope.organizationId,
        ...scopedWhere,
        loans: { some: {} },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: {
        organizationId: scope.organizationId,
        assignedLoans: {
          some: {
            office: { organizationId: scope.organizationId },
            ...scopedWhere,
          },
        },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return { offices, loanOfficers };
}

export async function loadAgingReport(prisma: PrismaClient, scope: UserDataScope, filters: RiskFilters, now = new Date()) {
  const today = startOfUtcDay(now);
  const loans = (await loadPortfolioLoans(prisma, scope, filters, { statuses: openRiskStatuses }, today)).filter(
    (loan) => loan.outstandingPrincipalMinor > 0n,
  );
  const totalOutstandingPrincipalMinor = sumBigInt(loans.map((loan) => loan.outstandingPrincipalMinor));
  const overdueOutstandingPrincipalMinor = sumBigInt(
    loans.filter((loan) => loan.daysOverdue > 0).map((loan) => loan.outstandingPrincipalMinor),
  );

  const buckets = agingBucketOrder.map((bucket) => {
    const bucketLoans = loans.filter((loan) => loan.agingBucket === bucket);
    const outstandingPrincipalMinor = sumBigInt(bucketLoans.map((loan) => loan.outstandingPrincipalMinor));
    const cumulativeOutstandingPrincipalMinor =
      bucket === "CURRENT"
        ? 0n
        : sumBigInt(
            loans
              .filter((loan) => loan.agingBucket !== "CURRENT" && bucketSeverity(loan.agingBucket) >= bucketSeverity(bucket))
              .map((loan) => loan.outstandingPrincipalMinor),
          );
    return {
      key: bucket,
      label: agingBucketLabels[bucket],
      loanCount: bucketLoans.length,
      outstandingPrincipalMinor,
      bucketParBps: bucket === "CURRENT" ? 0 : ratioBps(outstandingPrincipalMinor, totalOutstandingPrincipalMinor),
      cumulativeParBps: bucket === "CURRENT" ? 0 : ratioBps(cumulativeOutstandingPrincipalMinor, totalOutstandingPrincipalMinor),
    };
  });

  return {
    generatedAt: now,
    filters,
    totals: {
      loanCount: loans.length,
      overdueLoanCount: loans.filter((loan) => loan.daysOverdue > 0).length,
      totalOutstandingPrincipalMinor,
      overdueOutstandingPrincipalMinor,
      overallParBps: ratioBps(overdueOutstandingPrincipalMinor, totalOutstandingPrincipalMinor),
    },
    buckets,
    loans: loans
      .map((loan) => ({
        id: loan.id,
        accountNumber: loan.accountNumber,
        borrowerName: loan.borrowerName,
        officeName: loan.officeName,
        loanOfficerName: loan.loanOfficerName,
        productName: loan.productName,
        status: loan.status,
        currencyCode: loan.denominationCurrency,
        outstandingPrincipalMinor: loan.outstandingPrincipalMinor,
        outstandingTotalMinor: loan.outstandingTotalMinor,
        daysOverdue: loan.daysOverdue,
        overdueSince: loan.overdueSince,
        agingBucket: loan.agingBucket,
      }))
      .sort(compareRiskLoans),
  };
}

export async function loadNonPerformingLoansReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  filters: RiskFilters,
  thresholdDays = 90,
  now = new Date(),
) {
  const today = startOfUtcDay(now);
  const portfolioLoans = (await loadPortfolioLoans(prisma, scope, filters, { statuses: openRiskStatuses }, today)).filter(
    (loan) => loan.outstandingPrincipalMinor > 0n,
  );
  const loans = portfolioLoans
    .filter((loan) => loan.daysOverdue > thresholdDays || (loan.status === "IN_ARREARS" && loan.outstandingPrincipalMinor > 0n))
    .map((loan) => ({
      id: loan.id,
      accountNumber: loan.accountNumber,
      borrowerName: loan.borrowerName,
      officeName: loan.officeName,
      loanOfficerName: loan.loanOfficerName,
      productName: loan.productName,
      status: loan.status,
      currencyCode: loan.denominationCurrency,
      outstandingPrincipalMinor: loan.outstandingPrincipalMinor,
      outstandingTotalMinor: loan.outstandingTotalMinor,
      daysOverdue: loan.daysOverdue,
      overdueSince: loan.overdueSince,
      agingBucket: loan.agingBucket,
    }))
    .sort(compareRiskLoans);
  const totalOutstandingPrincipalMinor = sumBigInt(loans.map((loan) => loan.outstandingPrincipalMinor));

  return {
    generatedAt: now,
    filters,
    thresholdDays,
    totals: {
      loanCount: loans.length,
      totalOutstandingPrincipalMinor,
      shareOfOpenPortfolioBps: ratioBps(
        totalOutstandingPrincipalMinor,
        sumBigInt(portfolioLoans.map((loan) => loan.outstandingPrincipalMinor)),
      ),
    },
    loans,
  };
}

export async function loadProvisioningReport(prisma: PrismaClient, scope: UserDataScope, filters: RiskFilters, now = new Date()) {
  const today = startOfUtcDay(now);
  const loans = (await loadPortfolioLoans(prisma, scope, filters, { statuses: openRiskStatuses }, today)).filter(
    (loan) => loan.outstandingPrincipalMinor > 0n,
  );

  const buckets = agingBucketOrder.map((bucket) => {
    const bucketLoans = loans.filter((loan) => loan.agingBucket === bucket);
    const outstandingPrincipalMinor = sumBigInt(bucketLoans.map((loan) => loan.outstandingPrincipalMinor));
    const provisionRatePercent = provisioningRates[bucket];
    const provisionMinor = percentageOf(outstandingPrincipalMinor, provisionRatePercent);
    return {
      key: bucket,
      label: agingBucketLabels[bucket],
      provisionRatePercent,
      loanCount: bucketLoans.length,
      outstandingPrincipalMinor,
      provisionMinor,
    };
  });

  const totalOutstandingPrincipalMinor = sumBigInt(buckets.map((bucket) => bucket.outstandingPrincipalMinor));
  const totalProvisionMinor = sumBigInt(buckets.map((bucket) => bucket.provisionMinor));

  return {
    generatedAt: now,
    filters,
    totals: {
      loanCount: loans.length,
      totalOutstandingPrincipalMinor,
      totalProvisionMinor,
      coverageBps: ratioBps(totalProvisionMinor, totalOutstandingPrincipalMinor),
    },
    buckets,
    loans: loans
      .map((loan) => ({
        id: loan.id,
        accountNumber: loan.accountNumber,
        borrowerName: loan.borrowerName,
        officeName: loan.officeName,
        loanOfficerName: loan.loanOfficerName,
        productName: loan.productName,
        status: loan.status,
        currencyCode: loan.denominationCurrency,
        outstandingPrincipalMinor: loan.outstandingPrincipalMinor,
        daysOverdue: loan.daysOverdue,
        agingBucket: loan.agingBucket,
        provisionRatePercent: provisioningRates[loan.agingBucket],
        provisionMinor: percentageOf(loan.outstandingPrincipalMinor, provisioningRates[loan.agingBucket]),
      }))
      .sort((left, right) => {
        if (left.provisionMinor === right.provisionMinor) return compareRiskLoans(left, right);
        return left.provisionMinor > right.provisionMinor ? -1 : 1;
      }),
  };
}

export async function loadRecoveriesReport(prisma: PrismaClient, scope: UserDataScope, filters: RiskFilters, now = new Date()) {
  const loans = await prisma.loan.findMany({
    where: {
      office: { organizationId: scope.organizationId },
      ...officeWhere(scope),
      ...(filters.officeId ? { officeId: filters.officeId } : {}),
      ...(filters.loanOfficerId ? { loanOfficerId: filters.loanOfficerId } : {}),
      status: "WRITTEN_OFF",
    },
    select: {
      id: true,
      accountNumber: true,
      principalMinor: true,
      denominationCurrency: true,
      updatedAt: true,
      office: { select: { name: true } },
      product: { select: { name: true } },
      loanOfficer: { select: { name: true } },
      client: { select: { firstName: true, middleName: true, lastName: true } },
      group: { select: { name: true } },
      transactions: {
        select: {
          transactionType: true,
          businessDate: true,
          settlementAmountMinor: true,
          denominationAmountMinor: true,
          reversedById: true,
        },
        orderBy: { businessDate: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  let fallbackWriteOffDateCount = 0;
  const periods = new Map<string, { periodKey: string; periodLabel: string; recoveredMinor: bigint; recoveryCount: number; loanIds: Set<string> }>();

  const recoveryLoans = loans
    .map((loan) => {
      const writeOffTransaction = [...loan.transactions].reverse().find((transaction) => writeOffTransactionTypes.has(transaction.transactionType));
      const writeOffDate = writeOffTransaction?.businessDate ?? loan.updatedAt;
      const writeOffDateSource = writeOffTransaction ? "transaction" : "loan.updatedAt";
      if (!writeOffTransaction) fallbackWriteOffDateCount += 1;

      const recoveries = loan.transactions
        .filter((transaction) => !transaction.reversedById)
        .filter((transaction) => isRepaymentLikeTransaction(transaction.transactionType))
        .filter((transaction) => transaction.businessDate > writeOffDate)
        .map((transaction) => ({
          businessDate: transaction.businessDate,
          transactionType: transaction.transactionType,
          amountMinor: transaction.settlementAmountMinor,
        }));

      for (const recovery of recoveries) {
        const periodKey = monthKey(recovery.businessDate);
        const current = periods.get(periodKey) ?? {
          periodKey,
          periodLabel: monthLabel(recovery.businessDate),
          recoveredMinor: 0n,
          recoveryCount: 0,
          loanIds: new Set<string>(),
        };
        current.recoveredMinor += recovery.amountMinor;
        current.recoveryCount += 1;
        current.loanIds.add(loan.id);
        periods.set(periodKey, current);
      }

      return {
        id: loan.id,
        accountNumber: loan.accountNumber,
        borrowerName: borrowerLabel(loan.client, loan.group),
        officeName: loan.office.name,
        loanOfficerName: loan.loanOfficer?.name ?? "Unassigned",
        productName: loan.product.name,
        currencyCode: loan.denominationCurrency,
        originalPrincipalMinor: loan.principalMinor,
        writeOffDate,
        writeOffDateSource,
        writeOffAmountMinor: writeOffTransaction?.settlementAmountMinor ?? 0n,
        recoveredAmountMinor: sumBigInt(recoveries.map((transaction) => transaction.amountMinor)),
        recoveryCount: recoveries.length,
        latestRecoveryOn: recoveries.at(-1)?.businessDate ?? null,
        recoveries,
      };
    })
    .filter((loan) => loan.recoveredAmountMinor > 0n)
    .sort((left, right) => {
      if (left.recoveredAmountMinor === right.recoveredAmountMinor) return left.accountNumber.localeCompare(right.accountNumber);
      return left.recoveredAmountMinor > right.recoveredAmountMinor ? -1 : 1;
    });

  return {
    generatedAt: now,
    filters,
    assumptions: {
      writeOffDateSource:
        fallbackWriteOffDateCount === 0
          ? "All written-off loans used the WRITE_OFF transaction businessDate as the write-off date."
          : "WRITE_OFF transaction businessDate is used when present; loan.updatedAt is the fallback when no dated write-off transaction exists.",
    },
    totals: {
      writtenOffLoanCount: loans.length,
      loansWithRecoveriesCount: recoveryLoans.length,
      totalRecoveredMinor: sumBigInt(recoveryLoans.map((loan) => loan.recoveredAmountMinor)),
      recoveryTransactionCount: recoveryLoans.reduce((sum, loan) => sum + loan.recoveryCount, 0),
      fallbackWriteOffDateCount,
    },
    periods: [...periods.values()]
      .map((period) => ({
        periodKey: period.periodKey,
        periodLabel: period.periodLabel,
        recoveredMinor: period.recoveredMinor,
        recoveryCount: period.recoveryCount,
        loanCount: period.loanIds.size,
      }))
      .sort((left, right) => right.periodKey.localeCompare(left.periodKey)),
    loans: recoveryLoans,
  };
}

export async function loadParRollRateReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  filters: RiskFilters,
  cohortMonths = 18,
  now = new Date(),
) {
  const today = startOfUtcDay(now);
  const cohortStart = addUtcMonths(startOfUtcMonth(today), -(cohortMonths - 1));
  const loans = await loadPortfolioLoans(
    prisma,
    scope,
    filters,
    { statuses: cohortStatuses, disbursedOnOrAfter: cohortStart },
    today,
  );

  const cohorts = new Map<
    string,
    {
      cohortKey: string;
      cohortLabel: string;
      loanCount: number;
      originalPrincipalMinor: bigint;
      bucketPrincipalMinor: Record<VintageBucketKey, bigint>;
    }
  >();

  for (const loan of loans) {
    if (!loan.disbursedOn) continue;
    const cohortKey = monthKey(loan.disbursedOn);
    const cohort = cohorts.get(cohortKey) ?? {
      cohortKey,
      cohortLabel: monthLabel(loan.disbursedOn),
      loanCount: 0,
      originalPrincipalMinor: 0n,
      bucketPrincipalMinor: {
        CURRENT: 0n,
        "1_30": 0n,
        "31_60": 0n,
        "61_90": 0n,
        "90_PLUS": 0n,
        WRITTEN_OFF: 0n,
      },
    };

    cohort.loanCount += 1;
    cohort.originalPrincipalMinor += loan.principalMinor;
    const currentBucket: VintageBucketKey = loan.status === "WRITTEN_OFF" ? "WRITTEN_OFF" : loan.daysOverdue > 0 ? loan.agingBucket : "CURRENT";
    cohort.bucketPrincipalMinor[currentBucket] += loan.principalMinor;
    cohorts.set(cohortKey, cohort);
  }

  const rows = [...cohorts.values()]
    .sort((left, right) => right.cohortKey.localeCompare(left.cohortKey))
    .map((cohort) => ({
      cohortKey: cohort.cohortKey,
      cohortLabel: cohort.cohortLabel,
      loanCount: cohort.loanCount,
      originalPrincipalMinor: cohort.originalPrincipalMinor,
      distribution: Object.fromEntries(
        vintageBucketOrder.map((bucket) => [
          bucket,
          {
            label: vintageBucketLabels[bucket],
            principalMinor: cohort.bucketPrincipalMinor[bucket],
            percentageBps: ratioBps(cohort.bucketPrincipalMinor[bucket], cohort.originalPrincipalMinor),
          },
        ]),
      ) as Record<VintageBucketKey, { label: string; principalMinor: bigint; percentageBps: number }>,
    }));

  const totalOriginalPrincipalMinor = sumBigInt(rows.map((row) => row.originalPrincipalMinor));
  const totalLoanCount = rows.reduce((sum, row) => sum + row.loanCount, 0);

  return {
    generatedAt: now,
    filters,
    cohortMonths,
    assumptions: {
      currentDefinition:
        "Current includes current, closed, and overpaid loans with no overdue installment so each cohort still ties back to 100% of original principal.",
    },
    totals: {
      cohortCount: rows.length,
      loanCount: totalLoanCount,
      totalOriginalPrincipalMinor,
      writtenOffShareBps: ratioBps(
        sumBigInt(rows.map((row) => row.distribution.WRITTEN_OFF.principalMinor)),
        totalOriginalPrincipalMinor,
      ),
      ninetyPlusShareBps: ratioBps(
        sumBigInt(rows.map((row) => row.distribution["90_PLUS"].principalMinor)),
        totalOriginalPrincipalMinor,
      ),
    },
    rows,
  };
}

export function serializeRiskReport<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, current) => (typeof current === "bigint" ? current.toString() : current)),
  ) as T;
}

export function formatBps(bps: number) {
  return `${(bps / 100).toFixed(2)}%`;
}

export function loanStatusTone(status: LoanStatus) {
  switch (status) {
    case "ACTIVE":
    case "CLOSED":
      return "up-to-date";
    case "OVERPAID":
      return "review";
    case "IN_ARREARS":
    case "WRITTEN_OFF":
      return "in-arrears";
    default:
      return "review";
  }
}

export function agingBucketTone(bucket: AgingBucketKey | VintageBucketKey) {
  if (bucket === "CURRENT") return "up-to-date";
  if (bucket === "1_30" || bucket === "31_60") return "review";
  return "in-arrears";
}

async function loadPortfolioLoans(
  prisma: PrismaClient,
  scope: UserDataScope,
  filters: RiskFilters,
  options: { statuses: LoanStatus[]; disbursedOnOrAfter?: Date },
  today: Date,
): Promise<PortfolioLoanSnapshot[]> {
  const loans = await prisma.loan.findMany({
    where: {
      office: { organizationId: scope.organizationId },
      ...officeWhere(scope),
      ...(filters.officeId ? { officeId: filters.officeId } : {}),
      ...(filters.loanOfficerId ? { loanOfficerId: filters.loanOfficerId } : {}),
      ...(options.disbursedOnOrAfter ? { disbursedOn: { gte: options.disbursedOnOrAfter } } : {}),
      status: { in: options.statuses },
    },
    select: {
      id: true,
      accountNumber: true,
      status: true,
      principalMinor: true,
      denominationCurrency: true,
      officeId: true,
      disbursedOn: true,
      maturesOn: true,
      office: { select: { name: true } },
      product: { select: { name: true } },
      loanOfficerId: true,
      loanOfficer: { select: { name: true } },
      client: { select: { firstName: true, middleName: true, lastName: true } },
      group: { select: { name: true } },
      installments: {
        select: {
          dueOn: true,
          principalDueMinor: true,
          interestDueMinor: true,
          feesDueMinor: true,
          penaltiesDueMinor: true,
          principalPaidMinor: true,
          interestPaidMinor: true,
          feesPaidMinor: true,
          penaltiesPaidMinor: true,
          principalWaivedMinor: true,
          interestWaivedMinor: true,
          feesWaivedMinor: true,
          penaltiesWaivedMinor: true,
        },
        orderBy: { dueOn: "asc" },
      },
    },
    orderBy: [{ disbursedOn: "desc" }, { createdAt: "desc" }],
  });

  return loans.map((loan) => {
    const overdueInstallment = loan.installments.find(
      (installment) => startOfUtcDay(installment.dueOn) < today && outstandingTotalMinor(installment) > 0n,
    );
    const daysOverdue = overdueInstallment ? dayDiff(today, overdueInstallment.dueOn) : 0;
    const loanOutstandingPrincipalMinor = sumBigInt(loan.installments.map(outstandingPrincipalMinor));
    const loanOutstandingTotalMinor = sumBigInt(loan.installments.map(outstandingTotalMinor));

    return {
      id: loan.id,
      accountNumber: loan.accountNumber,
      status: loan.status,
      principalMinor: loan.principalMinor,
      denominationCurrency: loan.denominationCurrency,
      officeId: loan.officeId,
      officeName: loan.office.name,
      loanOfficerId: loan.loanOfficerId,
      loanOfficerName: loan.loanOfficer?.name ?? "Unassigned",
      borrowerName: borrowerLabel(loan.client, loan.group),
      productName: loan.product.name,
      disbursedOn: loan.disbursedOn,
      maturesOn: loan.maturesOn,
      outstandingPrincipalMinor: loanOutstandingPrincipalMinor,
      outstandingTotalMinor: loanOutstandingTotalMinor,
      daysOverdue,
      overdueSince: overdueInstallment?.dueOn ?? null,
      agingBucket: agingBucket(daysOverdue),
    };
  });
}

function asOptionalString(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const trimmed = candidate?.trim();
  return trimmed ? trimmed : undefined;
}

function borrowerLabel(
  client: { firstName: string; middleName: string | null; lastName: string } | null,
  group: { name: string } | null,
) {
  if (client) return [client.firstName, client.middleName, client.lastName].filter(Boolean).join(" ");
  if (group) return `Group: ${group.name}`;
  return "Unknown borrower";
}

function outstandingPrincipalMinor(installment: InstallmentSnapshot) {
  return positive(installment.principalDueMinor - installment.principalPaidMinor - installment.principalWaivedMinor);
}

function outstandingTotalMinor(installment: InstallmentSnapshot) {
  return positive(
    installment.principalDueMinor +
      installment.interestDueMinor +
      installment.feesDueMinor +
      installment.penaltiesDueMinor -
      installment.principalPaidMinor -
      installment.interestPaidMinor -
      installment.feesPaidMinor -
      installment.penaltiesPaidMinor -
      installment.principalWaivedMinor -
      installment.interestWaivedMinor -
      installment.feesWaivedMinor -
      installment.penaltiesWaivedMinor,
  );
}

function positive(value: bigint) {
  return value > 0n ? value : 0n;
}

function sumBigInt(values: bigint[]) {
  return values.reduce((sum, value) => sum + value, 0n);
}

function ratioBps(amount: bigint, total: bigint) {
  if (amount <= 0n || total <= 0n) return 0;
  return Number((amount * 10_000n) / total);
}

function percentageOf(amount: bigint, percent: number) {
  if (amount <= 0n || percent <= 0) return 0n;
  return (amount * BigInt(percent)) / 100n;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date: Date, deltaMonths: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + deltaMonths, 1));
}

function dayDiff(later: Date, earlier: Date) {
  return Math.max(0, Math.floor((startOfUtcDay(later).getTime() - startOfUtcDay(earlier).getTime()) / 86_400_000));
}

function agingBucket(daysOverdue: number): AgingBucketKey {
  if (daysOverdue <= 0) return "CURRENT";
  if (daysOverdue <= 30) return "1_30";
  if (daysOverdue <= 60) return "31_60";
  if (daysOverdue <= 90) return "61_90";
  return "90_PLUS";
}

function bucketSeverity(bucket: AgingBucketKey) {
  return agingBucketOrder.indexOf(bucket);
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-UG", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function isRepaymentLikeTransaction(transactionType: string) {
  const normalized = transactionType.toLowerCase();
  if (normalized.includes("reversal")) return false;
  if (normalized.includes("writeoff") || normalized.includes("write_off")) return false;
  if (normalized.includes("disbursement")) return false;
  if (normalized.includes("accrual")) return false;
  if (normalized.includes("waive") || normalized.includes("waiver")) return false;
  if (normalized.includes("recoveryrepayment") || normalized.includes("recovery_repayment")) return true;
  if (normalized.includes("repaymentatdisbursement")) return false;
  return normalized.endsWith(".repayment") || normalized === "repayment" || normalized === "prepayment" || normalized === "foreclosure";
}

function compareRiskLoans(
  left: { daysOverdue: number; outstandingPrincipalMinor: bigint; borrowerName: string },
  right: { daysOverdue: number; outstandingPrincipalMinor: bigint; borrowerName: string },
) {
  if (left.daysOverdue !== right.daysOverdue) return right.daysOverdue - left.daysOverdue;
  if (left.outstandingPrincipalMinor !== right.outstandingPrincipalMinor) {
    return left.outstandingPrincipalMinor > right.outstandingPrincipalMinor ? -1 : 1;
  }
  return left.borrowerName.localeCompare(right.borrowerName);
}
