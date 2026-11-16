import { Prisma, type PrismaClient } from "@prisma/client";

import type { LoanChargeAmounts } from "@/modules/lending/domain/loan-outstanding";

/**
 * Charge rows folded the same way `installmentsWithCharges` reads them.
 *
 * When the schedule already has a fee or penalty balance, only the summed
 * amount per status matters. When it does not, charges land on the installment
 * with the same due date, and rows that share a due date and status add up.
 * Either way, repeated copies of the same charge do not need to be loaded
 * one by one.
 */
export type FoldedChargeSum = Readonly<{
  penalty: boolean;
  status: string;
  amountMinor: bigint;
}>;

export type FoldedChargeDetail = Readonly<{
  penalty: boolean;
  status: string;
  amountMinor: bigint;
  dueOn: Date | null;
}>;

type ScheduleLoan = Readonly<{
  id: string;
  installments: readonly { feesDueMinor: bigint; penaltiesDueMinor: bigint }[];
}>;

type SumRow = {
  loanId: string;
  penalty: boolean | string;
  status: string;
  amount: bigint | number | string;
};

type DetailRow = SumRow & { dueOn: Date | string | null };

export function foldedChargesForLoan(
  schedule: { feesDueMinor: bigint; penaltiesDueMinor: bigint },
  sums: readonly FoldedChargeSum[],
  details: readonly FoldedChargeDetail[],
): LoanChargeAmounts[] {
  const charges: LoanChargeAmounts[] = [];
  appendComponent(charges, false, schedule.feesDueMinor, sums, details);
  appendComponent(charges, true, schedule.penaltiesDueMinor, sums, details);
  return charges;
}

export async function loadFoldedLoanCharges(
  db: PrismaClient,
  loans: readonly ScheduleLoan[],
): Promise<Map<string, LoanChargeAmounts[]>> {
  const folded = new Map<string, LoanChargeAmounts[]>();
  if (loans.length === 0) return folded;

  const feeZero: string[] = [];
  const penaltyZero: string[] = [];
  const scheduleByLoan = new Map<string, { feesDueMinor: bigint; penaltiesDueMinor: bigint }>();
  for (const loan of loans) {
    let feesDueMinor = 0n;
    let penaltiesDueMinor = 0n;
    for (const installment of loan.installments) {
      feesDueMinor += installment.feesDueMinor;
      penaltiesDueMinor += installment.penaltiesDueMinor;
    }
    scheduleByLoan.set(loan.id, { feesDueMinor, penaltiesDueMinor });
    if (feesDueMinor === 0n) feeZero.push(loan.id);
    if (penaltiesDueMinor === 0n) penaltyZero.push(loan.id);
  }

  const sums = await db.$queryRaw<SumRow[]>(Prisma.sql`
    SELECT c."loanId" AS "loanId",
           (c.name ~* 'penalt') AS "penalty",
           c.status AS "status",
           SUM(c."amountMinor")::bigint AS "amount"
    FROM "Charge" c
    WHERE c."loanId" IN (${uuidList(loans.map((loan) => loan.id))})
    GROUP BY c."loanId", (c.name ~* 'penalt'), c.status
  `);

  const details = await loadDueDateDetails(db, feeZero, penaltyZero);
  const sumsByLoan = groupByLoan(sums);
  const detailsByLoan = groupByLoan(details);

  for (const loan of loans) {
    const schedule = scheduleByLoan.get(loan.id) ?? { feesDueMinor: 0n, penaltiesDueMinor: 0n };
    folded.set(
      loan.id,
      foldedChargesForLoan(
        schedule,
        (sumsByLoan.get(loan.id) ?? []).map(asSum),
        (detailsByLoan.get(loan.id) ?? []).map(asDetail),
      ),
    );
  }
  return folded;
}

function appendComponent(
  charges: LoanChargeAmounts[],
  penalty: boolean,
  scheduleDueMinor: bigint,
  sums: readonly FoldedChargeSum[],
  details: readonly FoldedChargeDetail[],
) {
  const name = penalty ? "Penalty" : "Fee";
  if (scheduleDueMinor > 0n) {
    for (const row of sums) {
      if (row.penalty !== penalty || row.amountMinor === 0n) continue;
      charges.push({ name, amountMinor: row.amountMinor, status: row.status, dueOn: null });
    }
    return;
  }
  for (const row of details) {
    if (row.penalty !== penalty || row.amountMinor === 0n) continue;
    charges.push({ name, amountMinor: row.amountMinor, status: row.status, dueOn: row.dueOn });
  }
}

async function loadDueDateDetails(db: PrismaClient, feeZero: string[], penaltyZero: string[]): Promise<DetailRow[]> {
  const branches: Prisma.Sql[] = [];
  if (feeZero.length > 0) {
    branches.push(Prisma.sql`(c."loanId" IN (${uuidList(feeZero)}) AND c.name !~* 'penalt')`);
  }
  if (penaltyZero.length > 0) {
    branches.push(Prisma.sql`(c."loanId" IN (${uuidList(penaltyZero)}) AND c.name ~* 'penalt')`);
  }
  if (branches.length === 0) return [];
  return db.$queryRaw<DetailRow[]>(Prisma.sql`
    SELECT c."loanId" AS "loanId",
           (c.name ~* 'penalt') AS "penalty",
           c.status AS "status",
           c."dueOn" AS "dueOn",
           SUM(c."amountMinor")::bigint AS "amount"
    FROM "Charge" c
    WHERE ${Prisma.join(branches, " OR ")}
    GROUP BY c."loanId", (c.name ~* 'penalt'), c.status, c."dueOn"
  `);
}

function groupByLoan<T extends { loanId: string }>(rows: readonly T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.loanId) ?? [];
    list.push(row);
    grouped.set(row.loanId, list);
  }
  return grouped;
}

function asSum(row: SumRow): FoldedChargeSum {
  return { penalty: row.penalty === true || row.penalty === "t" || row.penalty === "true", status: row.status, amountMinor: asBigInt(row.amount) };
}

function asDetail(row: DetailRow): FoldedChargeDetail {
  return { ...asSum(row), dueOn: asDueOn(row.dueOn) };
}

function asBigInt(value: bigint | number | string): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function asDueOn(value: Date | string | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  return new Date(value.includes("T") ? value : `${value}T00:00:00.000Z`);
}

function uuidList(ids: readonly string[]) {
  return Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
}
