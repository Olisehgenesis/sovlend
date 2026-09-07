import { Prisma, type PrismaClient, type LoanStatus } from "@prisma/client";

import { officeWhere, type UserDataScope } from "@/modules/identity/application/data-scope";

const DAY_MS = 86_400_000;
const feeStatuses = ["PAID", "PENDING", "WAIVED"] as const;

export type SearchParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

export type GroupPortfolioRow = {
  id: string;
  accountNumber: string;
  name: string;
  status: string;
  officerName: string | null;
  memberCount: number;
  savingsAccountCount: number;
  savingsBalanceMinor: bigint;
  currencyCode: string;
  loanCount: number;
  activeLoanCount: number;
  arrearsLoanCount: number;
  closedLoanCount: number;
  otherLoanCount: number;
  loanPrincipalMinor: bigint;
  outstandingPrincipalMinor: bigint;
};

export type GroupPortfolioReport = {
  generatedAt: string;
  rows: GroupPortfolioRow[];
  totals: {
    groupCount: number;
    memberCount: number;
    savingsAccountCount: number;
    savingsBalanceMinor: bigint;
    loanCount: number;
    activeLoanCount: number;
    arrearsLoanCount: number;
    closedLoanCount: number;
    otherLoanCount: number;
    loanPrincipalMinor: bigint;
    outstandingPrincipalMinor: bigint;
    currencyCode: string;
  };
};

export type GuarantorExposureLoan = {
  id: string;
  accountNumber: string;
  borrowerName: string;
  status: string;
  outstandingPrincipalMinor: bigint;
  currencyCode: string;
};

export type GuarantorExposureRow = {
  key: string;
  displayName: string;
  phone: string;
  loanCount: number;
  arrearsLoanCount: number;
  concentrationRisk: boolean;
  totalOutstandingMinor: bigint;
  currencyCode: string;
  loans: GuarantorExposureLoan[];
};

export type GuarantorExposureReport = {
  generatedAt: string;
  rows: GuarantorExposureRow[];
  summary: {
    repeatedGuarantorCount: number;
    concentrationRiskCount: number;
    loansCovered: number;
    totalOutstandingMinor: bigint;
    currencyCode: string;
  };
};

export type FeeRevenueTypeRow = {
  name: string;
  currencyCode: string;
  counts: Record<(typeof feeStatuses)[number], number>;
  amounts: Record<(typeof feeStatuses)[number], bigint>;
  totalMinor: bigint;
};

export type FeeRevenueReport = {
  generatedAt: string;
  dateBasis: "dueOn";
  startDate: string;
  endDate: string;
  rows: FeeRevenueTypeRow[];
  totals: {
    chargeCount: number;
    paidMinor: bigint;
    pendingMinor: bigint;
    waivedMinor: bigint;
    currencyCode: string;
  };
  undated: {
    chargeCount: number;
    rows: FeeRevenueTypeRow[];
    totals: {
      paidMinor: bigint;
      pendingMinor: bigint;
      waivedMinor: bigint;
      currencyCode: string;
    };
  };
};

export type DocumentCategoryStatus = {
  key: string;
  label: string;
  matchedNames: string[];
  present: boolean;
};

export type DocumentCompletenessRow = {
  id: string;
  accountNumber: string;
  borrowerName: string;
  borrowerAccountNumber: string | null;
  status: LoanStatus;
  documentCount: number;
  guarantorCount: number;
  matchedCoreCount: number;
  missingAllDocuments: boolean;
  presentCategories: string[];
  missingCategories: string[];
  categoryStatuses: DocumentCategoryStatus[];
  documentNames: string[];
};

export type DocumentCompletenessReport = {
  generatedAt: string;
  categories: Array<{ key: string; label: string; helperText: string }>;
  rows: DocumentCompletenessRow[];
  summary: {
    loanCount: number;
    missingAllDocumentsCount: number;
    fullyMatchedCount: number;
    partiallyMatchedCount: number;
    categoryCoverage: Array<{ key: string; label: string; coveredLoans: number }>;
  };
};

