import type { Prisma, PrismaClient } from "@prisma/client";

import {
  installmentOutstandingMinor,
} from "@/modules/lending/domain/loan-outstanding";
import { formatMinor } from "@/modules/money/domain/format-minor";
import {
  buildStandingOrderDepositRequestKey,
  computeSweepAmountMinor,
  standingOrderSweepJobId,
  type StandingOrderSweepJob,
} from "@/modules/notifications/domain/standing-order-sweep";
import { sendSms } from "@/modules/notifications/infrastructure/sms";
import { recordSavingsTransactionInTransaction } from "@/modules/savings/application/record-savings-transaction";

import { applyRepaymentInTransaction } from "./post-repayment";
import {
  STANDING_ORDER_SETTLEMENT_ACCOUNT_NAME,
  STANDING_ORDER_SYSTEM_EMAIL,
} from "@/modules/lending/domain/standing-order-sweep-constants";

export type StandingOrderSweepResult =
  | { outcome: "swept"; amountMinor: bigint }
  | { outcome: "skipped"; reason: string };

const STANDING_ORDER_OPEN_LOAN_STATUSES = ["ACTIVE", "IN_ARREARS"] as const;

type Tx = Prisma.TransactionClient;

type OutstandingInstallment = Readonly<{
  id: string;
  dueOn: Date;
  outstandingMinor: bigint;
}>;

type SweepNotificationContext = Readonly<{
  loanId: string;
  installmentId: string;
  clientId: string;
  accountNumber: string;
  dueOn: string;
  currencyCode: string;
  mobileNumber: string | null;
}>;

type StandingOrderFundingAccount = Readonly<{
  id: string;
  isDefault: boolean;
  currencyCode: string;
}>;

function endOfUtcDay(now: Date): Date {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  return dayEnd;
}

function listOutstandingInstallments(
  installments: ReadonlyArray<{
    id: string;
    dueOn: Date;
    principalDueMinor: bigint;
    interestDueMinor: bigint;
    feesDueMinor: bigint;
    penaltiesDueMinor: bigint;
    monitoringFeeDueMinor: bigint;
    principalPaidMinor: bigint;
    interestPaidMinor: bigint;
    feesPaidMinor: bigint;
    penaltiesPaidMinor: bigint;
    monitoringFeePaidMinor: bigint;
    principalWaivedMinor: bigint;
    interestWaivedMinor: bigint;
    feesWaivedMinor: bigint;
    penaltiesWaivedMinor: bigint;
    monitoringFeeWaivedMinor: bigint;
  }>,
): OutstandingInstallment[] {
  return installments
    .map((installment) => ({
      id: installment.id,
      dueOn: installment.dueOn,
      outstandingMinor: installmentOutstandingMinor(installment),
    }))
    .filter((installment) => installment.outstandingMinor > 0n);
}

/**
 * Standing-order funding account tie-break:
 *   1. a caller-specified account when the trigger itself identifies one (e.g. the exact savings
 *      account that just received a client deposit; if we later persist a loan-specific link, it
 *      should be passed here the same way),
 *   2. otherwise the owner's ACTIVE default savings account,
 *   3. otherwise the owner's sole ACTIVE account,
 *   4. otherwise skip rather than guessing among multiple unlabeled accounts.
 */
function resolveStandingOrderFundingAccount(
  accounts: readonly StandingOrderFundingAccount[],
  currencyCode: string,
  preferredSavingsAccountId?: string,
): StandingOrderFundingAccount | null {
  const eligible = accounts.filter((account) => account.currencyCode === currencyCode);
  if (eligible.length === 0) return null;
  if (preferredSavingsAccountId) {
    const preferred = eligible.find((account) => account.id === preferredSavingsAccountId);
    if (preferred) return preferred;
  }
  const defaultAccount = eligible.find((account) => account.isDefault);
  if (defaultAccount) return defaultAccount;
  return eligible.length === 1 ? eligible[0] : null;
}

