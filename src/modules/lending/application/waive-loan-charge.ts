import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { assertPeriodOpen } from "@/modules/ledger/application/assert-period-open";
import { assertBalancedJournal } from "@/modules/ledger/domain/journal";
import { recordSavingsTransactionInTransaction } from "@/modules/savings/application/record-savings-transaction";
import { resolveSavingsLiabilityAccountId } from "@/modules/savings/application/savings-ledger";

import { CRB_FEE_CHARGE_NAME, CRB_INCOME_CHARGE_NAME, MEMBER_CONTRIBUTION_SAVINGS_SHORT_NAME } from "../domain/disbursement-payout";

type ChargeStatus = "PENDING" | "PAID" | "WAIVED";

async function resolveChargeIncomeAccountId(
  prisma: PrismaClient,
  chargeName: string,
  productId: string | null,
  organizationId: string,
) {
  const mapping = productId
    ? await prisma.loanProductAccountingMapping.findUnique({ where: { productId } })
    : null;
  const defaults = mapping
    ? null
    : await prisma.loanAccountingDefaults.findUnique({ where: { organizationId } });
  const feeIncomeAccountId = mapping?.feeIncomeAccountId ?? defaults?.feeIncomeAccountId ?? null;
  const name = chargeName.trim().toLowerCase();
  if (name === CRB_INCOME_CHARGE_NAME.toLowerCase() || name === "crb") {
    return (await prisma.ledgerAccount.findFirst({ where: { code: "202020", active: true }, select: { id: true } }))?.id ?? null;
  }
  if (name === CRB_FEE_CHARGE_NAME.toLowerCase()) {
    return (await prisma.ledgerAccount.findFirst({ where: { code: "202021", active: true }, select: { id: true } }))?.id ?? null;
  }
  if (name.includes("processing")) return mapping?.processingFeeIncomeAccountId ?? feeIncomeAccountId;
  if (name.includes("admission")) return mapping?.admissionFeeIncomeAccountId ?? feeIncomeAccountId;
  return feeIncomeAccountId;
}

async function refundPaidCharge(
  prisma: PrismaClient,
  command: {
    charge: { id: string; name: string; amountMinor: bigint; currencyCode: string; status: string };
    actorUserId: string;
    officeId: string;
    organizationId: string;
    productId: string | null;
    clientId: string | null;
    groupId: string | null;
    accountLabel: string;
  },
) {
  const { charge } = command;
  const businessDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  await assertPeriodOpen(prisma, { officeId: command.officeId, businessDate });

  const incomeAccountId = await resolveChargeIncomeAccountId(prisma, charge.name, command.productId, command.organizationId);
  if (!incomeAccountId) throw new Error("No ledger account is configured to reverse this charge");
  if (!command.clientId && !command.groupId) throw new Error("Borrower is required to refund a waived charge");

  const savings = await prisma.savingsAccount.findFirst({
    where: {
      ...(command.clientId ? { clientId: command.clientId } : { groupId: command.groupId }),
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
      organizationId: command.organizationId,
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
        officeId: command.officeId,
        businessDate,
        referenceType: "CHARGE_WAIVER",
        referenceId: savingsTx.id,
        narration: `Waive ${charge.name} on ${command.accountLabel}`,
        idempotencyKey: `journal:charge-waiver:${charge.id}`,
      },
    });
    await tx.journalLine.createMany({
      data: lines.map(({ currencyCode: _currencyCode, ...line }) => ({ journalId: journal.id, ...line })),
    });
    await tx.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });

    const correlationId = randomUUID();
    const metadata = { chargeId: charge.id, amountMinor: charge.amountMinor.toString(), savingsAccountId: savings.id };
    await tx.auditEvent.create({
      data: {
        actorId: command.actorUserId,
        action: "charge.waived",
        entityType: "Charge",
        entityId: charge.id,
        correlationId,
        metadata,
        eventHash: createHash("sha256").update(JSON.stringify({ correlationId, action: "charge.waived", metadata })).digest("hex"),
      },
    });
    return updated;
  });
}

export async function setLoanChargeStatus(
  prisma: PrismaClient,
  command: { loanId: string; chargeId: string; actorUserId: string; status: ChargeStatus },
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
  const owner = loan.client ?? loan.group;
  if (!owner) throw new Error("Borrower is required to refund a waived charge");
  return refundPaidCharge(prisma, {
    charge,
    actorUserId: command.actorUserId,
    officeId: loan.officeId,
    organizationId: loan.office.organizationId,
    productId: loan.productId,
    clientId: loan.clientId,
    groupId: loan.groupId,
    accountLabel: loan.accountNumber,
  });
}

export async function setClientChargeStatus(
  prisma: PrismaClient,
  command: { clientId: string; chargeId: string; actorUserId: string; status: ChargeStatus },
) {
  const charge = await prisma.charge.findFirst({ where: { id: command.chargeId, clientId: command.clientId } });
  if (!charge) throw new Error("Charge not found");
  if (charge.loanId) {
    return setLoanChargeStatus(prisma, {
      loanId: charge.loanId,
      chargeId: charge.id,
      actorUserId: command.actorUserId,
      status: command.status,
    });
  }
  if (charge.status === command.status) return charge;
  if (command.status !== "WAIVED") {
    return prisma.charge.update({ where: { id: charge.id }, data: { status: command.status } });
  }
  if (charge.status !== "PAID") {
    return prisma.charge.update({ where: { id: charge.id }, data: { status: "WAIVED" } });
  }

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: command.clientId },
    select: { id: true, accountNumber: true, officeId: true, organizationId: true },
  });
  const loan = await prisma.loan.findFirst({
    where: { clientId: client.id },
    orderBy: { createdAt: "desc" },
    select: { productId: true },
  });
  return refundPaidCharge(prisma, {
    charge,
    actorUserId: command.actorUserId,
    officeId: client.officeId,
    organizationId: client.organizationId,
    productId: loan?.productId ?? null,
    clientId: client.id,
    groupId: null,
    accountLabel: client.accountNumber,
  });
}