export type AuditTrailRow = {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  metadata: Prisma.JsonValue;
};

export type AuditTrailReport = {
  generatedAt: string;
  filters: {
    action: string;
    entityType: string;
    actorId: string;
    startDate: string;
    endDate: string;
    page: number;
    pageSize: number;
  };
  options: {
    actions: string[];
    entityTypes: string[];
    actors: Array<{ id: string; name: string; count: number }>;
  };
  rows: AuditTrailRow[];
  totalRows: number;
  totalPages: number;
};

type GuarantorAccumulator = {
  displayName: string;
  phone: string;
  currencyCode: string;
  loansById: Map<string, GuarantorExposureLoan>;
};

type ChargeGroupRow = {
  name: string;
  status: string;
  currencyCode: string;
  _count: { _all: number };
  _sum: { amountMinor: bigint | null };
};

const documentCategoryDefinitions = [
  {
    key: "identity",
    label: "Identity document",
    helperText: "National ID or any document whose name clearly references an ID.",
    matches: (value: string) => /(^|[^a-z])id([^a-z]|$)/.test(value) || value.includes("national id"),
  },
  {
    key: "signature",
    label: "Client signature",
    helperText: "Client signature artifacts such as clientSignature or other signature-labeled uploads.",
    matches: (value: string) => value.includes("signature"),
  },
  {
    key: "loan-pack",
    label: "Loan agreement / pack",
    helperText: "Loan agreement, offer letter, mortgage/promissory note, or loan-application pack pages.",
    matches: (value: string) => value.includes("loan agreement")
      || value.includes("loan offer")
      || value.includes("offer letter")
      || value.includes("promisory note")
      || value.includes("mortagage agreement")
      || value.includes("application form")
      || /^la pg\s*\d+/i.test(value),
  },
  {
    key: "guarantor-pack",
    label: "Guarantor paperwork",
    helperText: "Guarantor or guarantee uploads, including common misspellings seen in the tenant's legacy data.",
    matches: (value: string) => value.includes("guarantor")
      || value.includes("guarantee")
      || value.includes("guarator")
      || value.includes("guarators")
      || value.includes("gurantor"),
  },
] as const;

export function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatDisplayDate(date: Date) {
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeZone: "Africa/Kampala" }).format(date);
}

export function formatDisplayDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala" }).format(date);
}

export function serializeReportPayload<T>(value: T): T {
  return deepSerialize(value) as T;
}

export function getFeeRevenueFilters(source: SearchParamSource, now = new Date()) {
  const endDate = startOfUtcDay(now);
  const defaultStartDate = new Date(Date.UTC(endDate.getUTCFullYear(), 0, 1));
  const parsedStartDate = parseDateOnly(readSearchParam(source, "startDate"));
  const parsedEndDate = parseDateOnly(readSearchParam(source, "endDate"));
  const [startDate, finalEndDate] = sortDateRange(parsedStartDate ?? defaultStartDate, parsedEndDate ?? endDate);

  return { startDate, endDate: finalEndDate };
}