async function upsertStandingOrderSweepNotification(
  prisma: PrismaClient,
  context: SweepNotificationContext,
  dedupKey: string,
  amountMinor: bigint,
  now: Date,
): Promise<void> {
  const amountText = formatMinor(amountMinor, context.currencyCode);
  const smsMessage = `We collected ${amountText} from your savings towards loan ${context.accountNumber} (standing order). Thank you.`;
  const smsResult = context.mobileNumber
    ? await sendSms(context.mobileNumber, smsMessage)
    : { ok: false, error: "Client has no mobile number on file" };
  const channels = smsResult.ok ? ["IN_APP", "SMS"] : ["IN_APP"];

  const notification = await prisma.notification.upsert({
    where: { deduplicationKey: dedupKey },
    create: {
      audienceType: "CLIENT",
      audienceId: context.clientId,
      title: "Standing order payment collected",
      body: `${amountText} was collected from your savings towards loan ${context.accountNumber}.`,
      channels,
      deduplicationKey: dedupKey,
    },
    update: { channels },
  });

  await prisma.reminder.upsert({
    where: { deduplicationKey: dedupKey },
    create: {
      loanId: context.loanId,
      installmentId: context.installmentId,
      notificationId: notification.id,
      type: "STANDING_ORDER_SWEPT",
      status: "SENT",
      scheduledFor: now,
      deduplicationKey: dedupKey,
      attempts: 1,
      sentAt: now,
      lastError: smsResult.ok ? null : smsResult.error,
    },
    update: {
      notificationId: notification.id,
      status: "SENT",
      sentAt: now,
      lastError: smsResult.ok ? null : smsResult.error,
      attempts: { increment: 1 },
    },
  });
}

async function executeStandingOrderSweepInTransaction(
  transaction: Tx,
  job: StandingOrderSweepJob,
  input: Readonly<{
    dedupKey: string;
    now: Date;
    systemUserId: string;
    settlementAccount: { id: string; name: string; ledgerAccountId: string };
  }>,
): Promise<StandingOrderSweepResult & { notificationContext?: SweepNotificationContext }> {
  const dayEnd = endOfUtcDay(input.now);
  const [loan, savingsAccount] = await Promise.all([
    transaction.loan.findUnique({
      where: { id: job.loanId },
      select: {
        id: true,
        clientId: true,
        officeId: true,
        status: true,
        accountNumber: true,
        denominationCurrency: true,
        installments: {
          where: { dueOn: { lt: dayEnd } },
          orderBy: [{ dueOn: "asc" }, { installmentNumber: "asc" }],
          select: {
            id: true,
            dueOn: true,
            principalDueMinor: true,
            interestDueMinor: true,
            feesDueMinor: true,
            penaltiesDueMinor: true,
            monitoringFeeDueMinor: true,
            principalPaidMinor: true,
            interestPaidMinor: true,
            feesPaidMinor: true,
            penaltiesPaidMinor: true,
            monitoringFeePaidMinor: true,
            principalWaivedMinor: true,
            interestWaivedMinor: true,
            feesWaivedMinor: true,
            penaltiesWaivedMinor: true,
            monitoringFeeWaivedMinor: true,
          },
        },
        client: { select: { mobileNumber: true } },
      },
    }),
    transaction.savingsAccount.findUnique({
      where: { id: job.savingsAccountId },
      select: {
        id: true,
        accountNumber: true,
        clientId: true,
        status: true,
        currencyCode: true,
        transactions: { select: { amountMinor: true } },
      },
    }),
  ]);

  if (!loan) return { outcome: "skipped", reason: "Loan no longer exists" };
  if (!loan.clientId) return { outcome: "skipped", reason: "Standing order sweeps only apply to direct client loans" };
  if (!(STANDING_ORDER_OPEN_LOAN_STATUSES as readonly string[]).includes(loan.status)) {
    return { outcome: "skipped", reason: "Loan is no longer open for standing-order sweeps" };
  }
  if (!savingsAccount || savingsAccount.status !== "ACTIVE") {
    return { outcome: "skipped", reason: "Funding savings account is no longer active" };
  }
  if (savingsAccount.clientId !== loan.clientId) {
    return { outcome: "skipped", reason: "Funding savings account no longer belongs to this loan's client" };
  }
  if (savingsAccount.currencyCode !== loan.denominationCurrency) {
    return { outcome: "skipped", reason: "Funding savings account currency no longer matches the loan" };
  }

  const outstandingInstallments = listOutstandingInstallments(loan.installments);
  const oldestOutstandingInstallment = outstandingInstallments[0];
  if (!oldestOutstandingInstallment) {
    return { outcome: "skipped", reason: "Loan has no due or overdue installments left to sweep" };
  }

  const dueOutstandingMinor = outstandingInstallments.reduce(
    (sum, installment) => sum + installment.outstandingMinor,
    0n,
  );
  const availableMinor = savingsAccount.transactions.reduce(
    (sum, transactionRecord) => sum + transactionRecord.amountMinor,
    0n,
  );
  const sweepAmountMinor = computeSweepAmountMinor(availableMinor, dueOutstandingMinor);
  if (sweepAmountMinor <= 0n) {
    return { outcome: "skipped", reason: "No available savings balance to sweep" };
  }

  await applyRepaymentInTransaction(transaction, {
    loanId: loan.id,
    actorUserId: input.systemUserId,
    amountMinor: sweepAmountMinor,
    businessDate: input.now,
    externalReference: "Standing order sweep",
    idempotencyKey: input.dedupKey,
    source: {
      ledgerAccountId: input.settlementAccount.ledgerAccountId,
      channelName: input.settlementAccount.name,
      settlementAccountId: input.settlementAccount.id,
    },
    preferredOverpaymentSavingsAccountId: savingsAccount.id,
  });

  // Mirrors the repayment as a savings withdrawal so the client's displayed balance matches.
  // This intentionally does NOT post its own ledger journal (postJournal:false): the dedicated
  // settlement account used above is mapped directly to the same savings-liability GL account, so
  // applyRepaymentInTransaction() has already posted the liability-side DEBIT. Posting a second
  // journal here would double-count that reduction.
  await recordSavingsTransactionInTransaction(transaction, {
    savingsAccountId: savingsAccount.id,
    actorUserId: input.systemUserId,
    transactionType: "WITHDRAWAL",
    amountMinor: sweepAmountMinor,
    settlementAccountId: input.settlementAccount.id,
    reason: "Standing order sweep",
    externalReference: `Standing order sweep for loan ${loan.accountNumber}`,
    idempotencyKey: `${input.dedupKey}:savings-mirror`,
    businessDate: input.now,
    postJournal: false,
  });

  return {
    outcome: "swept",
    amountMinor: sweepAmountMinor,
    notificationContext: {
      loanId: loan.id,
      installmentId: oldestOutstandingInstallment.id,
      clientId: loan.clientId,
      accountNumber: loan.accountNumber,
      dueOn: oldestOutstandingInstallment.dueOn.toISOString(),
      currencyCode: loan.denominationCurrency,
      mobileNumber: loan.client?.mobileNumber ?? job.mobileNumber,
    },
  };
}

