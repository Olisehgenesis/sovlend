import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { installmentsWithCharges } from "../domain/loan-outstanding";

export async function syncInstallmentAmountsFromCharges(prisma: PrismaClient) {
  const loans = await prisma.loan.findMany({
    select: {
      id: true,
      installments: { orderBy: { installmentNumber: "asc" } },
      charges: { select: { name: true, amountMinor: true, status: true, dueOn: true } },
    },
  });

  let installmentsUpdated = 0;
  for (const loan of loans) {
    if (loan.charges.length === 0) continue;
    const merged = installmentsWithCharges(loan.installments, loan.charges);
    for (let index = 0; index < loan.installments.length; index += 1) {
      const before = loan.installments[index];
      const after = merged[index];
      if (
        before.feesDueMinor === after.feesDueMinor &&
        before.feesPaidMinor === after.feesPaidMinor &&
        (before.feesWaivedMinor ?? 0n) === (after.feesWaivedMinor ?? 0n) &&
        before.penaltiesDueMinor === after.penaltiesDueMinor &&
        before.penaltiesPaidMinor === after.penaltiesPaidMinor &&
        (before.penaltiesWaivedMinor ?? 0n) === (after.penaltiesWaivedMinor ?? 0n)
      ) {
        continue;
      }
      await prisma.loanInstallment.update({
        where: { id: before.id },
        data: {
          feesDueMinor: after.feesDueMinor,
          feesPaidMinor: after.feesPaidMinor,
          feesWaivedMinor: after.feesWaivedMinor ?? 0n,
          penaltiesDueMinor: after.penaltiesDueMinor,
          penaltiesPaidMinor: after.penaltiesPaidMinor,
          penaltiesWaivedMinor: after.penaltiesWaivedMinor ?? 0n,
        },
      });
      installmentsUpdated += 1;
    }
  }

  return { loans: loans.length, installmentsUpdated };
}

async function main() {
  const result = await syncInstallmentAmountsFromCharges(prisma);
  console.log(`Synced iLend charges onto ${result.installmentsUpdated} installment(s) across ${result.loans} loan(s).`);
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("sync-installment-charges")) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
