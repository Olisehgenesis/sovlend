import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { assertPeriodOpen } from "@/modules/ledger/application/assert-period-open";
import { assertBalancedJournal } from "@/modules/ledger/domain/journal";
import { recordSavingsTransactionInTransaction } from "@/modules/savings/application/record-savings-transaction";
import { resolveSavingsLiabilityAccountId } from "@/modules/savings/application/savings-ledger";

import { CRB_FEE_CHARGE_NAME, CRB_INCOME_CHARGE_NAME, MEMBER_CONTRIBUTION_SAVINGS_SHORT_NAME } from "../domain/disbursement-payout";

export async function setLoanChargeStatus(
  prisma: PrismaClient,
  command: { loanId: string; chargeId: string; actorUserId: string; status: "PENDING" | "PAID" | "WAIVED" },
) {
  const loan = await prisma.loan.findUniqueOrThrow({
    where: { id: command.loanId },
    include: {
      office: { select: { organizationId: true } },
      client: { select: { accountNumber: true } },
      group: { select: { accountNumber: true } },
    },
  });
  const charge = await prisma.charge.findFirst({ where: { id: command.chargeId, loanId: loan.id } });
  if (!charge) throw new Error("Charge not found");
  if (charge.status === command.status) return charge;

  if (command.status !== "WAIVED") {
    return prisma.charge.update({ where: { id: charge.id }, data: { status: command.status } });
  }

  if (charge.status !== "PAID") {
    return prisma.charge.update({ where: { id: charge.id }, data: { status: "WAIVED" } });
  }

  const businessDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  await assertPeriodOpen(prisma, { officeId: loan.officeId, businessDate });

  const mapping = await prisma.loanProductAccountingMapping.findUnique({ where: { productId: loan.productId } });
  const name = charge.name.trim().toLowerCase();
  let incomeAccountId: string | null = null;
  if (name === CRB_INCOME_CHARGE_NAME.toLowerCase() || name === "crb") {
    incomeAccountId = (await prisma.ledgerAccount.findFirst({ where: { code: "202020", active: true }, select: { id: true } }))?.id ?? null;
  } else if (name === CRB_FEE_CHARGE_NAME.toLowerCase()) {
    incomeAccountId = (await prisma.ledgerAccount.findFirst({ where: { code: "202021", active: true }, select: { id: true } }))?.id ?? null;
  } else if (name.includes("processing")) {
    incomeAccountId = mapping?.processingFeeIncomeAccountId ?? mapping?.feeIncomeAccountId ?? null;
  } else if (name.includes("admission")) {
    incomeAccountId = mapping?.admissionFeeIncomeAccountId ?? mapping?.feeIncomeAccountId ?? null;
  } else {
    incomeAccountId = mapping?.feeIncomeAccountId ?? null;
  }
  if (!incomeAccountId) throw new Error("No ledger account is configured to reverse this charge");

  const owner = loan.client ?? loan.group;
  if (!owner) throw new Error("Borrower is required to refund a waived charge");
  const savings = await prisma.savingsAccount.findFirst({
    where: {
      ...(loan.clientId ? { clientId: loan.clientId } : { groupId: loan.groupId }),
      status: "ACTIVE",
      currencyCode: charge.currencyCode,
      product: { shortName: MEMBER_CONTRIBUTION_SAVINGS_SHORT_NAME },
    },
    select: { id: true, accountNumber: true, productId: true, product: { select: { shortName: true } } },
  });
  if (!savings) throw new Error("Member contribution savings account is required to refund this waiver");

  return prisma.$transaction(async (tx) => {
    const fresh = await tx.charge.findUniqueOrThrow({ where: { id: charge.id } });
    if (fresh.status === "WAIVED") return fresh;
    const updated = await tx.charge.update({ where: { id: charge.id }, data: { status: "WAIVED" } });

    const savingsTx = await recordSavingsTransactionInTransaction(tx, {
      savingsAccountId: savings.id,
      actorUserId: command.actorUserId,
      transactionType: "DEPOSIT",
      amountMinor: charge.amountMinor,
      reason: `Waived ${charge.name}`,
      idempotencyKey: `charge-waiver:${charge.id}`,
      businessDate,
      postJournal: false,
    });
    const liabilityAccountId = await resolveSavingsLiabilityAccountId(tx, {
      organizationId: loan.office.organizationId,
      savingsProductId: savings.productId,
      savingsProductShortName: savings.product?.shortName ?? MEMBER_CONTRIBUTION_SAVINGS_SHORT_NAME,
    });
    const lines = [
      { accountId: incomeAccountId, currencyCode: charge.currencyCode, direction: "DEBIT" as const, amountMinor: charge.amountMinor, memo: `Waive ${charge.name}` },
      { accountId: liabilityAccountId, currencyCode: charge.currencyCode, direction: "CREDIT" as const, amountMinor: charge.amountMinor, memo: savings.accountNumber },
    ];
    assertBalancedJournal(lines);
    const journal = await tx.journal.create({
      data: {
        officeId: loan.officeId,
        businessDate,
        referenceType: "LOAN_CHARGE_WAIVER",
        referenceId: savingsTx.id,
        narration: `Waive ${charge.name} on ${loan.accountNumber}`,
        idempotencyKey: `journal:charge-waiver:${charge.id}`,
      },
    });
    await tx.journalLine.createMany({
      data: lines.map(({ currencyCode: _currencyCode, ...line }) => ({ journalId: journal.id, ...line })),
    });
    await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });

    const correlationId = randomUUID();
    const metadata = { loanId: loan.id, chargeId: charge.id, amountMinor: charge.amountMinor.toString(), savingsAccountId: savings.id };
    await tx.auditEvent.create({
      data: {
        actorId: command.actorUserId,
        action: "loan.charge.waived",
        entityType: "Charge",
        entityId: charge.id,
        correlationId,
        metadata,
        eventHash: createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.charge.waived", metadata })).digest("hex"),
      },
    });
    return updated;
  });
}
