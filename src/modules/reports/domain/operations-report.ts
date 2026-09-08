import type { ClientStatus, KycStatus, LoanStatus, PrismaClient } from "@prisma/client";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import {
  clientScopeWhere,
  getUserDataScope,
  loanScopeWhere,
  officeWhere,
  type UserDataScope,
} from "@/modules/identity/application/data-scope";
import type { PermissionCode } from "@/modules/identity/domain/permissions";
import { transactionTypeVariants } from "@/lib/loan-transaction-type-variants";
import { rowsToCsv } from "@/modules/lending/domain/loan-export";
import { loadPortfolioLoans, type AgingBucketKey, type BranchPortfolioBucketKey, branchPortfolioBucket, branchPortfolioBucketLabels, branchPortfolioBucketOrder } from "@/modules/reports/domain/risk-report";

const reportableLoanStatuses: LoanStatus[] = ["ACTIVE", "IN_ARREARS"];
const ugDateFormatter = new Intl.DateTimeFormat("en-UG", {
  dateStyle: "medium",
  timeZone: "UTC",
});
type InstallmentAmounts = {
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

export type ReportOption = { id: string; name: string };

export type OperationsReportContext = {
  allowed: boolean;
  scope: UserDataScope;
  organizationName: string;
  baseCurrency: string;
  offices: ReportOption[];
  officers: ReportOption[];
};

export type CurrencyTotal = {
  currencyCode: string;
  amountMinor: bigint;
};

export type CollectionByOfficerRow = {
  officerId: string | null;
  officerName: string;
  currencyCode: string;
  loanCount: number;
  dueTodayMinor: bigint;
  overdueArrearsMinor: bigint;
  expectedTotalMinor: bigint;
};

export type CollectionByOfficerTotal = {
  currencyCode: string;
  loanCount: number;
  dueTodayMinor: bigint;
  overdueArrearsMinor: bigint;
  expectedTotalMinor: bigint;
};

export type CollectionByOfficerReport = {
  businessDate: Date;
  rows: CollectionByOfficerRow[];
  totals: CollectionByOfficerTotal[];
};

export type UnassignedLoanRow = {
  loanId: string;
  accountNumber: string;
  borrowerName: string;
  borrowerType: "Client" | "Group";
  officeName: string;
  status: LoanStatus;
  principalMinor: bigint;
  currencyCode: string;
  disbursedOn: Date | null;
};

export type UnassignedLoansReport = {
  rows: UnassignedLoanRow[];
  totals: CurrencyTotal[];
};

export type BranchPortfolioBucketBreakdown = {
  label: string;
  amountMinor: bigint;
  percent: number;
};

export type BranchPortfolioRow = {
  loanOfficerId: string | null;
  loanOfficerName: string;
  currencyCode: string;
  activeLoanCount: number;
  outstandingPrincipalMinor: bigint;
  outstandingInterestMinor: bigint;
  outstandingFeesMinor: bigint;
  outstandingPenaltiesMinor: bigint;
  outstandingTotalMinor: bigint;
  savingsBalanceMinor: bigint;
  disbursedThisMonthMinor: bigint;
  buckets: Record<BranchPortfolioBucketKey, BranchPortfolioBucketBreakdown>;
  totalParMinor: bigint;
  totalParPercent: number;
};

export type BranchPortfolioTotal = {
  currencyCode: string;
  activeLoanCount: number;
  outstandingPrincipalMinor: bigint;
  outstandingInterestMinor: bigint;
  outstandingFeesMinor: bigint;
  outstandingPenaltiesMinor: bigint;
  outstandingTotalMinor: bigint;
  savingsBalanceMinor: bigint;
  disbursedThisMonthMinor: bigint;
  buckets: Record<BranchPortfolioBucketKey, bigint>;
  totalParMinor: bigint;
  totalParPercent: number;
};

export type BranchPortfolioReport = {
  asOfDate: Date;
  rows: BranchPortfolioRow[];
  totals: BranchPortfolioTotal[];
};

export type DisbursalCohortRow = {
  period: string;
  currencyCode: string;
  loanCount: number;
  principalMinor: bigint;
};

export type DisbursalCohortTotal = {
  currencyCode: string;
  loanCount: number;
  principalMinor: bigint;
};

export type DisbursalCohortReport = {
  startDate: Date | null;
  endDate: Date | null;
  loanOfficerId: string | null;
  rows: DisbursalCohortRow[];
  totals: DisbursalCohortTotal[];
};

export type ActiveLoanRow = {
  loanId: string;
  accountNumber: string;
  borrowerName: string;
  officeId: string;
  officeName: string;
  loanOfficerId: string | null;
  loanOfficerName: string;
  productName: string;
  currencyCode: string;
  status: LoanStatus;
  principalMinor: bigint;
  annualRateBps: number;
  disbursedOn: Date | null;
  maturesOn: Date | null;
  principalRepaidMinor: bigint;
  outstandingPrincipalMinor: bigint;
  overduePrincipalMinor: bigint;
  interestRepaidMinor: bigint;
  outstandingInterestMinor: bigint;
  overdueInterestMinor: bigint;
  feesRepaidMinor: bigint;
  outstandingFeesMinor: bigint;
  overdueFeesMinor: bigint;
  penaltiesRepaidMinor: bigint;
  outstandingPenaltiesMinor: bigint;
  overduePenaltiesMinor: bigint;
  outstandingTotalMinor: bigint;
  daysOverdue: number;
  overdueSince: Date | null;
  agingBucket: AgingBucketKey;
};

export type ActiveLoanTotal = {
  currencyCode: string;
  loanCount: number;
  principalMinor: bigint;
  outstandingPrincipalMinor: bigint;
  outstandingTotalMinor: bigint;
};

export type ActiveLoansReport = {
  officeId: string | null;
  loanOfficerId: string | null;
  rows: ActiveLoanRow[];
  totals: ActiveLoanTotal[];
};

export type ActiveLoanFundBreakdownRow = {
  fundId: string | null;
  fundName: string;
  currencyCode: string;
  loanCount: number;
  principalMinor: bigint;
};

export type ActiveLoanFundBreakdownTotal = {
  currencyCode: string;
  loanCount: number;
  principalMinor: bigint;
};

export type ActiveLoanFundBreakdownReport = {
  officeId: string | null;
  loanOfficerId: string | null;
  rows: ActiveLoanFundBreakdownRow[];
  totals: ActiveLoanFundBreakdownTotal[];
};

export type DisbursalReportRow = {
  loanId: string;
  accountNumber: string;
  borrowerName: string;
  officeId: string;
  officeName: string;
  loanOfficerId: string | null;
  loanOfficerName: string;
  productName: string;
  currencyCode: string;
  status: LoanStatus;
  principalMinor: bigint;
  disbursedOn: Date;
};

export type DisbursalReportTotal = {
  currencyCode: string;
  loanCount: number;
  principalMinor: bigint;
};

export type DisbursalReport = {
  officeId: string | null;
  loanOfficerId: string | null;
  startDate: Date | null;
  endDate: Date | null;
  rows: DisbursalReportRow[];
  totals: DisbursalReportTotal[];
};

export type CollectionsReportRow = {
  transactionId: string;
  loanId: string;
  accountNumber: string;
  borrowerName: string;
  borrowerType: "Client" | "Group";
  officeId: string;
  officeName: string;
  groupName: string | null;
  productName: string;
  currencyCode: string;
  principalMinor: bigint;
  interestMinor: bigint;
  feesMinor: bigint;
  penaltiesMinor: bigint;
  othersMinor: bigint;
  totalMinor: bigint;
  receiptNumber: string | null;
  businessDate: Date;
  createdAt: Date;
};

export type CollectionsReportTotal = {
  currencyCode: string;
  transactionCount: number;
  principalMinor: bigint;
  interestMinor: bigint;
  feesMinor: bigint;
  penaltiesMinor: bigint;
  othersMinor: bigint;
  totalMinor: bigint;
};

export type CollectionsReport = {
  officeId: string | null;
  startDate: Date | null;
  endDate: Date | null;
  rows: CollectionsReportRow[];
  totals: CollectionsReportTotal[];
};

export type OutstandingBalanceRow = {
  loanId: string;
  accountNumber: string;
  borrowerName: string;
  officeId: string;
  officeName: string;
  loanOfficerId: string | null;
  loanOfficerName: string;
  currencyCode: string;
  status: LoanStatus;
  disbursedOn: Date | null;
  maturesOn: Date | null;
  principalOutstandingMinor: bigint;
  interestOutstandingMinor: bigint;
  feesOutstandingMinor: bigint;
  penaltiesOutstandingMinor: bigint;
  totalOutstandingMinor: bigint;
};

export type OutstandingBalanceTotal = {
  currencyCode: string;
  loanCount: number;
  principalOutstandingMinor: bigint;
  interestOutstandingMinor: bigint;
  feesOutstandingMinor: bigint;
  penaltiesOutstandingMinor: bigint;
  totalOutstandingMinor: bigint;
};

export type OutstandingBalancesReport = {
  officeId: string | null;
  loanOfficerId: string | null;
  currencyCode: string | null;
  rows: OutstandingBalanceRow[];
  totals: OutstandingBalanceTotal[];
};

export type ClientListingRow = {
  id: string;
  accountNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  fullName: string;
  mobileNumber: string | null;
  externalId: string | null;
  officeId: string;
  officeName: string;
  status: ClientStatus;
  kycStatus: KycStatus;
  dateOfBirth: Date | null;
  joinedOn: Date;
};

export type ClientListingReport = {
  officeId: string | null;
  rows: ClientListingRow[];
};

export async function loadOperationsReportContext(
  prisma: PrismaClient,
  actorUserId: string,
  permission: PermissionCode,
  options: { includeReferenceData?: boolean } = {},
): Promise<OperationsReportContext | null> {
  const [scope, user] = await Promise.all([
    getUserDataScope(prisma, actorUserId),
    prisma.user.findUnique({
      where: { id: actorUserId },
      select: {
        organization: {
          select: {
            name: true,
            baseCurrency: true,
          },
        },
      },
    }),
  ]);

  if (!scope || !user?.organization) return null;

  const allowed = await new AuthorizationService(prisma).isAllowedForOrganization(
    actorUserId,
    scope.organizationId,
    permission,
  );

  if (!options.includeReferenceData) {
    return {
      allowed,
      scope,
      organizationName: user.organization.name,
      baseCurrency: user.organization.baseCurrency,
      offices: [],
      officers: [],
    };
  }

  const scopeOfficeIds = scope.officeIds ? [...scope.officeIds] : null;
  const [offices, officers] = allowed
    ? await Promise.all([
        prisma.office.findMany({
          where: {
            organizationId: scope.organizationId,
            ...(scopeOfficeIds ? { id: { in: scopeOfficeIds } } : {}),
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        prisma.user.findMany({
          where: {
            organizationId: scope.organizationId,
            OR: [
              {
                systemRole: "LOAN_OFFICER",
                ...(scopeOfficeIds ? { officeId: { in: scopeOfficeIds } } : {}),
              },
              {
                assignedLoans: {
                  some: {
                    status: { in: reportableLoanStatuses },
                    ...(scopeOfficeIds ? { officeId: { in: scopeOfficeIds } } : {}),
                  },
                },
              },
            ],
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  return {
    allowed,
    scope,
    organizationName: user.organization.name,
    baseCurrency: user.organization.baseCurrency,
    offices,
    officers,
  };
}

export async function loadCollectionByOfficerReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  params: { date?: string | null; hideZeroCollection?: boolean },
): Promise<CollectionByOfficerReport> {
  const businessDate = parseDateInput(params.date);
  const hideZeroCollection = params.hideZeroCollection ?? true;

  const [loans, installments] = await Promise.all([
    prisma.loan.findMany({
      where: {
        office: { organizationId: scope.organizationId },
        ...loanScopeWhere(scope),
        status: { in: reportableLoanStatuses },
      },
      select: {
        id: true,
        loanOfficerId: true,
        denominationCurrency: true,
        loanOfficer: { select: { name: true } },
      },
    }),
    prisma.loanInstallment.findMany({
      where: {
        dueOn: { lte: businessDate },
        loan: {
          office: { organizationId: scope.organizationId },
          ...loanScopeWhere(scope),
          status: { in: reportableLoanStatuses },
        },
      },
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
        loan: {
          select: {
            loanOfficerId: true,
            denominationCurrency: true,
            loanOfficer: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const rows = new Map<string, CollectionByOfficerRow>();

  for (const loan of loans) {
    const row = ensureCollectionRow(
      rows,
      loan.loanOfficerId,
      loan.loanOfficer?.name ?? null,
      loan.denominationCurrency,
    );
    row.loanCount += 1;
  }

  for (const installment of installments) {
    const amountMinor = totalOutstandingMinor(installment);
    if (amountMinor <= 0n) continue;

    const row = ensureCollectionRow(
      rows,
      installment.loan.loanOfficerId,
      installment.loan.loanOfficer?.name ?? null,
      installment.loan.denominationCurrency,
    );

    if (sameUtcDate(installment.dueOn, businessDate)) {
      row.dueTodayMinor += amountMinor;
    } else {
      row.overdueArrearsMinor += amountMinor;
    }
    row.expectedTotalMinor = row.dueTodayMinor + row.overdueArrearsMinor;
  }

  const sortedRows = [...rows.values()]
    .filter(
      (row) => row.loanCount > 0 || row.dueTodayMinor > 0n || row.overdueArrearsMinor > 0n,
    )
    .filter((row) => !hideZeroCollection || row.expectedTotalMinor > 0n)
    .sort(
      (left, right) =>
        compareBigIntDesc(left.expectedTotalMinor, right.expectedTotalMinor) ||
        right.loanCount - left.loanCount ||
        left.officerName.localeCompare(right.officerName) ||
        left.currencyCode.localeCompare(right.currencyCode),
    );

  const totalsMap = new Map<string, CollectionByOfficerTotal>();
  for (const row of sortedRows) {
    const total =
      totalsMap.get(row.currencyCode) ?? {
        currencyCode: row.currencyCode,
        loanCount: 0,
        dueTodayMinor: 0n,
        overdueArrearsMinor: 0n,
        expectedTotalMinor: 0n,
      };
    total.loanCount += row.loanCount;
    total.dueTodayMinor += row.dueTodayMinor;
    total.overdueArrearsMinor += row.overdueArrearsMinor;
    total.expectedTotalMinor += row.expectedTotalMinor;
    totalsMap.set(row.currencyCode, total);
  }

  return {
    businessDate,
    rows: sortedRows,
    totals: [...totalsMap.values()].sort((left, right) => left.currencyCode.localeCompare(right.currencyCode)),
  };
}

export async function loadUnassignedLoansReport(
  prisma: PrismaClient,
  scope: UserDataScope,
): Promise<UnassignedLoansReport> {
  const loans = await prisma.loan.findMany({
    where: {
      office: { organizationId: scope.organizationId },
      ...officeWhere(scope),
      status: { in: reportableLoanStatuses },
      loanOfficerId: null,
    },
    select: {
      id: true,
      accountNumber: true,
      denominationCurrency: true,
      principalMinor: true,
      status: true,
      disbursedOn: true,
      office: { select: { name: true } },
      client: { select: { firstName: true, middleName: true, lastName: true } },
      group: { select: { name: true } },
    },
    orderBy: [{ office: { name: "asc" } }, { accountNumber: "asc" }],
  });

  const rows = loans.map<UnassignedLoanRow>((loan) => ({
    loanId: loan.id,
    accountNumber: loan.accountNumber,
    borrowerName: loan.client
      ? formatHumanName(loan.client.firstName, loan.client.middleName, loan.client.lastName)
      : loan.group?.name ?? "Unknown group",
    borrowerType: loan.client ? "Client" : "Group",
    officeName: loan.office.name,
    status: loan.status,
    principalMinor: loan.principalMinor,
    currencyCode: loan.denominationCurrency,
    disbursedOn: loan.disbursedOn,
  }));

  return {
    rows,
    totals: summarizeCurrencyTotals(
      rows.map((row) => ({ currencyCode: row.currencyCode, amountMinor: row.principalMinor })),
    ),
  };
}

// Matches iLend's canned "Branch Portfolio" report exactly: despite the name, iLend groups this
// report by loan officer (not office — SovLend previously grouped by office here, which was wrong
// once there's more than one officer). Columns mirror iLend's Pentaho report: NOL, the four
// outstanding components, total outstanding, savings balance (via each officer's assigned savings
// accounts), and a 1-30/31-60/61-90/91-180/180+ day PAR bucket breakdown with per-bucket amounts
// and percentages. Note: iLend's own canned report also has a "Portfolio at Risk %" column that is
// close to but not always identical to (day-bucket PAR total / total outstanding) for a handful of
// officers — its exact formula couldn't be reverse-engineered from the aggregate report data alone,
// so we intentionally surface only the one PAR% we can verify exactly (totalParPercent below, which
// reconciles to the penny against every row of iLend's real report data checked during parity review).
export async function loadBranchPortfolioReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  params: { date?: string | null },
): Promise<BranchPortfolioReport> {
  const asOfDate = parseDateInput(params.date);
  const monthStart = startOfUtcMonth(asOfDate);
  const nextMonthStart = addUtcMonths(monthStart, 1);

  const [loans, savingsAccounts] = await Promise.all([
    loadPortfolioLoans(prisma, scope, {}, { statuses: reportableLoanStatuses }, asOfDate),
    prisma.savingsAccount.findMany({
      where: {
        OR: [
          { client: { organizationId: scope.organizationId, ...officeWhere(scope) } },
          { group: { organizationId: scope.organizationId, ...officeWhere(scope) } },
        ],
      },
      select: {
        fieldOfficerId: true,
        currencyCode: true,
        fieldOfficer: { select: { name: true } },
        transactions: { select: { amountMinor: true } },
      },
    }),
  ]);

  const emptyBuckets = (): Record<BranchPortfolioBucketKey, bigint> =>
    Object.fromEntries(branchPortfolioBucketOrder.map((bucket) => [bucket, 0n])) as Record<
      BranchPortfolioBucketKey,
      bigint
    >;

  type MutableRow = {
    loanOfficerId: string | null;
    loanOfficerName: string;
    currencyCode: string;
    activeLoanCount: number;
    outstandingPrincipalMinor: bigint;
    outstandingInterestMinor: bigint;
    outstandingFeesMinor: bigint;
    outstandingPenaltiesMinor: bigint;
    outstandingTotalMinor: bigint;
    savingsBalanceMinor: bigint;
    disbursedThisMonthMinor: bigint;
    bucketsMinor: Record<BranchPortfolioBucketKey, bigint>;
  };

  const rows = new Map<string, MutableRow>();

  const ensureRow = (loanOfficerId: string | null, loanOfficerName: string, currencyCode: string) => {
    const key = `${loanOfficerId ?? "UNASSIGNED"}:${currencyCode}`;
    const existing = rows.get(key);
    if (existing) return existing;
    const created: MutableRow = {
      loanOfficerId,
      loanOfficerName,
      currencyCode,
      activeLoanCount: 0,
      outstandingPrincipalMinor: 0n,
      outstandingInterestMinor: 0n,
      outstandingFeesMinor: 0n,
      outstandingPenaltiesMinor: 0n,
      outstandingTotalMinor: 0n,
      savingsBalanceMinor: 0n,
      disbursedThisMonthMinor: 0n,
      bucketsMinor: emptyBuckets(),
    };
    rows.set(key, created);
    return created;
  };

  for (const loan of loans) {
    const row = ensureRow(loan.loanOfficerId, loan.loanOfficerName, loan.denominationCurrency);
    row.activeLoanCount += 1;
    row.outstandingPrincipalMinor += loan.outstandingPrincipalMinor;
    row.outstandingInterestMinor += loan.outstandingInterestMinor;
    row.outstandingFeesMinor += loan.outstandingFeesMinor;
    row.outstandingPenaltiesMinor += loan.outstandingPenaltiesMinor;
    row.outstandingTotalMinor += loan.outstandingTotalMinor;

    if (loan.disbursedOn && loan.disbursedOn >= monthStart && loan.disbursedOn < nextMonthStart) {
      row.disbursedThisMonthMinor += loan.principalMinor;
    }

    if (loan.daysOverdue > 0 && loan.overdueTotalMinor > 0n) {
      const bucket = branchPortfolioBucket(loan.daysOverdue);
      row.bucketsMinor[bucket] += loan.overdueTotalMinor;
    }
  }

  for (const account of savingsAccounts) {
    const balanceMinor = account.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n);
    const row = ensureRow(account.fieldOfficerId, account.fieldOfficer?.name ?? "Unassigned", account.currencyCode);
    row.savingsBalanceMinor += balanceMinor;
  }

  const toRow = (row: MutableRow): BranchPortfolioRow => {
    const totalParMinor = branchPortfolioBucketOrder.reduce((sum, bucket) => sum + row.bucketsMinor[bucket], 0n);
    return {
      loanOfficerId: row.loanOfficerId,
      loanOfficerName: row.loanOfficerName,
      currencyCode: row.currencyCode,
      activeLoanCount: row.activeLoanCount,
      outstandingPrincipalMinor: row.outstandingPrincipalMinor,
      outstandingInterestMinor: row.outstandingInterestMinor,
      outstandingFeesMinor: row.outstandingFeesMinor,
      outstandingPenaltiesMinor: row.outstandingPenaltiesMinor,
      outstandingTotalMinor: row.outstandingTotalMinor,
      savingsBalanceMinor: row.savingsBalanceMinor,
      disbursedThisMonthMinor: row.disbursedThisMonthMinor,
      buckets: Object.fromEntries(
        branchPortfolioBucketOrder.map((bucket) => [
          bucket,
          {
            label: branchPortfolioBucketLabels[bucket],
            amountMinor: row.bucketsMinor[bucket],
            percent: percentOf(row.bucketsMinor[bucket], row.outstandingTotalMinor),
          },
        ]),
      ) as Record<BranchPortfolioBucketKey, BranchPortfolioBucketBreakdown>,
      totalParMinor,
      totalParPercent: percentOf(totalParMinor, row.outstandingTotalMinor),
    };
  };

  const sortedRows = [...rows.values()]
    .filter((row) => row.activeLoanCount > 0 || row.savingsBalanceMinor !== 0n)
    .sort(
      (left, right) =>
        compareBigIntDesc(left.outstandingTotalMinor, right.outstandingTotalMinor) ||
        left.loanOfficerName.localeCompare(right.loanOfficerName) ||
        left.currencyCode.localeCompare(right.currencyCode),
    )
    .map(toRow);

  const totalsMap = new Map<string, BranchPortfolioTotal>();
  for (const row of sortedRows) {
    const total =
      totalsMap.get(row.currencyCode) ?? {
        currencyCode: row.currencyCode,
        activeLoanCount: 0,
        outstandingPrincipalMinor: 0n,
        outstandingInterestMinor: 0n,
        outstandingFeesMinor: 0n,
        outstandingPenaltiesMinor: 0n,
        outstandingTotalMinor: 0n,
        savingsBalanceMinor: 0n,
        disbursedThisMonthMinor: 0n,
        buckets: emptyBuckets(),
        totalParMinor: 0n,
        totalParPercent: 0,
      };
    total.activeLoanCount += row.activeLoanCount;
    total.outstandingPrincipalMinor += row.outstandingPrincipalMinor;
    total.outstandingInterestMinor += row.outstandingInterestMinor;
    total.outstandingFeesMinor += row.outstandingFeesMinor;
    total.outstandingPenaltiesMinor += row.outstandingPenaltiesMinor;
    total.outstandingTotalMinor += row.outstandingTotalMinor;
    total.savingsBalanceMinor += row.savingsBalanceMinor;
    total.disbursedThisMonthMinor += row.disbursedThisMonthMinor;
    for (const bucket of branchPortfolioBucketOrder) {
      total.buckets[bucket] += row.buckets[bucket].amountMinor;
    }
    total.totalParMinor += row.totalParMinor;
    total.totalParPercent = percentOf(total.totalParMinor, total.outstandingTotalMinor);
    totalsMap.set(row.currencyCode, total);
  }

  return {
    asOfDate,
    rows: sortedRows,
    totals: [...totalsMap.values()].sort((left, right) => left.currencyCode.localeCompare(right.currencyCode)),
  };
}

export async function loadDisbursalCohortReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  params: {
    startDate?: string | null;
    endDate?: string | null;
    loanOfficerId?: string | null;
  },
): Promise<DisbursalCohortReport> {
  const range = normalizeDateRange(
    parseOptionalDateInput(params.startDate),
    parseOptionalDateInput(params.endDate),
  );
  const loanOfficerId = normalizeString(params.loanOfficerId);

  const loans = await prisma.loan.findMany({
    where: {
      office: { organizationId: scope.organizationId },
      ...officeWhere(scope),
      disbursedOn: {
        not: null,
        ...(range.startDate ? { gte: range.startDate } : {}),
        ...(range.endDate ? { lte: range.endDate } : {}),
      },
      ...(loanOfficerId ? { loanOfficerId } : {}),
    },
    select: {
      disbursedOn: true,
      denominationCurrency: true,
      principalMinor: true,
    },
  });

  const rows = new Map<string, DisbursalCohortRow>();
  for (const loan of loans) {
    if (!loan.disbursedOn) continue;
    const period = isoMonth(loan.disbursedOn);
    const key = `${period}:${loan.denominationCurrency}`;
    const row =
      rows.get(key) ?? {
        period,
        currencyCode: loan.denominationCurrency,
        loanCount: 0,
        principalMinor: 0n,
      };
    row.loanCount += 1;
    row.principalMinor += loan.principalMinor;
    rows.set(key, row);
  }

  const sortedRows = [...rows.values()].sort(
    (left, right) => right.period.localeCompare(left.period) || left.currencyCode.localeCompare(right.currencyCode),
  );

  const totalsMap = new Map<string, DisbursalCohortTotal>();
  for (const row of sortedRows) {
    const total =
      totalsMap.get(row.currencyCode) ?? {
        currencyCode: row.currencyCode,
        loanCount: 0,
        principalMinor: 0n,
      };
    total.loanCount += row.loanCount;
    total.principalMinor += row.principalMinor;
    totalsMap.set(row.currencyCode, total);
  }

  return {
    startDate: range.startDate,
    endDate: range.endDate,
    loanOfficerId,
    rows: sortedRows,
    totals: [...totalsMap.values()].sort((left, right) => left.currencyCode.localeCompare(right.currencyCode)),
  };
}

export async function loadActiveLoansReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  params: {
    officeId?: string | null;
    loanOfficerId?: string | null;
  },
): Promise<ActiveLoansReport> {
  const officeId = normalizeString(params.officeId);
  const loanOfficerId = normalizeString(params.loanOfficerId);
  const loans = await loadPortfolioLoans(
    prisma,
    scope,
    {
      ...(officeId ? { officeId } : {}),
      ...(loanOfficerId ? { loanOfficerId } : {}),
    },
    { statuses: reportableLoanStatuses },
    startOfUtcDay(new Date()),
  );

  const rows = loans
    .map<ActiveLoanRow>((loan) => ({
      loanId: loan.id,
      accountNumber: loan.accountNumber,
      borrowerName: loan.borrowerName,
      officeId: loan.officeId,
      officeName: loan.officeName,
      loanOfficerId: loan.loanOfficerId,
      loanOfficerName: loan.loanOfficerName,
      productName: loan.productName,
      currencyCode: loan.denominationCurrency,
      status: loan.status,
      principalMinor: loan.principalMinor,
      annualRateBps: loan.annualRateBps,
      disbursedOn: loan.disbursedOn,
      maturesOn: loan.maturesOn,
      principalRepaidMinor: loan.principalRepaidMinor,
      outstandingPrincipalMinor: loan.outstandingPrincipalMinor,
      overduePrincipalMinor: loan.overduePrincipalMinor,
      interestRepaidMinor: loan.interestRepaidMinor,
      outstandingInterestMinor: loan.outstandingInterestMinor,
      overdueInterestMinor: loan.overdueInterestMinor,
      feesRepaidMinor: loan.feesRepaidMinor,
      outstandingFeesMinor: loan.outstandingFeesMinor,
      overdueFeesMinor: loan.overdueFeesMinor,
      penaltiesRepaidMinor: loan.penaltiesRepaidMinor,
      outstandingPenaltiesMinor: loan.outstandingPenaltiesMinor,
      overduePenaltiesMinor: loan.overduePenaltiesMinor,
      outstandingTotalMinor: loan.outstandingTotalMinor,
      daysOverdue: loan.daysOverdue,
      overdueSince: loan.overdueSince,
      agingBucket: loan.agingBucket,
    }))
    .sort(
      (left, right) =>
        left.officeName.localeCompare(right.officeName) ||
        left.borrowerName.localeCompare(right.borrowerName) ||
        left.accountNumber.localeCompare(right.accountNumber),
    );

  const totalsMap = new Map<string, ActiveLoanTotal>();
  for (const row of rows) {
    const total =
      totalsMap.get(row.currencyCode) ?? {
        currencyCode: row.currencyCode,
        loanCount: 0,
        principalMinor: 0n,
        outstandingPrincipalMinor: 0n,
        outstandingTotalMinor: 0n,
      };
    total.loanCount += 1;
    total.principalMinor += row.principalMinor;
    total.outstandingPrincipalMinor += row.outstandingPrincipalMinor;
    total.outstandingTotalMinor += row.outstandingTotalMinor;
    totalsMap.set(row.currencyCode, total);
  }

  return {
    officeId,
    loanOfficerId,
    rows,
    totals: [...totalsMap.values()].sort((left, right) => left.currencyCode.localeCompare(right.currencyCode)),
  };
}

export async function loadActiveLoanFundBreakdownReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  params: {
    officeId?: string | null;
    loanOfficerId?: string | null;
  },
): Promise<ActiveLoanFundBreakdownReport> {
  const officeId = normalizeString(params.officeId);
  const loanOfficerId = normalizeString(params.loanOfficerId);
  const loans = await prisma.loan.findMany({
    where: {
      office: { organizationId: scope.organizationId },
      ...loanScopeWhere(scope),
      ...(officeId ? { officeId } : {}),
      ...(!scope.officerUserId && loanOfficerId ? { loanOfficerId } : {}),
      status: { in: reportableLoanStatuses },
    },
    select: {
      fundId: true,
      denominationCurrency: true,
      principalMinor: true,
      fund: { select: { name: true } },
    },
  });

  const rows = new Map<string, ActiveLoanFundBreakdownRow>();
  for (const loan of loans) {
    const fundName = loan.fund?.name ?? "Unassigned";
    const key = `${loan.fundId ?? "UNASSIGNED"}:${loan.denominationCurrency}`;
    const row =
      rows.get(key) ?? {
        fundId: loan.fundId,
        fundName,
        currencyCode: loan.denominationCurrency,
        loanCount: 0,
        principalMinor: 0n,
      };
    row.loanCount += 1;
    row.principalMinor += loan.principalMinor;
    rows.set(key, row);
  }

  const sortedRows = [...rows.values()].sort(
    (left, right) =>
      compareBigIntDesc(left.principalMinor, right.principalMinor) ||
      right.loanCount - left.loanCount ||
      left.fundName.localeCompare(right.fundName) ||
      left.currencyCode.localeCompare(right.currencyCode),
  );

  const totalsMap = new Map<string, ActiveLoanFundBreakdownTotal>();
  for (const row of sortedRows) {
    const total =
      totalsMap.get(row.currencyCode) ?? {
        currencyCode: row.currencyCode,
        loanCount: 0,
        principalMinor: 0n,
      };
    total.loanCount += row.loanCount;
    total.principalMinor += row.principalMinor;
    totalsMap.set(row.currencyCode, total);
  }

  return {
    officeId,
    loanOfficerId,
    rows: sortedRows,
    totals: [...totalsMap.values()].sort((left, right) => left.currencyCode.localeCompare(right.currencyCode)),
  };
}

export async function loadDisbursalReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  params: {
    officeId?: string | null;
    loanOfficerId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  },
): Promise<DisbursalReport> {
  const officeId = normalizeString(params.officeId);
  const loanOfficerId = normalizeString(params.loanOfficerId);
  const range = normalizeDateRange(
    parseOptionalDateInput(params.startDate),
    parseOptionalDateInput(params.endDate),
  );

  const loans = await prisma.loan.findMany({
    where: {
      office: { organizationId: scope.organizationId },
      ...officeWhere(scope),
      ...(officeId ? { officeId } : {}),
      ...(loanOfficerId ? { loanOfficerId } : {}),
      disbursedOn: {
        not: null,
        ...(range.startDate ? { gte: range.startDate } : {}),
        ...(range.endDate ? { lte: range.endDate } : {}),
      },
    },
    select: {
      id: true,
      accountNumber: true,
      officeId: true,
      denominationCurrency: true,
      status: true,
      principalMinor: true,
      disbursedOn: true,
      office: { select: { name: true } },
      loanOfficerId: true,
      loanOfficer: { select: { name: true } },
      product: { select: { name: true } },
      client: { select: { firstName: true, middleName: true, lastName: true } },
      group: { select: { name: true } },
    },
    orderBy: [{ disbursedOn: "desc" }, { createdAt: "desc" }],
  });

  const rows: DisbursalReportRow[] = [];
  for (const loan of loans) {
    if (!loan.disbursedOn) continue;
    rows.push({
      loanId: loan.id,
      accountNumber: loan.accountNumber,
      borrowerName: loan.client
        ? formatHumanName(loan.client.firstName, loan.client.middleName, loan.client.lastName)
        : loan.group?.name ?? "Unknown group",
      officeId: loan.officeId,
      officeName: loan.office.name,
      loanOfficerId: loan.loanOfficerId,
      loanOfficerName: loan.loanOfficer?.name ?? "Unassigned",
      productName: loan.product.name,
      currencyCode: loan.denominationCurrency,
      status: loan.status,
      principalMinor: loan.principalMinor,
      disbursedOn: loan.disbursedOn,
    });
  }

  const totalsMap = new Map<string, DisbursalReportTotal>();
  for (const row of rows) {
    const total =
      totalsMap.get(row.currencyCode) ?? {
        currencyCode: row.currencyCode,
        loanCount: 0,
        principalMinor: 0n,
      };
    total.loanCount += 1;
    total.principalMinor += row.principalMinor;
    totalsMap.set(row.currencyCode, total);
  }

  return {
    officeId,
    loanOfficerId,
    startDate: range.startDate,
    endDate: range.endDate,
    rows,
    totals: [...totalsMap.values()].sort((left, right) => left.currencyCode.localeCompare(right.currencyCode)),
  };
}

/**
 * Actual collections/receipts ledger — matches iLend's "Jumpstart Collection Report" (a log
 * of every repayment transaction posted, with its principal/interest/fees/penalties
 * breakdown, receipt reference, and posting date). This is distinct from the
 * "Collection by Officer" report, which is forward-looking (expected/due amounts, matching
 * iLend's separate "Expected daily collection per officer" report).
 */
export async function loadCollectionsReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  params: { officeId?: string | null; startDate?: string | null; endDate?: string | null },
): Promise<CollectionsReport> {
  const officeId = normalizeString(params.officeId);
  const range = normalizeDateRange(
    parseOptionalDateInput(params.startDate),
    parseOptionalDateInput(params.endDate),
  );

  const transactions = await prisma.loanTransaction.findMany({
    where: {
      transactionType: { in: transactionTypeVariants("REPAYMENT") },
      loan: {
        office: { organizationId: scope.organizationId },
        ...loanScopeWhere(scope),
        ...(officeId ? { officeId } : {}),
      },
      ...(range.startDate ? { businessDate: { gte: range.startDate } } : {}),
      ...(range.endDate ? { businessDate: { lte: range.endDate } } : {}),
    },
    select: {
      id: true,
      businessDate: true,
      createdAt: true,
      externalReference: true,
      denominationAmountMinor: true,
      allocations: { select: { principalMinor: true, interestMinor: true, feesMinor: true, penaltiesMinor: true } },
      loan: {
        select: {
          id: true,
          accountNumber: true,
          officeId: true,
          denominationCurrency: true,
          office: { select: { name: true } },
          product: { select: { name: true } },
          client: { select: { firstName: true, middleName: true, lastName: true } },
          group: { select: { name: true } },
        },
      },
    },
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
  });

  const rows: CollectionsReportRow[] = transactions.map((transaction) => {
    const principalMinor = sumBigIntField(transaction.allocations, "principalMinor");
    const interestMinor = sumBigIntField(transaction.allocations, "interestMinor");
    const feesMinor = sumBigIntField(transaction.allocations, "feesMinor");
    const penaltiesMinor = sumBigIntField(transaction.allocations, "penaltiesMinor");
    const allocatedMinor = principalMinor + interestMinor + feesMinor + penaltiesMinor;
    const othersMinor = transaction.denominationAmountMinor > allocatedMinor ? transaction.denominationAmountMinor - allocatedMinor : 0n;
    return {
      transactionId: transaction.id,
      loanId: transaction.loan.id,
      accountNumber: transaction.loan.accountNumber,
      borrowerName: transaction.loan.client
        ? formatHumanName(transaction.loan.client.firstName, transaction.loan.client.middleName, transaction.loan.client.lastName)
        : transaction.loan.group?.name ?? "Unknown group",
      borrowerType: transaction.loan.client ? "Client" : "Group",
      officeId: transaction.loan.officeId,
      officeName: transaction.loan.office.name,
      groupName: transaction.loan.group?.name ?? null,
      productName: transaction.loan.product.name,
      currencyCode: transaction.loan.denominationCurrency,
      principalMinor,
      interestMinor,
      feesMinor,
      penaltiesMinor,
      othersMinor,
      totalMinor: transaction.denominationAmountMinor,
      receiptNumber: transaction.externalReference,
      businessDate: transaction.businessDate,
      createdAt: transaction.createdAt,
    };
  });

  const totalsMap = new Map<string, CollectionsReportTotal>();
  for (const row of rows) {
    const total =
      totalsMap.get(row.currencyCode) ?? {
        currencyCode: row.currencyCode,
        transactionCount: 0,
        principalMinor: 0n,
        interestMinor: 0n,
        feesMinor: 0n,
        penaltiesMinor: 0n,
        othersMinor: 0n,
        totalMinor: 0n,
      };
    total.transactionCount += 1;
    total.principalMinor += row.principalMinor;
    total.interestMinor += row.interestMinor;
    total.feesMinor += row.feesMinor;
    total.penaltiesMinor += row.penaltiesMinor;
    total.othersMinor += row.othersMinor;
    total.totalMinor += row.totalMinor;
    totalsMap.set(row.currencyCode, total);
  }

  return {
    officeId,
    startDate: range.startDate,
    endDate: range.endDate,
    rows,
    totals: [...totalsMap.values()].sort((left, right) => left.currencyCode.localeCompare(right.currencyCode)),
  };
}

function sumBigIntField<K extends string>(items: Array<Record<K, bigint>>, key: K): bigint {
  return items.reduce((sum, item) => sum + item[key], 0n);
}

export function collectionsReportCsv(report: CollectionsReport) {
  return rowsToCsv(
    report.rows.map((row) => ({
      Date: isoDate(row.businessDate),
      Receipt: row.receiptNumber ?? "",
      Client: row.borrowerName,
      "Client Type": row.borrowerType,
      "Loan Account No.": row.accountNumber,
      "Office/Branch": row.officeName,
      Group: row.groupName ?? "",
      Product: row.productName,
      Currency: row.currencyCode,
      Principal: row.principalMinor.toString(),
      Interest: row.interestMinor.toString(),
      Fees: row.feesMinor.toString(),
      Penalty: row.penaltiesMinor.toString(),
      Others: row.othersMinor.toString(),
      "Total Receipt Amount": row.totalMinor.toString(),
    })),
    [
      "Date",
      "Receipt",
      "Client",
      "Client Type",
      "Loan Account No.",
      "Office/Branch",
      "Group",
      "Product",
      "Currency",
      "Principal",
      "Interest",
      "Fees",
      "Penalty",
      "Others",
      "Total Receipt Amount",
    ],
  );
}

export async function loadOutstandingBalancesReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  params: {
    officeId?: string | null;
    loanOfficerId?: string | null;
    currencyCode?: string | null;
  },
): Promise<OutstandingBalancesReport> {
  const officeId = normalizeString(params.officeId);
  const loanOfficerId = normalizeString(params.loanOfficerId);
  const currencyCode = normalizeString(params.currencyCode)?.toUpperCase() ?? null;

  const loans = await prisma.loan.findMany({
    where: {
      office: { organizationId: scope.organizationId },
      ...officeWhere(scope),
      status: { in: reportableLoanStatuses },
      ...(officeId ? { officeId } : {}),
      ...(loanOfficerId ? { loanOfficerId } : {}),
      ...(currencyCode ? { denominationCurrency: currencyCode } : {}),
    },
    select: {
      id: true,
      accountNumber: true,
      officeId: true,
      denominationCurrency: true,
      status: true,
      disbursedOn: true,
      maturesOn: true,
      office: { select: { name: true } },
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
      },
    },
  });

  const rows = loans
    .map<OutstandingBalanceRow>((loan) => {
      const principalOutstanding = loan.installments.reduce(
        (sum, installment) => sum + principalOutstandingMinor(installment),
        0n,
      );
      const interestOutstanding = loan.installments.reduce(
        (sum, installment) => sum + interestOutstandingMinor(installment),
        0n,
      );
      const feesOutstanding = loan.installments.reduce(
        (sum, installment) => sum + feesOutstandingMinor(installment),
        0n,
      );
      const penaltiesOutstanding = loan.installments.reduce(
        (sum, installment) => sum + penaltiesOutstandingMinor(installment),
        0n,
      );
      const totalOutstanding =
        principalOutstanding +
        interestOutstanding +
        feesOutstanding +
        penaltiesOutstanding;

      return {
        loanId: loan.id,
        accountNumber: loan.accountNumber,
        borrowerName: loan.client
          ? formatHumanName(loan.client.firstName, loan.client.middleName, loan.client.lastName)
          : loan.group?.name ?? "Unknown group",
        officeId: loan.officeId,
        officeName: loan.office.name,
        loanOfficerId: loan.loanOfficerId,
        loanOfficerName: loan.loanOfficer?.name ?? "Unassigned",
        currencyCode: loan.denominationCurrency,
        status: loan.status,
        disbursedOn: loan.disbursedOn,
        maturesOn: loan.maturesOn,
        principalOutstandingMinor: principalOutstanding,
        interestOutstandingMinor: interestOutstanding,
        feesOutstandingMinor: feesOutstanding,
        penaltiesOutstandingMinor: penaltiesOutstanding,
        totalOutstandingMinor: totalOutstanding,
      };
    })
    .filter((row) => row.totalOutstandingMinor > 0n)
    .sort(
      (left, right) =>
        compareBigIntDesc(left.totalOutstandingMinor, right.totalOutstandingMinor) ||
        left.officeName.localeCompare(right.officeName) ||
        left.accountNumber.localeCompare(right.accountNumber),
    );

  const totalsMap = new Map<string, OutstandingBalanceTotal>();
  for (const row of rows) {
    const total =
      totalsMap.get(row.currencyCode) ?? {
        currencyCode: row.currencyCode,
        loanCount: 0,
        principalOutstandingMinor: 0n,
        interestOutstandingMinor: 0n,
        feesOutstandingMinor: 0n,
        penaltiesOutstandingMinor: 0n,
        totalOutstandingMinor: 0n,
      };
    total.loanCount += 1;
    total.principalOutstandingMinor += row.principalOutstandingMinor;
    total.interestOutstandingMinor += row.interestOutstandingMinor;
    total.feesOutstandingMinor += row.feesOutstandingMinor;
    total.penaltiesOutstandingMinor += row.penaltiesOutstandingMinor;
    total.totalOutstandingMinor += row.totalOutstandingMinor;
    totalsMap.set(row.currencyCode, total);
  }

  return {
    officeId,
    loanOfficerId,
    currencyCode,
    rows,
    totals: [...totalsMap.values()].sort((left, right) => left.currencyCode.localeCompare(right.currencyCode)),
  };
}

export async function loadClientListingReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  params: { officeId?: string | null },
): Promise<ClientListingReport> {
  const officeId = normalizeString(params.officeId);
  const clients = await prisma.client.findMany({
    where: {
      organizationId: scope.organizationId,
      ...clientScopeWhere(scope),
      ...(officeId ? { officeId } : {}),
    },
    select: {
      id: true,
      accountNumber: true,
      firstName: true,
      middleName: true,
      lastName: true,
      mobileNumber: true,
      externalId: true,
      status: true,
      kycStatus: true,
      dateOfBirth: true,
      submittedOn: true,
      activatedOn: true,
      createdAt: true,
      officeId: true,
      office: { select: { name: true } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  return {
    officeId,
    rows: clients.map<ClientListingRow>((client) => ({
      id: client.id,
      accountNumber: client.accountNumber,
      firstName: client.firstName,
      middleName: client.middleName,
      lastName: client.lastName,
      fullName: formatHumanName(client.firstName, client.middleName, client.lastName),
      mobileNumber: client.mobileNumber,
      externalId: client.externalId,
      officeId: client.officeId,
      officeName: client.office.name,
      status: client.status,
      kycStatus: client.kycStatus,
      dateOfBirth: client.dateOfBirth,
      joinedOn: client.activatedOn ?? client.submittedOn ?? client.createdAt,
    })),
  };
}

export function collectionByOfficerReportCsv(report: CollectionByOfficerReport) {
  return rowsToCsv(
    report.rows.map((row) => ({
      "Loan Officer": row.officerName,
      Currency: row.currencyCode,
      "Active Loans": String(row.loanCount),
      "Due Today": row.dueTodayMinor.toString(),
      "Overdue Arrears": row.overdueArrearsMinor.toString(),
      "Total Expected": row.expectedTotalMinor.toString(),
    })),
    [
      "Loan Officer",
      "Currency",
      "Active Loans",
      "Due Today",
      "Overdue Arrears",
      "Total Expected",
    ],
  );
}

export function unassignedLoansReportCsv(report: UnassignedLoansReport) {
  return rowsToCsv(
    report.rows.map((row) => ({
      Client: row.borrowerName,
      "Loan Account No.": row.accountNumber,
      "Client Type": row.borrowerType,
      "Office/Branch": row.officeName,
      Status: formatLoanStatus(row.status),
      "Loan Amount": row.principalMinor.toString(),
      "Disbursed Date": row.disbursedOn ? isoDate(row.disbursedOn) : "",
    })),
    [
      "Client",
      "Loan Account No.",
      "Client Type",
      "Office/Branch",
      "Status",
      "Loan Amount",
      "Disbursed Date",
    ],
  );
}

export function branchPortfolioReportCsv(report: BranchPortfolioReport) {
  return rowsToCsv(
    report.rows.map((row) => ({
      "Loan Officer": row.loanOfficerName,
      Currency: row.currencyCode,
      "Number of Loans": String(row.activeLoanCount),
      "Principal Outstanding": row.outstandingPrincipalMinor.toString(),
      "Interest Outstanding": row.outstandingInterestMinor.toString(),
      "Fees Outstanding": row.outstandingFeesMinor.toString(),
      "Penalties Outstanding": row.outstandingPenaltiesMinor.toString(),
      "Total Outstanding": row.outstandingTotalMinor.toString(),
      "Savings Balance": row.savingsBalanceMinor.toString(),
      "1-30 Days Outstanding": row.buckets["1_30"].amountMinor.toString(),
      "1-30 Days PAR %": formatPercent(row.buckets["1_30"].percent),
      "31-60 Days Outstanding": row.buckets["31_60"].amountMinor.toString(),
      "31-60 Days PAR %": formatPercent(row.buckets["31_60"].percent),
      "61-90 Days Outstanding": row.buckets["61_90"].amountMinor.toString(),
      "61-90 Days PAR %": formatPercent(row.buckets["61_90"].percent),
      "91-180 Days Outstanding": row.buckets["91_180"].amountMinor.toString(),
      "91-180 Days PAR %": formatPercent(row.buckets["91_180"].percent),
      "180+ Days Outstanding": row.buckets["180_PLUS"].amountMinor.toString(),
      "180+ Days PAR %": formatPercent(row.buckets["180_PLUS"].percent),
      "Total PAR": row.totalParMinor.toString(),
      "Total PAR %": formatPercent(row.totalParPercent),
      "Disbursed This Month": row.disbursedThisMonthMinor.toString(),
    })),
    [
      "Loan Officer",
      "Currency",
      "Number of Loans",
      "Principal Outstanding",
      "Interest Outstanding",
      "Fees Outstanding",
      "Penalties Outstanding",
      "Total Outstanding",
      "Savings Balance",
      "1-30 Days Outstanding",
      "1-30 Days PAR %",
      "31-60 Days Outstanding",
      "31-60 Days PAR %",
      "61-90 Days Outstanding",
      "61-90 Days PAR %",
      "91-180 Days Outstanding",
      "91-180 Days PAR %",
      "180+ Days Outstanding",
      "180+ Days PAR %",
      "Total PAR",
      "Total PAR %",
      "Disbursed This Month",
    ],
  );
}

export function disbursalCohortReportCsv(report: DisbursalCohortReport) {
  return rowsToCsv(
    report.rows.map((row) => ({
      Period: row.period,
      Currency: row.currencyCode,
      "Loans Disbursed": String(row.loanCount),
      "Total Principal": row.principalMinor.toString(),
    })),
    ["Period", "Currency", "Loans Disbursed", "Total Principal"],
  );
}

export function activeLoansReportCsv(report: ActiveLoansReport) {
  const columns = [
    "Office/Branch",
    "Currency",
    "Loan Officer",
    "Client",
    "Loan Account No.",
    "Product",
    "Status",
    "Loan Amount",
    "Annual Nominal Interest Rate",
    "Disbursed Date",
    "Expected Matured On",
    "Principal Repaid",
    "Principal Outstanding",
    "Principal Overdue",
    "Interest Repaid",
    "Interest Outstanding",
    "Interest Overdue",
    "Fees Repaid",
    "Fees Outstanding",
    "Fees Overdue",
    "Penalties Repaid",
    "Penalties Outstanding",
    "Penalties Overdue",
    "Total Outstanding",
    "Days Overdue",
    "Overdue Since",
    "Aging Bucket",
  ] as const;
  return rowsToCsv(
    report.rows.map((row) => ({
      "Office/Branch": row.officeName,
      Currency: row.currencyCode,
      "Loan Officer": row.loanOfficerName,
      Client: row.borrowerName,
      "Loan Account No.": row.accountNumber,
      Product: row.productName,
      Status: formatLoanStatus(row.status),
      "Loan Amount": row.principalMinor.toString(),
      "Annual Nominal Interest Rate": (row.annualRateBps / 100).toFixed(2),
      "Disbursed Date": row.disbursedOn ? isoDate(row.disbursedOn) : "",
      "Expected Matured On": row.maturesOn ? isoDate(row.maturesOn) : "",
      "Principal Repaid": row.principalRepaidMinor.toString(),
      "Principal Outstanding": row.outstandingPrincipalMinor.toString(),
      "Principal Overdue": row.overduePrincipalMinor.toString(),
      "Interest Repaid": row.interestRepaidMinor.toString(),
      "Interest Outstanding": row.outstandingInterestMinor.toString(),
      "Interest Overdue": row.overdueInterestMinor.toString(),
      "Fees Repaid": row.feesRepaidMinor.toString(),
      "Fees Outstanding": row.outstandingFeesMinor.toString(),
      "Fees Overdue": row.overdueFeesMinor.toString(),
      "Penalties Repaid": row.penaltiesRepaidMinor.toString(),
      "Penalties Outstanding": row.outstandingPenaltiesMinor.toString(),
      "Penalties Overdue": row.overduePenaltiesMinor.toString(),
      "Total Outstanding": row.outstandingTotalMinor.toString(),
      "Days Overdue": String(row.daysOverdue),
      "Overdue Since": row.overdueSince ? isoDate(row.overdueSince) : "",
      "Aging Bucket": row.agingBucket,
    })),
    columns,
  );
}

export function disbursalReportCsv(report: DisbursalReport) {
  return rowsToCsv(
    report.rows.map((row) => ({
      "Disbursed Date": isoDate(row.disbursedOn),
      Client: row.borrowerName,
      "Loan Account No.": row.accountNumber,
      "Office/Branch": row.officeName,
      "Loan Officer": row.loanOfficerName,
      Product: row.productName,
      Status: formatLoanStatus(row.status),
      Currency: row.currencyCode,
      "Loan Amount": row.principalMinor.toString(),
    })),
    [
      "Disbursed Date",
      "Client",
      "Loan Account No.",
      "Office/Branch",
      "Loan Officer",
      "Product",
      "Status",
      "Currency",
      "Loan Amount",
    ],
  );
}

export function outstandingBalancesReportCsv(report: OutstandingBalancesReport) {
  return rowsToCsv(
    report.rows.map((row) => ({
      Client: row.borrowerName,
      "Loan Account No.": row.accountNumber,
      "Office/Branch": row.officeName,
      "Loan Officer": row.loanOfficerName,
      Status: formatLoanStatus(row.status),
      "Principal Outstanding": row.principalOutstandingMinor.toString(),
      "Interest Outstanding": row.interestOutstandingMinor.toString(),
      "Fees Outstanding": row.feesOutstandingMinor.toString(),
      "Penalties Outstanding": row.penaltiesOutstandingMinor.toString(),
      "Total Outstanding": row.totalOutstandingMinor.toString(),
      "Disbursed Date": row.disbursedOn ? isoDate(row.disbursedOn) : "",
    })),
    [
      "Client",
      "Loan Account No.",
      "Office/Branch",
      "Loan Officer",
      "Status",
      "Principal Outstanding",
      "Interest Outstanding",
      "Fees Outstanding",
      "Penalties Outstanding",
      "Total Outstanding",
      "Disbursed Date",
    ],
  );
}

export function clientListingCsv(report: ClientListingReport) {
  return rowsToCsv(
    report.rows.map((client) => ({
      "Client Account No.": client.accountNumber,
      "First Name": client.firstName,
      "Middle Name": client.middleName ?? "",
      "Last Name": client.lastName,
      "Client Name": client.fullName,
      "Mobile Number": client.mobileNumber ?? "",
      "External ID": client.externalId ?? "",
      "Office/Branch": client.officeName,
      Status: client.status,
      "KYC Status": client.kycStatus,
      "Date of Birth": client.dateOfBirth ? isoDate(client.dateOfBirth) : "",
      "Joined On": isoDate(client.joinedOn),
    })),
    [
      "Client Account No.",
      "First Name",
      "Middle Name",
      "Last Name",
      "Client Name",
      "Mobile Number",
      "External ID",
      "Office/Branch",
      "Status",
      "KYC Status",
      "Date of Birth",
      "Joined On",
    ],
  );
}

export function formatReportDate(date: Date | null) {
  return date ? ugDateFormatter.format(date) : "—";
}

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatLoanStatus(status: LoanStatus) {
  return status.replaceAll("_", " ");
}

export function loanStatusTone(status: LoanStatus) {
  switch (status) {
    case "ACTIVE":
      return "up-to-date";
    case "IN_ARREARS":
      return "in-arrears";
    default:
      return "review";
  }
}

export function clientStatusTone(status: ClientStatus) {
  return status === "ACTIVE" ? "up-to-date" : "review";
}

export function kycStatusTone(status: KycStatus) {
  return status === "VERIFIED" ? "up-to-date" : status === "REJECTED" ? "in-arrears" : "review";
}

export function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function ensureCollectionRow(
  rows: Map<string, CollectionByOfficerRow>,
  officerId: string | null,
  officerName: string | null,
  currencyCode: string,
) {
  const key = `${officerId ?? "unassigned"}:${currencyCode}`;
  const existing = rows.get(key);
  if (existing) return existing;

  const created: CollectionByOfficerRow = {
    officerId,
    officerName: officerName ?? "Unassigned",
    currencyCode,
    loanCount: 0,
    dueTodayMinor: 0n,
    overdueArrearsMinor: 0n,
    expectedTotalMinor: 0n,
  };
  rows.set(key, created);
  return created;
}

function principalOutstandingMinor(installment: InstallmentAmounts) {
  return positiveOutstanding(
    installment.principalDueMinor,
    installment.principalPaidMinor,
    installment.principalWaivedMinor,
  );
}

function interestOutstandingMinor(installment: InstallmentAmounts) {
  return positiveOutstanding(
    installment.interestDueMinor,
    installment.interestPaidMinor,
    installment.interestWaivedMinor,
  );
}

function feesOutstandingMinor(installment: InstallmentAmounts) {
  return positiveOutstanding(
    installment.feesDueMinor,
    installment.feesPaidMinor,
    installment.feesWaivedMinor,
  );
}

function penaltiesOutstandingMinor(installment: InstallmentAmounts) {
  return positiveOutstanding(
    installment.penaltiesDueMinor,
    installment.penaltiesPaidMinor,
    installment.penaltiesWaivedMinor,
  );
}

function totalOutstandingMinor(installment: InstallmentAmounts) {
  return (
    principalOutstandingMinor(installment) +
    interestOutstandingMinor(installment) +
    feesOutstandingMinor(installment) +
    penaltiesOutstandingMinor(installment)
  );
}

function positiveOutstanding(dueMinor: bigint, paidMinor: bigint, waivedMinor: bigint) {
  const remaining = dueMinor - paidMinor - waivedMinor;
  return remaining > 0n ? remaining : 0n;
}

function percentOf(amountMinor: bigint, totalMinor: bigint) {
  if (totalMinor <= 0n) return 0;
  return (Number(amountMinor) / Number(totalMinor)) * 100;
}

function summarizeCurrencyTotals(items: Array<{ currencyCode: string; amountMinor: bigint }>) {
  const totals = new Map<string, bigint>();
  for (const item of items) {
    totals.set(item.currencyCode, (totals.get(item.currencyCode) ?? 0n) + item.amountMinor);
  }
  return [...totals.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([currencyCode, amountMinor]) => ({ currencyCode, amountMinor }));
}

function formatHumanName(firstName: string, middleName: string | null, lastName: string) {
  return [firstName, middleName, lastName].filter(Boolean).join(" ");
}

function parseDateInput(value?: string | null, fallback = new Date()) {
  return parseOptionalDateInput(value) ?? startOfUtcDay(fallback);
}

function parseOptionalDateInput(value?: string | null) {
  const normalized = normalizeString(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function normalizeDateRange(startDate: Date | null, endDate: Date | null) {
  if (startDate && endDate && startDate > endDate) {
    return { startDate: endDate, endDate: startDate };
  }
  return { startDate, endDate };
}

function normalizeString(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function sameUtcDate(left: Date, right: Date) {
  return isoDate(left) === isoDate(right);
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function isoMonth(date: Date) {
  return isoDate(date).slice(0, 7);
}

function compareBigIntDesc(left: bigint, right: bigint) {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}
