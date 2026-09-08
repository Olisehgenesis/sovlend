import type { LoanStatus, PrismaClient } from "@prisma/client";

import { officeWhere, type UserDataScope } from "@/modules/identity/application/data-scope";
import { rowsToCsv } from "@/modules/lending/domain/loan-export";

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

// Provisioning classification ladder matching iLend's canned "Provision Report" exactly
// (Normal/Watch/Substandard/Doubtful/Loss @ 1%/5%/25%/50%/100%, boundaries at 0/1-30/31-90/
// 91-180/180+ days overdue). This is intentionally a separate ladder from the generic
// AgingBucketKey scheme above (used by the Aging report / PAR roll-rate), which iLend itself
// also buckets differently (0-30/30-60/60-90/90-180/180-360/360+) for its own aging report.
export type ProvisioningBucketKey = "NORMAL" | "WATCH" | "SUBSTANDARD" | "DOUBTFUL" | "LOSS";

export const provisioningBucketOrder: ProvisioningBucketKey[] = ["NORMAL", "WATCH", "SUBSTANDARD", "DOUBTFUL", "LOSS"];

export const provisioningBucketLabels: Record<ProvisioningBucketKey, string> = {
  NORMAL: "Normal (current)",
  WATCH: "Watch (1-30 days)",
  SUBSTANDARD: "Substandard (31-90 days)",
  DOUBTFUL: "Doubtful (91-180 days)",
  LOSS: "Loss (180+ days)",
};

export const provisioningRates: Record<ProvisioningBucketKey, number> = {
  NORMAL: 1,
  WATCH: 5,
  SUBSTANDARD: 25,
  DOUBTFUL: 50,
  LOSS: 100,
};

export function classifyProvisioningBucket(daysOverdue: number): ProvisioningBucketKey {
  if (daysOverdue <= 0) return "NORMAL";
  if (daysOverdue <= 30) return "WATCH";
  if (daysOverdue <= 90) return "SUBSTANDARD";
  if (daysOverdue <= 180) return "DOUBTFUL";
  return "LOSS";
}

export function provisioningBucketTone(bucket: ProvisioningBucketKey) {
  if (bucket === "NORMAL") return "up-to-date";
  if (bucket === "WATCH" || bucket === "SUBSTANDARD") return "review";
  return "in-arrears";
}

// Branch Portfolio (by loan officer) day-bucket ladder matching iLend's canned "Branch Portfolio"
// report exactly (1-30/31-60/61-90/91-180/180+ days overdue). This is intentionally a 4th distinct
// bucket ladder alongside AgingBucketKey (CURRENT/1-30/31-60/61-90/90+, used by Aging/PAR roll-rate)
// and ProvisioningBucketKey (0/1-30/31-90/91-180/180+, used by Provisioning) — iLend itself uses a
// different boundary set per report, so we mirror each one rather than force a single shared scheme.
export type BranchPortfolioBucketKey = "1_30" | "31_60" | "61_90" | "91_180" | "180_PLUS";

export const branchPortfolioBucketOrder: BranchPortfolioBucketKey[] = ["1_30", "31_60", "61_90", "91_180", "180_PLUS"];

export const branchPortfolioBucketLabels: Record<BranchPortfolioBucketKey, string> = {
  "1_30": "1-30 days",
  "31_60": "31-60 days",
  "61_90": "61-90 days",
  "91_180": "91-180 days",
  "180_PLUS": "Over 180 days",
};

export function branchPortfolioBucket(daysOverdue: number): BranchPortfolioBucketKey {
  if (daysOverdue <= 30) return "1_30";
  if (daysOverdue <= 60) return "31_60";
  if (daysOverdue <= 90) return "61_90";
  if (daysOverdue <= 180) return "91_180";
  return "180_PLUS";
}


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
  annualRateBps: number;
  // Repaid-to-date per component (sum of installment *PaidMinor across the whole schedule),
  // matching iLend's canned "Active Loans" report columns (Principal/Interest/Fees/Penalties Repaid).
  principalRepaidMinor: bigint;
  interestRepaidMinor: bigint;
  feesRepaidMinor: bigint;
  penaltiesRepaidMinor: bigint;
  outstandingPrincipalMinor: bigint;
  outstandingInterestMinor: bigint;
  outstandingFeesMinor: bigint;
  outstandingPenaltiesMinor: bigint;
  outstandingTotalMinor: bigint;
  overduePrincipalMinor: bigint;
  overdueInterestMinor: bigint;
  overdueFeesMinor: bigint;
  overduePenaltiesMinor: bigint;
  overdueTotalMinor: bigint;
  daysOverdue: number;
  overdueSince: Date | null;
  agingBucket: AgingBucketKey;
};