export function getAuditTrailFilters(source: SearchParamSource, now = new Date()) {
  const endDate = startOfUtcDay(now);
  const defaultStartDate = new Date(endDate.getTime() - 29 * DAY_MS);
  const parsedStartDate = parseDateOnly(readSearchParam(source, "startDate"));
  const parsedEndDate = parseDateOnly(readSearchParam(source, "endDate"));
  const [startDate, finalEndDate] = sortDateRange(parsedStartDate ?? defaultStartDate, parsedEndDate ?? endDate);
  const page = Math.max(1, Number.parseInt(readSearchParam(source, "page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(readSearchParam(source, "pageSize") ?? "50", 10) || 50));

  return {
    action: (readSearchParam(source, "action") ?? "").trim(),
    entityType: (readSearchParam(source, "entityType") ?? "").trim(),
    actorId: (readSearchParam(source, "actorId") ?? "").trim(),
    startDate,
    endDate: finalEndDate,
    page,
    pageSize,
  };
}

export async function loadGroupPortfolioReport(prisma: PrismaClient, scope: UserDataScope): Promise<GroupPortfolioReport> {
  const groups = await prisma.group.findMany({
    where: { organizationId: scope.organizationId, ...officeWhere(scope) },
    orderBy: { name: "asc" },
    select: {
      id: true,
      accountNumber: true,
      name: true,
      status: true,
      assignedOfficer: { select: { name: true } },
      _count: { select: { members: true, loans: true, savingsAccounts: true } },
      loans: {
        select: {
          status: true,
          principalMinor: true,
          denominationCurrency: true,
          installments: { select: { principalDueMinor: true, principalPaidMinor: true, principalWaivedMinor: true } },
        },
      },
      savingsAccounts: {
        select: {
          currencyCode: true,
          transactions: { select: { amountMinor: true } },
        },
      },
    },
  });

  const rows = groups.map<GroupPortfolioRow>((group) => {
    const loanPrincipalMinor = group.loans.reduce((sum, loan) => sum + loan.principalMinor, 0n);
    const outstandingPrincipalMinor = group.loans.reduce((sum, loan) => sum + outstandingPrincipalMinorFromInstallments(loan.installments), 0n);
    const savingsBalanceMinor = group.savingsAccounts.reduce(
      (sum, account) => sum + account.transactions.reduce((accountSum, transaction) => accountSum + transaction.amountMinor, 0n),
      0n,
    );

    return {
      id: group.id,
      accountNumber: group.accountNumber,
      name: group.name,
      status: group.status,
      officerName: group.assignedOfficer?.name ?? null,
      memberCount: group._count.members,
      savingsAccountCount: group._count.savingsAccounts,
      savingsBalanceMinor,
      currencyCode: group.loans[0]?.denominationCurrency ?? group.savingsAccounts[0]?.currencyCode ?? "UGX",
      loanCount: group._count.loans,
      activeLoanCount: group.loans.filter((loan) => loan.status === "ACTIVE").length,
      arrearsLoanCount: group.loans.filter((loan) => loan.status === "IN_ARREARS").length,
      closedLoanCount: group.loans.filter((loan) => loan.status === "CLOSED").length,
      otherLoanCount: group.loans.filter((loan) => !["ACTIVE", "IN_ARREARS", "CLOSED"].includes(loan.status)).length,
      loanPrincipalMinor,
      outstandingPrincipalMinor,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    rows,
    totals: {
      groupCount: rows.length,
      memberCount: rows.reduce((sum, row) => sum + row.memberCount, 0),
      savingsAccountCount: rows.reduce((sum, row) => sum + row.savingsAccountCount, 0),
      savingsBalanceMinor: rows.reduce((sum, row) => sum + row.savingsBalanceMinor, 0n),
      loanCount: rows.reduce((sum, row) => sum + row.loanCount, 0),
      activeLoanCount: rows.reduce((sum, row) => sum + row.activeLoanCount, 0),
      arrearsLoanCount: rows.reduce((sum, row) => sum + row.arrearsLoanCount, 0),
      closedLoanCount: rows.reduce((sum, row) => sum + row.closedLoanCount, 0),
      otherLoanCount: rows.reduce((sum, row) => sum + row.otherLoanCount, 0),
      loanPrincipalMinor: rows.reduce((sum, row) => sum + row.loanPrincipalMinor, 0n),
      outstandingPrincipalMinor: rows.reduce((sum, row) => sum + row.outstandingPrincipalMinor, 0n),
      currencyCode: rows[0]?.currencyCode ?? "UGX",
    },
  };
}

export async function loadGuarantorExposureReport(prisma: PrismaClient, scope: UserDataScope): Promise<GuarantorExposureReport> {
  const guarantors = await prisma.guarantor.findMany({
    where: {
      active: true,
      loan: { office: { organizationId: scope.organizationId }, ...officeWhere(scope) },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      loan: {
        select: {
          id: true,
          accountNumber: true,
          status: true,
          denominationCurrency: true,
          client: { select: { firstName: true, middleName: true, lastName: true } },
          group: { select: { name: true } },
          installments: { select: { principalDueMinor: true, principalPaidMinor: true, principalWaivedMinor: true } },
        },
      },
    },
  });

  const grouped = new Map<string, GuarantorAccumulator>();
  for (const guarantor of guarantors) {
    const key = repeatedGuarantorKey(guarantor.firstName, guarantor.lastName, guarantor.phone);
    if (!key) continue;

    const displayName = [guarantor.firstName?.trim(), guarantor.lastName?.trim()].filter(Boolean).join(" ");
    const existing = grouped.get(key) ?? {
      displayName,
      phone: guarantor.phone?.trim() ?? "",
      currencyCode: guarantor.loan.denominationCurrency,
      loansById: new Map<string, GuarantorExposureLoan>(),
    };

    existing.loansById.set(guarantor.loan.id, {
      id: guarantor.loan.id,
      accountNumber: guarantor.loan.accountNumber,
      borrowerName: guarantor.loan.group?.name ?? fullName(guarantor.loan.client),
      status: guarantor.loan.status,
      outstandingPrincipalMinor: outstandingPrincipalMinorFromInstallments(guarantor.loan.installments),
      currencyCode: guarantor.loan.denominationCurrency,
    });
    grouped.set(key, existing);
  }

  const rows = [...grouped.entries()]
    .map<GuarantorExposureRow | null>(([key, item]) => {
      const loans = [...item.loansById.values()].sort((left, right) => right.outstandingPrincipalMinor === left.outstandingPrincipalMinor
        ? left.accountNumber.localeCompare(right.accountNumber)
        : right.outstandingPrincipalMinor > left.outstandingPrincipalMinor ? 1 : -1);
      if (loans.length < 2) return null;
      const arrearsLoanCount = loans.filter((loan) => loan.status === "IN_ARREARS").length;
      return {
        key,
        displayName: item.displayName,
        phone: item.phone,
        loanCount: loans.length,
        arrearsLoanCount,
        concentrationRisk: arrearsLoanCount >= 2,
        totalOutstandingMinor: loans.reduce((sum, loan) => sum + loan.outstandingPrincipalMinor, 0n),
        currencyCode: item.currencyCode,
        loans,
      };
    })
    .filter((row): row is GuarantorExposureRow => row !== null)
    .sort((left, right) => {
      if (left.loanCount !== right.loanCount) return right.loanCount - left.loanCount;
      if (left.totalOutstandingMinor !== right.totalOutstandingMinor) return right.totalOutstandingMinor > left.totalOutstandingMinor ? 1 : -1;
      return left.displayName.localeCompare(right.displayName);
    });

  return {
    generatedAt: new Date().toISOString(),
    rows,
    summary: {
      repeatedGuarantorCount: rows.length,
      concentrationRiskCount: rows.filter((row) => row.concentrationRisk).length,
      loansCovered: rows.reduce((sum, row) => sum + row.loanCount, 0),
      totalOutstandingMinor: rows.reduce((sum, row) => sum + row.totalOutstandingMinor, 0n),
      currencyCode: rows[0]?.currencyCode ?? "UGX",
    },
  };
}

export async function loadFeeRevenueReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  filters: { startDate: Date; endDate: Date },
): Promise<FeeRevenueReport> {
  const scopedWhere = chargeScopeWhere(scope);
  const [datedRows, undatedRows] = await Promise.all([
    prisma.charge.groupBy({
      by: ["name", "status", "currencyCode"],
      where: { ...scopedWhere, dueOn: { gte: filters.startDate, lte: filters.endDate } },
      _count: { _all: true },
      _sum: { amountMinor: true },
      orderBy: [{ name: "asc" }, { status: "asc" }],
    }),
    prisma.charge.groupBy({
      by: ["name", "status", "currencyCode"],
      where: { ...scopedWhere, dueOn: null },
      _count: { _all: true },
      _sum: { amountMinor: true },
      orderBy: [{ name: "asc" }, { status: "asc" }],
    }),
  ]);

  const normalizedRows = buildFeeRevenueRows(datedRows as ChargeGroupRow[]);
  const normalizedUndatedRows = buildFeeRevenueRows(undatedRows as ChargeGroupRow[]);

  return {
    generatedAt: new Date().toISOString(),
    dateBasis: "dueOn",
    startDate: formatDateInput(filters.startDate),
    endDate: formatDateInput(filters.endDate),
    rows: normalizedRows,
    totals: summarizeFeeRows(normalizedRows),
    undated: {
      chargeCount: normalizedUndatedRows.reduce((sum, row) => sum + sumCounts(row.counts), 0),
      rows: normalizedUndatedRows,
      totals: summarizeFeeRows(normalizedUndatedRows),
    },
  };
}

export async function loadDocumentCompletenessReport(prisma: PrismaClient, scope: UserDataScope): Promise<DocumentCompletenessReport> {
  const loans = await prisma.loan.findMany({
    where: {
      status: { in: ["ACTIVE", "IN_ARREARS"] },
      office: { organizationId: scope.organizationId },
      ...officeWhere(scope),
    },
    orderBy: [{ status: "desc" }, { accountNumber: "asc" }],
    select: {
      id: true,
      accountNumber: true,
      status: true,
      guarantors: { select: { id: true } },
      client: {
        select: {
          accountNumber: true,
          firstName: true,
          middleName: true,
          lastName: true,
          documents: { select: { name: true } },
        },
      },
      group: { select: { name: true, accountNumber: true } },
      documents: { select: { name: true } },
    },
  });

  const rows = loans
    .map<DocumentCompletenessRow>((loan) => {
      const documentNames = dedupeDocumentNames([
        ...loan.documents.map((document) => document.name),
        ...(loan.client?.documents.map((document) => document.name) ?? []),
      ]);
      const categoryStatuses = documentCategoryDefinitions.map<DocumentCategoryStatus>((category) => {
        const matchedNames = documentNames.filter((name) => category.matches(name.toLowerCase()));
        return { key: category.key, label: category.label, matchedNames, present: matchedNames.length > 0 };
      });
      const presentCategories = categoryStatuses.filter((item) => item.present).map((item) => item.label);
      const missingCategories = categoryStatuses.filter((item) => !item.present).map((item) => item.label);

      return {
        id: loan.id,
        accountNumber: loan.accountNumber,
        borrowerName: loan.group?.name ?? fullName(loan.client),
        borrowerAccountNumber: loan.group?.accountNumber ?? loan.client?.accountNumber ?? null,
        status: loan.status,
        documentCount: documentNames.length,
        guarantorCount: loan.guarantors.length,
        matchedCoreCount: presentCategories.length,
        missingAllDocuments: documentNames.length === 0,
        presentCategories,
        missingCategories,
        categoryStatuses,
        documentNames,
      };
    })
    .sort((left, right) => {
      if (left.missingAllDocuments !== right.missingAllDocuments) return left.missingAllDocuments ? -1 : 1;
      if (left.status !== right.status) return left.status === "IN_ARREARS" ? -1 : 1;
      if (left.matchedCoreCount !== right.matchedCoreCount) return left.matchedCoreCount - right.matchedCoreCount;
      if (left.documentCount !== right.documentCount) return left.documentCount - right.documentCount;
      return left.accountNumber.localeCompare(right.accountNumber);
    });

  return {
    generatedAt: new Date().toISOString(),
    categories: documentCategoryDefinitions.map((category) => ({ key: category.key, label: category.label, helperText: category.helperText })),
    rows,
    summary: {
      loanCount: rows.length,
      missingAllDocumentsCount: rows.filter((row) => row.missingAllDocuments).length,
      fullyMatchedCount: rows.filter((row) => row.matchedCoreCount === documentCategoryDefinitions.length).length,
      partiallyMatchedCount: rows.filter((row) => row.matchedCoreCount > 0 && row.matchedCoreCount < documentCategoryDefinitions.length).length,
      categoryCoverage: documentCategoryDefinitions.map((category) => ({
        key: category.key,
        label: category.label,
        coveredLoans: rows.filter((row) => row.categoryStatuses.some((status) => status.key === category.key && status.present)).length,
      })),
    },
  };
}

export async function loadAuditTrailReport(
  prisma: PrismaClient,
  scope: UserDataScope,
  filters: { action: string; entityType: string; actorId: string; startDate: Date; endDate: Date; page: number; pageSize: number },
): Promise<AuditTrailReport> {
  const scopedLoanIds = await prisma.loan.findMany({
    where: { office: { organizationId: scope.organizationId }, ...officeWhere(scope) },
    select: { id: true },
  });
  const loanIds = scopedLoanIds.map((loan) => loan.id);

  if (loanIds.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      filters: {
        action: filters.action,
        entityType: filters.entityType,
        actorId: filters.actorId,
        startDate: formatDateInput(filters.startDate),
        endDate: formatDateInput(filters.endDate),
        page: filters.page,
        pageSize: filters.pageSize,
      },
      options: { actions: [], entityTypes: [], actors: [] },
      rows: [],
      totalRows: 0,
      totalPages: 1,
    };
  }

  const scopedBaseWhere: Prisma.AuditEventWhereInput = { entityId: { in: loanIds } };
  const filteredWhere: Prisma.AuditEventWhereInput = {
    ...scopedBaseWhere,
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    occurredAt: { gte: filters.startDate, lt: new Date(filters.endDate.getTime() + DAY_MS) },
  };

  const [totalRows, actions, entityTypes, actorCounts] = await Promise.all([
    prisma.auditEvent.count({ where: filteredWhere }),
    prisma.auditEvent.groupBy({ by: ["action"], where: scopedBaseWhere, _count: { _all: true }, orderBy: { action: "asc" } }),
    prisma.auditEvent.groupBy({ by: ["entityType"], where: scopedBaseWhere, _count: { _all: true }, orderBy: { entityType: "asc" } }),
    prisma.auditEvent.groupBy({ by: ["actorId"], where: scopedBaseWhere, _count: { _all: true } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalRows / filters.pageSize));
  const page = Math.min(filters.page, totalPages);
  const rows = await prisma.auditEvent.findMany({
    where: filteredWhere,
    include: { actor: { select: { name: true } } },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * filters.pageSize,
    take: filters.pageSize,
  });

  const actorIds = actorCounts.map((item) => item.actorId).filter((value): value is string => Boolean(value));
  const users = actorIds.length === 0 ? [] : await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const userMap = new Map(users.map((user) => [user.id, user.name]));
  const actorOptions = actorCounts
    .filter((item) => item.actorId)
    .map((item) => ({ id: item.actorId as string, name: userMap.get(item.actorId as string) ?? "Unknown user", count: item._count._all }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      action: filters.action,
      entityType: filters.entityType,
      actorId: filters.actorId,
      startDate: formatDateInput(filters.startDate),
      endDate: formatDateInput(filters.endDate),
      page,
      pageSize: filters.pageSize,
    },
    options: {
      actions: actions.map((item) => item.action),
      entityTypes: entityTypes.map((item) => item.entityType),
      actors: actorOptions,
    },
    rows: rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      actorId: row.actorId,
      actorName: row.actor?.name ?? "System",
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      correlationId: row.correlationId,
      metadata: row.metadata,
    })),
    totalRows,
    totalPages,
  };
}

function chargeScopeWhere(scope: UserDataScope): Prisma.ChargeWhereInput {
  const clientScope = { organizationId: scope.organizationId, ...(scope.officeIds ? { officeId: { in: [...scope.officeIds] } } : {}) };
  const groupScope = { organizationId: scope.organizationId, ...(scope.officeIds ? { officeId: { in: [...scope.officeIds] } } : {}) };
  const loanScope = { office: { organizationId: scope.organizationId }, ...(scope.officeIds ? { officeId: { in: [...scope.officeIds] } } : {}) };

  return {
    OR: [
      { client: clientScope },
      { group: groupScope },
      { loan: loanScope },
      { savingsAccount: { client: clientScope } },
      { savingsAccount: { group: groupScope } },
    ],
  };
}

function buildFeeRevenueRows(rows: ChargeGroupRow[]): FeeRevenueTypeRow[] {
  const grouped = new Map<string, FeeRevenueTypeRow>();

  for (const row of rows) {
    const key = `${row.currencyCode}::${row.name}`;
    const existing = grouped.get(key) ?? {
      name: row.name,
      currencyCode: row.currencyCode,
      counts: { PAID: 0, PENDING: 0, WAIVED: 0 },
      amounts: { PAID: 0n, PENDING: 0n, WAIVED: 0n },
      totalMinor: 0n,
    };
    if (isFeeStatus(row.status)) {
      existing.counts[row.status] = row._count._all;
      existing.amounts[row.status] = row._sum.amountMinor ?? 0n;
      existing.totalMinor += row._sum.amountMinor ?? 0n;
    }
    grouped.set(key, existing);
  }

  return [...grouped.values()].sort((left, right) => {
    if (left.totalMinor !== right.totalMinor) return right.totalMinor > left.totalMinor ? 1 : -1;
    return left.name.localeCompare(right.name);
  });
}

function summarizeFeeRows(rows: FeeRevenueTypeRow[]) {
  return {
    chargeCount: rows.reduce((sum, row) => sum + sumCounts(row.counts), 0),
    paidMinor: rows.reduce((sum, row) => sum + row.amounts.PAID, 0n),
    pendingMinor: rows.reduce((sum, row) => sum + row.amounts.PENDING, 0n),
    waivedMinor: rows.reduce((sum, row) => sum + row.amounts.WAIVED, 0n),
    currencyCode: rows[0]?.currencyCode ?? "UGX",
  };
}

function sumCounts(counts: Record<(typeof feeStatuses)[number], number>) {
  return feeStatuses.reduce((sum, status) => sum + counts[status], 0);
}

function isFeeStatus(value: string): value is (typeof feeStatuses)[number] {
  return feeStatuses.includes(value as (typeof feeStatuses)[number]);
}

function dedupeDocumentNames(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function parseDateOnly(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sortDateRange(startDate: Date, endDate: Date) {
  return startDate.getTime() <= endDate.getTime() ? [startDate, endDate] as const : [endDate, startDate] as const;
}

function readSearchParam(source: SearchParamSource, key: string) {
  if (source instanceof URLSearchParams) return source.get(key);
  const value = source[key];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function outstandingPrincipalMinorFromInstallments(
  installments: Array<{ principalDueMinor: bigint; principalPaidMinor: bigint; principalWaivedMinor: bigint }>,
) {
  return installments.reduce((sum, installment) => {
    const outstanding = installment.principalDueMinor - installment.principalPaidMinor - installment.principalWaivedMinor;
    return sum + (outstanding > 0n ? outstanding : 0n);
  }, 0n);
}

function fullName(person: { firstName: string; middleName: string | null; lastName: string } | null | undefined) {
  if (!person) return "Unknown borrower";
  return [person.firstName, person.middleName, person.lastName].filter(Boolean).join(" ");
}

// Approximate cross-loan guarantor matching: the schema has no guarantor person ID shared across
// loans, so exposure is inferred from normalized first name + last name + phone digits.
function repeatedGuarantorKey(firstName: string | null, lastName: string | null, phone: string | null) {
  const normalizedFirstName = firstName?.trim().toLowerCase() ?? "";
  const normalizedLastName = lastName?.trim().toLowerCase() ?? "";
  const normalizedPhone = phone?.replace(/\D/g, "") ?? "";
  if (!normalizedFirstName || !normalizedLastName || !normalizedPhone) return null;
  return `${normalizedFirstName}::${normalizedLastName}::${normalizedPhone}`;
}

function deepSerialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => deepSerialize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, deepSerialize(nested)]));
  }
  return value;
}
