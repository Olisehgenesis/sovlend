import type { Prisma, PrismaClient } from "@prisma/client";

type ClosurePrisma = PrismaClient | Prisma.TransactionClient;

export class PeriodClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeriodClosedError";
  }
}

function dateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Guards every journal-posting code path against posting into a closed accounting period
 * ("Closing Entries" in iLend/Mifos terms). Purely opt-in: an office with no AccountingClosure
 * row behaves exactly as before this feature existed (a no-op), so adding this call to an
 * existing posting function changes no behavior until an admin actually creates a closure for
 * that office. Once a closure exists, any businessDate on or before the *latest* closingDate
 * for that office is rejected -- callers should call this before writing any Journal/JournalLine
 * rows so a rejected posting leaves no partial state.
 */
export async function assertPeriodOpen(prisma: ClosurePrisma, params: { officeId: string; businessDate: Date }): Promise<void> {
  const latestClosure = await prisma.accountingClosure.findFirst({
    where: { officeId: params.officeId },
    orderBy: { closingDate: "desc" },
    select: { closingDate: true },
  });
  if (!latestClosure) return;

  if (dateOnlyString(params.businessDate) <= dateOnlyString(latestClosure.closingDate)) {
    throw new PeriodClosedError(
      `This office's accounting period is closed on or before ${dateOnlyString(latestClosure.closingDate)}. Choose a later business date.`,
    );
  }
}