export async function listStandingOrderSweepJobs(
  prisma: PrismaClient,
  options: Readonly<{
    now?: Date;
    clientId?: string;
    preferredSavingsAccountId?: string;
    buildRequestKey: (loanId: string) => string;
  }>,
): Promise<StandingOrderSweepJob[]> {
  const now = options.now ?? new Date();
  const dayEnd = endOfUtcDay(now);
  const loans = await prisma.loan.findMany({
    where: {
      status: { in: [...STANDING_ORDER_OPEN_LOAN_STATUSES] },
      ...(options.clientId ? { clientId: options.clientId } : { clientId: { not: null } }),
      installments: { some: { dueOn: { lt: dayEnd } } },
    },
    select: {
      id: true,
      clientId: true,
      accountNumber: true,
      denominationCurrency: true,
      installments: {
        where: { dueOn: { lt: dayEnd } },
        orderBy: [{ dueOn: "asc" }, { installmentNumber: "asc" }],
        select: {
          id: true,
          dueOn: true,
          principalDueMinor: true,
          interestDueMinor: true,
          feesDueMinor: true,
          penaltiesDueMinor: true,
          monitoringFeeDueMinor: true,
          principalPaidMinor: true,
          interestPaidMinor: true,
          feesPaidMinor: true,
          penaltiesPaidMinor: true,
          monitoringFeePaidMinor: true,
          principalWaivedMinor: true,
          interestWaivedMinor: true,
          feesWaivedMinor: true,
          penaltiesWaivedMinor: true,
          monitoringFeeWaivedMinor: true,
        },
      },
      client: {
        select: {
          mobileNumber: true,
          // Standing orders only ever sweep a member's own Member Savings Account (MSA) --
          // not compulsory savings, security-fee, LIF, or group-general accounts, which serve
          // other purposes and must not be drained by an automated loan sweep.
          savingsAccounts: {
            where: { status: "ACTIVE", product: { shortName: "MSA" } },
            select: { id: true, isDefault: true, currencyCode: true },
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          },
        },
      },
    },
  });

  return loans
    .flatMap((loan) => {
      if (!loan.clientId) return [];
      const outstandingInstallments = listOutstandingInstallments(loan.installments);
      const oldestOutstandingInstallment = outstandingInstallments[0];
      if (!oldestOutstandingInstallment) return [];

      const savingsAccount = resolveStandingOrderFundingAccount(
        loan.client?.savingsAccounts ?? [],
        loan.denominationCurrency,
        options.preferredSavingsAccountId,
      );
      if (!savingsAccount) return [];

      const outstandingMinor = outstandingInstallments.reduce(
        (sum, installment) => sum + installment.outstandingMinor,
        0n,
      );
      if (outstandingMinor <= 0n) return [];

      return [
        {
          requestKey: options.buildRequestKey(loan.id),
          loanId: loan.id,
          installmentId: oldestOutstandingInstallment.id,
          clientId: loan.clientId,
          savingsAccountId: savingsAccount.id,
          accountNumber: loan.accountNumber,
          dueOn: oldestOutstandingInstallment.dueOn.toISOString(),
          outstandingMinor: outstandingMinor.toString(),
          currencyCode: loan.denominationCurrency,
          mobileNumber: loan.client?.mobileNumber ?? null,
        } satisfies StandingOrderSweepJob,
      ];
    })
    .sort((left, right) =>
      left.dueOn.localeCompare(right.dueOn) || left.accountNumber.localeCompare(right.accountNumber),
    );
}