export type AgingReport = Awaited<ReturnType<typeof loadAgingReport>>;
export type ArrearsReport = Awaited<ReturnType<typeof loadArrearsReport>>;
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
  // Use total outstanding (principal+interest+fees+penalties) as the portfolio inclusion basis,
  // not principal alone — some loans amortize principal to zero while still owing accrued
  // interest/fees/penalties, and iLend's canned Aging report includes those. See NPL/Provisioning
  // fixes for the same underlying pattern.
  const loans = (await loadPortfolioLoans(prisma, scope, filters, { statuses: openRiskStatuses }, today)).filter(
    (loan) => loan.outstandingTotalMinor > 0n,
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

export async function loadArrearsReport(prisma: PrismaClient, scope: UserDataScope, filters: RiskFilters, now = new Date()) {
  const today = startOfUtcDay(now);
  const loans = (await loadPortfolioLoans(prisma, scope, filters, { statuses: openRiskStatuses }, today))
    .filter((loan) => loan.daysOverdue > 0 || (loan.status === "IN_ARREARS" && loan.overdueTotalMinor > 0n))
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
      overduePrincipalMinor: loan.overduePrincipalMinor,
      overdueInterestMinor: loan.overdueInterestMinor,
      overdueFeesMinor: loan.overdueFeesMinor,
      overduePenaltiesMinor: loan.overduePenaltiesMinor,
      overdueTotalMinor: loan.overdueTotalMinor,
      daysOverdue: loan.daysOverdue,
      overdueSince: loan.overdueSince,
      agingBucket: loan.agingBucket,
    }))
    .sort(compareArrearsLoans);

  return {
    generatedAt: now,
    filters,
    totals: {
      loanCount: loans.length,
      totalOutstandingPrincipalMinor: sumBigInt(loans.map((loan) => loan.outstandingPrincipalMinor)),
      totalOutstandingMinor: sumBigInt(loans.map((loan) => loan.outstandingTotalMinor)),
      overduePrincipalMinor: sumBigInt(loans.map((loan) => loan.overduePrincipalMinor)),
      overdueInterestMinor: sumBigInt(loans.map((loan) => loan.overdueInterestMinor)),
      overdueFeesMinor: sumBigInt(loans.map((loan) => loan.overdueFeesMinor)),
      overduePenaltiesMinor: sumBigInt(loans.map((loan) => loan.overduePenaltiesMinor)),
      overdueTotalMinor: sumBigInt(loans.map((loan) => loan.overdueTotalMinor)),
    },
    loans,
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
  // Match iLend's inclusion basis: total outstanding (principal+interest+fees+penalties), not
  // principal alone. Some past-due loans carry zero outstanding principal but still owe
  // interest/fees/penalties, and iLend's canned report still classifies those as NPL.
  const portfolioLoans = (await loadPortfolioLoans(prisma, scope, filters, { statuses: openRiskStatuses }, today)).filter(
    (loan) => loan.outstandingTotalMinor > 0n,
  );
  const loans = portfolioLoans
    // NPL definition matches iLend's canned "Non Performing Loans" report exactly: loans
    // more than `thresholdDays` past due. Previously this also unconditionally included
    // every IN_ARREARS loan regardless of days overdue, which over-counted NPL exposure
    // relative to iLend (a loan can be classified IN_ARREARS locally as soon as it misses
    // a due date, long before it crosses the 90-day NPL threshold).
    .filter((loan) => loan.daysOverdue > thresholdDays)
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
  // Provisioning basis matches iLend's canned Provision Report: total outstanding exposure
  // (principal + interest + fees + penalties), not principal alone.
  const loans = (await loadPortfolioLoans(prisma, scope, filters, { statuses: openRiskStatuses }, today))
    .filter((loan) => loan.outstandingTotalMinor > 0n)
    .map((loan) => ({ ...loan, provisioningBucket: classifyProvisioningBucket(loan.daysOverdue) }));

  const buckets = provisioningBucketOrder.map((bucket) => {
    const bucketLoans = loans.filter((loan) => loan.provisioningBucket === bucket);
    const outstandingMinor = sumBigInt(bucketLoans.map((loan) => loan.outstandingTotalMinor));
    const provisionRatePercent = provisioningRates[bucket];
    const provisionMinor = percentageOf(outstandingMinor, provisionRatePercent);
    return {
      key: bucket,
      label: provisioningBucketLabels[bucket],
      provisionRatePercent,
      loanCount: bucketLoans.length,
      outstandingMinor,
      provisionMinor,
    };
  });

  const totalOutstandingMinor = sumBigInt(buckets.map((bucket) => bucket.outstandingMinor));
  const totalProvisionMinor = sumBigInt(buckets.map((bucket) => bucket.provisionMinor));

  return {
    generatedAt: now,
    filters,
    totals: {
      loanCount: loans.length,
      totalOutstandingMinor,
      totalProvisionMinor,
      coverageBps: ratioBps(totalProvisionMinor, totalOutstandingMinor),
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
        outstandingMinor: loan.outstandingTotalMinor,
        daysOverdue: loan.daysOverdue,
        provisioningBucket: loan.provisioningBucket,
        provisionRatePercent: provisioningRates[loan.provisioningBucket],
        provisionMinor: percentageOf(loan.outstandingTotalMinor, provisioningRates[loan.provisioningBucket]),
      }))
      .sort((left, right) => {
        if (left.provisionMinor === right.provisionMinor) {
          return compareRiskLoans(
            { ...left, outstandingPrincipalMinor: left.outstandingMinor },
            { ...right, outstandingPrincipalMinor: right.outstandingMinor },
          );
        }
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
        .filter((transaction) => isRecoveryTransaction(transaction.transactionType, transaction.businessDate, writeOffDate))
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

const agingLoanColumns = [
  "accountNumber",
  "borrowerName",
  "officeName",
  "loanOfficerName",
  "productName",
  "status",
  "currencyCode",
  "outstandingPrincipalMinor",
  "daysOverdue",
  "agingBucket",
] as const;

function agingLoanRow(loan: AgingReport["loans"][number]) {
  return {
    accountNumber: loan.accountNumber,
    borrowerName: loan.borrowerName,
    officeName: loan.officeName,
    loanOfficerName: loan.loanOfficerName,
    productName: loan.productName,
    status: loan.status,
    currencyCode: loan.currencyCode,
    outstandingPrincipalMinor: loan.outstandingPrincipalMinor.toString(),
    daysOverdue: String(loan.daysOverdue),
    agingBucket: loan.agingBucket,
  };
}

export function agingReportCsv(report: AgingReport) {
  return rowsToCsv(report.loans.map(agingLoanRow), [...agingLoanColumns]);
}

const arrearsLoanColumns = [
  "accountNumber",
  "borrowerName",
  "officeName",
  "loanOfficerName",
  "productName",
  "status",
  "currencyCode",
  "overduePrincipalMinor",
  "overdueInterestMinor",
  "overdueFeesMinor",
  "overduePenaltiesMinor",
  "overdueTotalMinor",
  "outstandingPrincipalMinor",
  "outstandingTotalMinor",
  "daysOverdue",
  "overdueSince",
  "agingBucket",
] as const;

export function arrearsReportCsv(report: ArrearsReport) {
  return rowsToCsv(
    report.loans.map((loan) => ({
      accountNumber: loan.accountNumber,
      borrowerName: loan.borrowerName,
      officeName: loan.officeName,
      loanOfficerName: loan.loanOfficerName,
      productName: loan.productName,
      status: loan.status,
      currencyCode: loan.currencyCode,
      overduePrincipalMinor: loan.overduePrincipalMinor.toString(),
      overdueInterestMinor: loan.overdueInterestMinor.toString(),
      overdueFeesMinor: loan.overdueFeesMinor.toString(),
      overduePenaltiesMinor: loan.overduePenaltiesMinor.toString(),
      overdueTotalMinor: loan.overdueTotalMinor.toString(),
      outstandingPrincipalMinor: loan.outstandingPrincipalMinor.toString(),
      outstandingTotalMinor: loan.outstandingTotalMinor.toString(),
      daysOverdue: String(loan.daysOverdue),
      overdueSince: loan.overdueSince ? isoDate(loan.overdueSince) : "",
      agingBucket: loan.agingBucket,
    })),
    [...arrearsLoanColumns],
  );
}

export function nonPerformingLoansReportCsv(report: NonPerformingLoansReport) {
  return rowsToCsv(report.loans.map(agingLoanRow), [...agingLoanColumns]);
}

export function provisioningReportCsv(report: ProvisioningReport) {
  return rowsToCsv(
    report.loans.map((loan) => ({
      accountNumber: loan.accountNumber,
      borrowerName: loan.borrowerName,
      officeName: loan.officeName,
      loanOfficerName: loan.loanOfficerName,
      productName: loan.productName,
      status: loan.status,
      currencyCode: loan.currencyCode,
      outstandingMinor: loan.outstandingMinor.toString(),
      daysOverdue: String(loan.daysOverdue),
      provisioningBucket: loan.provisioningBucket,
      provisionRatePercent: String(loan.provisionRatePercent),
      provisionMinor: loan.provisionMinor.toString(),
    })),
    [
      "accountNumber",
      "borrowerName",
      "officeName",
      "loanOfficerName",
      "productName",
      "status",
      "currencyCode",
      "outstandingMinor",
      "daysOverdue",
      "provisioningBucket",
      "provisionRatePercent",
      "provisionMinor",
    ],
  );
}

export function recoveriesReportCsv(report: RecoveriesReport) {
  return rowsToCsv(
    report.loans.map((loan) => ({
      accountNumber: loan.accountNumber,
      borrowerName: loan.borrowerName,
      officeName: loan.officeName,
      loanOfficerName: loan.loanOfficerName,
      productName: loan.productName,
      currencyCode: loan.currencyCode,
      originalPrincipalMinor: loan.originalPrincipalMinor.toString(),
      writeOffDate: isoDate(loan.writeOffDate),
      writeOffAmountMinor: loan.writeOffAmountMinor.toString(),
      recoveredAmountMinor: loan.recoveredAmountMinor.toString(),
      recoveryCount: String(loan.recoveryCount),
      latestRecoveryOn: loan.latestRecoveryOn ? isoDate(loan.latestRecoveryOn) : "",
    })),
    [
      "accountNumber",
      "borrowerName",
      "officeName",
      "loanOfficerName",
      "productName",
      "currencyCode",
      "originalPrincipalMinor",
      "writeOffDate",
      "writeOffAmountMinor",
      "recoveredAmountMinor",
      "recoveryCount",
      "latestRecoveryOn",
    ],
  );
}

export function parRollRateReportCsv(report: ParRollRateReport) {
  return rowsToCsv(
    report.rows.map((row) => ({
      cohortLabel: row.cohortLabel,
      loanCount: String(row.loanCount),
      originalPrincipalMinor: row.originalPrincipalMinor.toString(),
      current: row.distribution.CURRENT.principalMinor.toString(),
      days1to30: row.distribution["1_30"].principalMinor.toString(),
      days31to60: row.distribution["31_60"].principalMinor.toString(),
      days61to90: row.distribution["61_90"].principalMinor.toString(),
      days90plus: row.distribution["90_PLUS"].principalMinor.toString(),
      writtenOff: row.distribution.WRITTEN_OFF.principalMinor.toString(),
    })),
    [
      "cohortLabel",
      "loanCount",
      "originalPrincipalMinor",
      "current",
      "days1to30",
      "days31to60",
      "days61to90",
      "days90plus",
      "writtenOff",
    ],
  );
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
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

export async function loadPortfolioLoans(
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
      product: { select: { name: true, annualRateBps: true } },
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
    const overdueInstallments = loan.installments.filter(
      (installment) => startOfUtcDay(installment.dueOn) < today && outstandingTotalMinor(installment) > 0n,
    );
    const overdueInstallment = loan.installments.find(
      (installment) => startOfUtcDay(installment.dueOn) < today && outstandingTotalMinor(installment) > 0n,
    );
    const daysOverdue = overdueInstallment ? dayDiff(today, overdueInstallment.dueOn) : 0;
    const loanOutstandingPrincipalMinor = sumBigInt(loan.installments.map(outstandingPrincipalMinor));
    const loanOutstandingInterestMinor = sumBigInt(loan.installments.map(outstandingInterestMinor));
    const loanOutstandingFeesMinor = sumBigInt(loan.installments.map(outstandingFeesMinor));
    const loanOutstandingPenaltiesMinor = sumBigInt(loan.installments.map(outstandingPenaltiesMinor));
    const loanOutstandingTotalMinor = sumBigInt(loan.installments.map(outstandingTotalMinor));
    const overduePrincipalMinor = sumBigInt(overdueInstallments.map(outstandingPrincipalMinor));
    const overdueInterestMinor = sumBigInt(overdueInstallments.map(outstandingInterestMinor));
    const overdueFeesMinor = sumBigInt(overdueInstallments.map(outstandingFeesMinor));
    const overduePenaltiesMinor = sumBigInt(overdueInstallments.map(outstandingPenaltiesMinor));
    const principalRepaidMinor = sumBigInt(loan.installments.map((installment) => installment.principalPaidMinor));
    const interestRepaidMinor = sumBigInt(loan.installments.map((installment) => installment.interestPaidMinor));
    const feesRepaidMinor = sumBigInt(loan.installments.map((installment) => installment.feesPaidMinor));
    const penaltiesRepaidMinor = sumBigInt(loan.installments.map((installment) => installment.penaltiesPaidMinor));

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
      annualRateBps: loan.product.annualRateBps,
      principalRepaidMinor,
      interestRepaidMinor,
      feesRepaidMinor,
      penaltiesRepaidMinor,
      outstandingPrincipalMinor: loanOutstandingPrincipalMinor,
      outstandingInterestMinor: loanOutstandingInterestMinor,
      outstandingFeesMinor: loanOutstandingFeesMinor,
      outstandingPenaltiesMinor: loanOutstandingPenaltiesMinor,
      outstandingTotalMinor: loanOutstandingTotalMinor,
      overduePrincipalMinor,
      overdueInterestMinor,
      overdueFeesMinor,
      overduePenaltiesMinor,
      overdueTotalMinor:
        overduePrincipalMinor +
        overdueInterestMinor +
        overdueFeesMinor +
        overduePenaltiesMinor,
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

function outstandingInterestMinor(installment: InstallmentSnapshot) {
  return positive(installment.interestDueMinor - installment.interestPaidMinor - installment.interestWaivedMinor);
}

function outstandingFeesMinor(installment: InstallmentSnapshot) {
  return positive(installment.feesDueMinor - installment.feesPaidMinor - installment.feesWaivedMinor);
}

function outstandingPenaltiesMinor(installment: InstallmentSnapshot) {
  return positive(installment.penaltiesDueMinor - installment.penaltiesPaidMinor - installment.penaltiesWaivedMinor);
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

function isExplicitRecoveryTransactionType(transactionType: string) {
  const normalized = transactionType.toLowerCase();
  return normalized.includes("recoveryrepayment") || normalized.includes("recovery_repayment");
}

/**
 * A transaction counts as a written-off loan recovery when either:
 *  - it is explicitly typed as a recovery-repayment by the source system (trust that
 *    classification regardless of date — migrated legacy data has bulk/batch WRITE_OFF
 *    ledger postings that are sometimes dated after individual recovery-repayment
 *    transactions that the source system had already tagged as recoveries), or
 *  - it is a generic repayment-like transaction posted strictly after the write-off date
 *    (the fallback heuristic for systems/loans without a distinct recovery transaction type).
 */
function isRecoveryTransaction(transactionType: string, businessDate: Date, writeOffDate: Date) {
  if (isExplicitRecoveryTransactionType(transactionType)) return true;
  if (!isRepaymentLikeTransaction(transactionType)) return false;
  return businessDate > writeOffDate;
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

function compareArrearsLoans(
  left: { daysOverdue: number; overdueTotalMinor: bigint; borrowerName: string },
  right: { daysOverdue: number; overdueTotalMinor: bigint; borrowerName: string },
) {
  if (left.daysOverdue !== right.daysOverdue) return right.daysOverdue - left.daysOverdue;
  if (left.overdueTotalMinor !== right.overdueTotalMinor) {
    return left.overdueTotalMinor > right.overdueTotalMinor ? -1 : 1;
  }
  return left.borrowerName.localeCompare(right.borrowerName);
}
