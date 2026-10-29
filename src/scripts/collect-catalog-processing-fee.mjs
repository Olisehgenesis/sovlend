import { createHash, randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const REASON = "Loan processing fee collected";
const LOAN_ACCOUNTS = (process.env.LOAN_ACCOUNTS ?? "000000908L5,000000924L,000000864L3")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const prisma = new PrismaClient();

function todayUtc() {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

async function main() {
  const results = [];
  for (const accountNumber of LOAN_ACCOUNTS) {
    results.push(await collectForLoan(accountNumber));
  }
  console.log(JSON.stringify(results, null, 2));
}

async function collectForLoan(accountNumber) {
  const loan = await prisma.loan.findFirst({
    where: { accountNumber },
    include: {
      office: { select: { organizationId: true } },
      product: { select: { id: true } },
      transactions: {
        where: { transactionType: "DISBURSEMENT" },
        select: { recordedByUserId: true },
        take: 1,
      },
    },
  });
  if (!loan) return { accountNumber, error: "Loan not found" };

  const charge = await prisma.charge.findFirst({
    where: {
      loanId: loan.id,
      name: { equals: "Loan processing fee", mode: "insensitive" },
      status: "PAID",
    },
  });
  if (!charge) return { accountNumber, skipped: "No paid catalog processing fee" };

  const idempotencyKey = `catalog-processing-collect:${charge.id}`;
  const existing = await prisma.savingsTransaction.findUnique({ where: { idempotencyKey } });
  if (existing) return { accountNumber, skipped: "Already collected", savingsTx: existing.id };

  const mapping = await prisma.loanProductAccountingMapping.findUnique({ where: { productId: loan.productId } });
  const incomeAccountId = mapping?.processingFeeIncomeAccountId ?? mapping?.feeIncomeAccountId ?? null;
  if (!incomeAccountId) return { accountNumber, error: "No processing/fee income account" };

  const savings = await prisma.savingsAccount.findFirst({
    where: {
      ...(loan.clientId ? { clientId: loan.clientId } : { groupId: loan.groupId }),
      status: "ACTIVE",
      currencyCode: charge.currencyCode,
      product: { shortName: "MSA" },
    },
    include: {
      product: { select: { shortName: true } },
      transactions: { select: { amountMinor: true } },
    },
  });
  if (!savings) return { accountNumber, error: "No member contribution savings account" };

  const balanceBefore = savings.transactions.reduce((sum, item) => sum + item.amountMinor, 0n);
  const actorUserId = loan.transactions[0]?.recordedByUserId ?? null;
  const businessDate = todayUtc();
  const closure = await prisma.accountingClosure.findFirst({
    where: { officeId: loan.officeId },
    orderBy: { closingDate: "desc" },
    select: { closingDate: true },
  });
  if (closure && businessDate.toISOString().slice(0, 10) <= closure.closingDate.toISOString().slice(0, 10)) {
    return { accountNumber, error: "Accounting period closed" };
  }

  const liability = await prisma.savingsProductAccountingMapping.findUnique({
    where: { productId: savings.productId },
    select: { savingsLiabilityAccountId: true },
  });
  let liabilityAccountId = liability?.savingsLiabilityAccountId ?? null;
  if (!liabilityAccountId) {
    const defaults = await prisma.savingsAccountingDefaults.findUnique({
      where: { organizationId: loan.office.organizationId },
      select: { savingsLiabilityAccountId: true },
    });
    liabilityAccountId = defaults?.savingsLiabilityAccountId ?? null;
  }
  if (!liabilityAccountId) {
    liabilityAccountId =
      (await prisma.ledgerAccount.findFirst({ where: { code: "ML-001", active: true }, select: { id: true } }))?.id ?? null;
  }
  if (!liabilityAccountId) return { accountNumber, error: "No savings liability account" };

  const posted = await prisma.$transaction(async (tx) => {
    const duplicate = await tx.savingsTransaction.findUnique({ where: { idempotencyKey } });
    if (duplicate) return duplicate;
    const savingsTx = await tx.savingsTransaction.create({
      data: {
        savingsAccountId: savings.id,
        transactionType: "WITHDRAWAL",
        amountMinor: -charge.amountMinor,
        recordedByUserId: actorUserId ?? undefined,
        reason: REASON,
        externalReference: loan.accountNumber,
        idempotencyKey,
      },
    });
    const journal = await tx.journal.create({
      data: {
        officeId: loan.officeId,
        businessDate,
        referenceType: "LOAN_CHARGE_COLLECTION",
        referenceId: savingsTx.id,
        narration: `${REASON} on ${loan.accountNumber}`,
        idempotencyKey: `journal:${idempotencyKey}`,
      },
    });
    await tx.journalLine.createMany({
      data: [
        { journalId: journal.id, accountId: liabilityAccountId, direction: "DEBIT", amountMinor: charge.amountMinor, memo: savings.accountNumber },
        { journalId: journal.id, accountId: incomeAccountId, direction: "CREDIT", amountMinor: charge.amountMinor, memo: REASON },
      ],
    });
    await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
    const correlationId = randomUUID();
    const metadata = {
      loanId: loan.id,
      chargeId: charge.id,
      amountMinor: charge.amountMinor.toString(),
      savingsAccountId: savings.id,
      reason: REASON,
    };
    await tx.auditEvent.create({
      data: {
        actorId: actorUserId,
        action: "loan.processing-fee.collected",
        entityType: "Charge",
        entityId: charge.id,
        correlationId,
        metadata,
        eventHash: createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.processing-fee.collected", metadata })).digest("hex"),
      },
    });
    return savingsTx;
  });

  return {
    accountNumber,
    savingsAccount: savings.accountNumber,
    amount: (Number(charge.amountMinor) / 100).toFixed(0),
    balanceBefore: (Number(balanceBefore) / 100).toFixed(0),
    balanceAfter: (Number(balanceBefore - charge.amountMinor) / 100).toFixed(0),
    reason: REASON,
    savingsTx: posted.id,
  };
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