export async function executeStandingOrderSweepsForSavingsDeposit(
  prisma: PrismaClient,
  input: Readonly<{
    savingsAccountId: string;
    savingsTransactionId: string;
    now?: Date;
  }>,
): Promise<number> {
  const savingsAccount = await prisma.savingsAccount.findUnique({
    where: { id: input.savingsAccountId },
    select: { id: true, clientId: true, status: true },
  });
  if (!savingsAccount || savingsAccount.status !== "ACTIVE" || !savingsAccount.clientId) return 0;

  const jobs = await listStandingOrderSweepJobs(prisma, {
    now: input.now,
    clientId: savingsAccount.clientId,
    preferredSavingsAccountId: savingsAccount.id,
    buildRequestKey: (loanId) =>
      buildStandingOrderDepositRequestKey(loanId, input.savingsTransactionId),
  });

  let swept = 0;
  for (const job of jobs) {
    const result = await executeStandingOrderSweep(prisma, job, input.now);
    if (result.outcome === "swept") swept += 1;
    if (
      result.outcome === "skipped" &&
      result.reason === "No available savings balance to sweep"
    ) {
      break;
    }
  }

  return swept;
}

/**
 * Executes one standing-order sweep job: posts an internal savings-funded repayment capped at the
 * loan's currently due/overdue balance, then mirrors the savings withdrawal without a second
 * journal. The repayment and savings mirror are written inside one SERIALIZABLE database
 * transaction, so a retry can never leave the loan paid without the savings balance reduced.
 */
export async function executeStandingOrderSweep(
  prisma: PrismaClient,
  job: StandingOrderSweepJob,
  now = new Date(),
): Promise<StandingOrderSweepResult> {
  const dedupKey = standingOrderSweepJobId(job);
  const existingRepayment = await prisma.loanTransaction.findUnique({
    where: { idempotencyKey: dedupKey },
    select: { settlementAmountMinor: true },
  });
  if (existingRepayment) {
    await upsertStandingOrderSweepNotification(
      prisma,
      {
        loanId: job.loanId,
        installmentId: job.installmentId,
        clientId: job.clientId,
        accountNumber: job.accountNumber,
        dueOn: job.dueOn,
        currencyCode: job.currencyCode,
        mobileNumber: job.mobileNumber,
      },
      dedupKey,
      existingRepayment.settlementAmountMinor,
      now,
    );
    return { outcome: "swept", amountMinor: existingRepayment.settlementAmountMinor };
  }

  const [systemUser, settlementAccount] = await Promise.all([
    prisma.user.findUnique({
      where: { email: STANDING_ORDER_SYSTEM_EMAIL },
      select: { id: true },
    }),
    prisma.settlementAccount.findFirst({
      where: { name: STANDING_ORDER_SETTLEMENT_ACCOUNT_NAME, active: true },
      select: { id: true, name: true, ledgerAccountId: true },
    }),
  ]);
  if (!systemUser) {
    return { outcome: "skipped", reason: "Standing-order automation user is not provisioned" };
  }
  if (!settlementAccount) {
    return {
      outcome: "skipped",
      reason: "Standing-order sweep settlement account is not provisioned",
    };
  }

  const result = await prisma.$transaction(
    async (transaction) =>
      executeStandingOrderSweepInTransaction(transaction, job, {
        dedupKey,
        now,
        systemUserId: systemUser.id,
        settlementAccount,
      }),
    { isolationLevel: "Serializable" },
  );
  if (result.outcome !== "swept") return result;

  await upsertStandingOrderSweepNotification(
    prisma,
    result.notificationContext ?? {
      loanId: job.loanId,
      installmentId: job.installmentId,
      clientId: job.clientId,
      accountNumber: job.accountNumber,
      dueOn: job.dueOn,
      currencyCode: job.currencyCode,
      mobileNumber: job.mobileNumber,
    },
    dedupKey,
    result.amountMinor,
    now,
  );
  return { outcome: "swept", amountMinor: result.amountMinor };
}
