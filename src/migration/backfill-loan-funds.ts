import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const backfillRowsSchema = z.array(
  z.object({
    accountNumber: z.string().trim().min(1).max(100),
    fundName: z.string().trim().min(1).max(150),
  }),
);

type BackfillLoanFundsOptions = Readonly<{
  organizationId?: string;
  organizationName?: string;
}>;

export type BackfillLoanFundsResult = Readonly<{
  candidateRows: number;
  matchedRows: number;
  loansUpdated: number;
  applicationsUpdated: number;
  alreadyMatched: number;
  missingLoans: number;
  missingFunds: number;
}>;

async function loadBackfillRows() {
  const file = new URL("./data/loan-fund-backfill.json", import.meta.url);
  return backfillRowsSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

async function resolveOrganizationIds(prisma: PrismaClient, options: BackfillLoanFundsOptions) {
  if (options.organizationId) return [options.organizationId];
  if (options.organizationName) {
    const organization = await prisma.organization.findFirstOrThrow({ where: { name: options.organizationName }, select: { id: true } });
    return [organization.id];
  }
  return null;
}

export async function backfillLoanFunds(
  prisma: PrismaClient,
  options: BackfillLoanFundsOptions = {},
): Promise<BackfillLoanFundsResult> {
  const rows = await loadBackfillRows();
  const organizationIds = await resolveOrganizationIds(prisma, options);
  const accountNumbers = [...new Set(rows.map((row) => row.accountNumber))];
  const fundNames = [...new Set(rows.map((row) => row.fundName))];

  const [loans, funds] = await Promise.all([
    prisma.loan.findMany({
      where: {
        accountNumber: { in: accountNumbers },
        ...(organizationIds ? { office: { organizationId: { in: organizationIds } } } : {}),
      },
      select: {
        id: true,
        accountNumber: true,
        fundId: true,
        applicationId: true,
        office: { select: { organizationId: true } },
        application: { select: { fundId: true } },
      },
    }),
    prisma.fund.findMany({
      where: {
        name: { in: fundNames },
        ...(organizationIds ? { organizationId: { in: organizationIds } } : {}),
      },
      select: { id: true, name: true, organizationId: true },
    }),
  ]);

  const loansByAccountNumber = new Map(loans.map((loan) => [loan.accountNumber, loan]));
  const fundsByOrganizationAndName = new Map(funds.map((fund) => [`${fund.organizationId}:${fund.name}`, fund]));

  let matchedRows = 0;
  let loansUpdated = 0;
  let applicationsUpdated = 0;
  let alreadyMatched = 0;
  let missingLoans = 0;
  let missingFunds = 0;

  for (const row of rows) {
    const loan = loansByAccountNumber.get(row.accountNumber);
    if (!loan) {
      missingLoans += 1;
      continue;
    }
    const fund = fundsByOrganizationAndName.get(`${loan.office.organizationId}:${row.fundName}`);
    if (!fund) {
      missingFunds += 1;
      continue;
    }

    matchedRows += 1;
    const loanNeedsUpdate = loan.fundId !== fund.id;
    const applicationNeedsUpdate = loan.application.fundId !== fund.id;

    if (!loanNeedsUpdate && !applicationNeedsUpdate) {
      alreadyMatched += 1;
      continue;
    }

    await prisma.$transaction(async (transaction) => {
      if (loanNeedsUpdate) {
        await transaction.loan.update({ where: { id: loan.id }, data: { fundId: fund.id } });
      }
      if (applicationNeedsUpdate) {
        await transaction.loanApplication.update({ where: { id: loan.applicationId }, data: { fundId: fund.id } });
      }
    });

    if (loanNeedsUpdate) loansUpdated += 1;
    if (applicationNeedsUpdate) applicationsUpdated += 1;
  }

  return {
    candidateRows: rows.length,
    matchedRows,
    loansUpdated,
    applicationsUpdated,
    alreadyMatched,
    missingLoans,
    missingFunds,
  };
}

async function main() {
  try {
    const result = await backfillLoanFunds(prisma, {
      organizationId: process.env.MIGRATION_ORGANIZATION_ID,
      organizationName: process.env.MIGRATION_ORGANIZATION_NAME,
    });
    console.log(`Loan fund backfill candidates: ${result.candidateRows}`);
    console.log(`Matched rows: ${result.matchedRows}`);
    console.log(`Loan rows updated: ${result.loansUpdated}`);
    console.log(`Loan applications synced: ${result.applicationsUpdated}`);
    console.log(`Already matched: ${result.alreadyMatched}`);
    console.log(`Missing loans: ${result.missingLoans}`);
    console.log(`Missing funds: ${result.missingFunds}`);
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
