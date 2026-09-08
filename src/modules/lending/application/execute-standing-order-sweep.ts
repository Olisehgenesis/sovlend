import type { PrismaClient } from "@prisma/client";

import { postRepayment } from "./post-repayment";
import { postSavingsTransaction } from "@/modules/savings/application/post-savings-transaction";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { sendSms } from "@/modules/notifications/infrastructure/sms";
import { computeSweepAmountMinor, standingOrderSweepJobId, type StandingOrderSweepJob } from "@/modules/notifications/domain/standing-order-sweep";
import {
  STANDING_ORDER_SETTLEMENT_ACCOUNT_NAME,
  STANDING_ORDER_SYSTEM_EMAIL,
} from "@/modules/lending/domain/standing-order-sweep-constants";

export type StandingOrderSweepResult =
  | { outcome: "swept"; amountMinor: bigint }
  | { outcome: "skipped"; reason: string };

/**
 * Executes one standing-order sweep job: pulls whatever a client's default savings account can
 * cover (capped at the installment's outstanding amount) and posts it as a loan repayment via the
 * same postRepayment() every teller-recorded repayment uses -- same double-entry ledger, same
 * idempotency, same allocation/arrears logic. Only after that succeeds does it mirror a
 * SavingsTransaction withdrawal so the client-facing savings balance reflects the sweep, and send
 * a confirmation SMS. If postRepayment fails, nothing else runs and the whole job can be safely
 * retried by BullMQ -- the ledger is only ever touched by the one atomic, idempotent call.
 */
export async function executeStandingOrderSweep(
  prisma: PrismaClient,
  job: StandingOrderSweepJob,
): Promise<StandingOrderSweepResult> {
  const [systemUser, settlementAccount, savingsAccount] = await Promise.all([
    prisma.user.findUnique({ where: { email: STANDING_ORDER_SYSTEM_EMAIL }, select: { id: true } }),
    prisma.settlementAccount.findFirst({ where: { name: STANDING_ORDER_SETTLEMENT_ACCOUNT_NAME, active: true }, select: { id: true } }),
    prisma.savingsAccount.findUnique({ where: { id: job.savingsAccountId }, select: { id: true, status: true, transactions: { select: { amountMinor: true } } } }),
  ]);
  if (!systemUser) return { outcome: "skipped", reason: "Standing-order automation user is not provisioned" };
  if (!settlementAccount) return { outcome: "skipped", reason: "Standing-order sweep settlement account is not provisioned" };
  if (!savingsAccount || savingsAccount.status !== "ACTIVE") return { outcome: "skipped", reason: "Default savings account is no longer active" };

  const availableMinor = savingsAccount.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n);
  const sweepAmountMinor = computeSweepAmountMinor(availableMinor, BigInt(job.outstandingMinor));
  if (sweepAmountMinor <= 0n) return { outcome: "skipped", reason: "No available savings balance to sweep" };

  const dedupKey = standingOrderSweepJobId(job);
  await postRepayment(prisma, {
    loanId: job.loanId,
    actorUserId: systemUser.id,
    amountMinor: sweepAmountMinor,
    settlementAccountId: settlementAccount.id,
    businessDate: new Date(),
    externalReference: "Standing order sweep",
    idempotencyKey: dedupKey,
  });

  // Mirrors the repayment as a savings withdrawal so the client's displayed balance matches. If
  // this insert somehow fails after postRepayment succeeded, the ledger stays correct and the
  // client-facing balance is briefly stale until BullMQ retries this same job (postRepayment is
  // idempotent on repaymentTransaction, so the retry safely reaches this line again).
  await postSavingsTransaction(prisma, {
    savingsAccountId: savingsAccount.id,
    actorUserId: systemUser.id,
    transactionType: "WITHDRAWAL",
    amountMinor: sweepAmountMinor,
    settlementAccountId: settlementAccount.id,
    reason: "Standing order sweep",
    externalReference: `Standing order sweep for loan ${job.accountNumber}`,
    idempotencyKey: `${dedupKey}:savings-mirror`,
  });

  const amountText = formatMinor(sweepAmountMinor, job.currencyCode);
  const smsMessage = `We collected ${amountText} from your savings towards loan ${job.accountNumber} (standing order). Thank you.`;
  const smsResult = job.mobileNumber ? await sendSms(job.mobileNumber, smsMessage) : { ok: false, error: "Client has no mobile number on file" };
  const channels = smsResult.ok ? ["IN_APP", "SMS"] : ["IN_APP"];

  const notification = await prisma.notification.upsert({
    where: { deduplicationKey: dedupKey },
    create: {
      audienceType: "CLIENT",
      audienceId: job.clientId,
      title: "Standing order payment collected",
      body: `${amountText} was collected from your savings towards loan ${job.accountNumber}.`,
      channels,
      deduplicationKey: dedupKey,
    },
    update: { channels },
  });

  await prisma.reminder.upsert({
    where: { deduplicationKey: dedupKey },
    create: {
      loanId: job.loanId,
      installmentId: job.installmentId,
      notificationId: notification.id,
      type: "STANDING_ORDER_SWEPT",
      status: "SENT",
      scheduledFor: new Date(),
      deduplicationKey: dedupKey,
      attempts: 1,
      sentAt: new Date(),
      lastError: smsResult.ok ? null : smsResult.error,
    },
    update: { notificationId: notification.id, status: "SENT", sentAt: new Date(), lastError: smsResult.ok ? null : smsResult.error, attempts: { increment: 1 } },
  });

  return { outcome: "swept", amountMinor: sweepAmountMinor };
}
