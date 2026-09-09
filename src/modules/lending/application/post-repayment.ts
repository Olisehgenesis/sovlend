import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { permissions } from "@/modules/identity/domain/permissions";
import { assertPeriodOpen } from "@/modules/ledger/application/assert-period-open";
import { assertBalancedJournal } from "@/modules/ledger/domain/journal";
import { recordSavingsTransactionInTransaction } from "@/modules/savings/application/record-savings-transaction";
import { resolveSavingsLiabilityAccountId } from "@/modules/savings/application/savings-ledger";
import { allocateRepayment } from "../domain/repayment-allocation";
import { installmentDueMinor, installmentPaidMinor } from "../domain/loan-outstanding";

const OPEN_LOAN_STATUSES = ["ACTIVE", "IN_ARREARS", "OVERPAID"] as const;

type Tx = Prisma.TransactionClient;

// Where the DEBIT leg of a repayment journal lands. A teller-recorded repayment debits a real
// settlement/cash account (settlementAccountId set); an internal savings->loan transfer instead
// debits the client's own savings liability account directly -- no cash account is ever touched
// because no money leaves the institution.
type RepaymentDebitSource = Readonly<{
  ledgerAccountId: string;
  channelName: string;
  settlementAccountId?: string;
}>;

export type ApplyRepaymentParams = Readonly<{
  loanId: string;
  amountMinor: bigint;
  businessDate: Date;
  externalReference?: string;
  idempotencyKey: string;
  actorUserId: string | null;
  source: RepaymentDebitSource;
  preferredOverpaymentSavingsAccountId?: string;
}>;

type OverpaymentSweepSavingsAccount = Readonly<{
  id: string;
  accountNumber: string;
  productId: string | null;
  isDefault: boolean;
  product: { shortName: string } | null;
}>;

export function buildLoanOverpaymentSavingsIdempotencyKey(loanTransactionId: string) {
  return `loan-overpayment:${loanTransactionId}:savings-credit`;
}

function buildLoanOverpaymentSweepReason(loanAccountNumber: string) {
  return `Loan overpayment sweep - ${loanAccountNumber}`;
}

async function resolveOverpaymentSweepSavingsAccount(
  transaction: Tx,
  input: Readonly<{
    clientId: string | null;
    groupId: string | null;
    currencyCode: string;
    preferredSavingsAccountId?: string;
  }>,
): Promise<OverpaymentSweepSavingsAccount | null> {
  if (!input.clientId && !input.groupId) return null;

  const accounts = await transaction.savingsAccount.findMany({
    where: {
      ...(input.clientId ? { clientId: input.clientId } : { groupId: input.groupId }),
      status: "ACTIVE",
      currencyCode: input.currencyCode,
    },
    select: {
      id: true,
      accountNumber: true,
      productId: true,
      isDefault: true,
      product: { select: { shortName: true } },
    },
    // Tie-break rule for sweeping excess into savings:
    //   1. an explicitly related/funding account when the caller provides one,
    //   2. otherwise the client's designated default account,
    //   3. otherwise the oldest active account.
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  if (accounts.length === 0) return null;
  if (input.preferredSavingsAccountId) {
    const preferred = accounts.find((account) => account.id === input.preferredSavingsAccountId);
    if (preferred) return preferred;
  }
  return accounts[0] ?? null;
}

/**
 * Core repayment posting logic shared by postRepayment() (funded by a settlement/cash account)
 * and transferSavingsToLoan() (funded directly from the client's own savings balance). Runs the
 * waterfall allocation, updates installments, posts one balanced journal (DEBIT source.ledgerAccountId
 * / CREDIT the loan's income+receivable buckets), transitions loan status, and writes audit/outbox
 * events. Callers are responsible for their own idempotency short-circuit before/after this runs
 * inside their own $transaction, and for any authorization checks.
 */
export async function applyRepaymentInTransaction(transaction: Tx, params: ApplyRepaymentParams) {
  const current = await transaction.loan.findUniqueOrThrow({
    where: { id: params.loanId },
    include: {
      installments: { orderBy: [{ dueOn: "asc" }, { installmentNumber: "asc" }] },
      product: { include: { accountingMapping: true } },
      office: true,
    },
  });
  const mapping = current.product.accountingMapping;
  if (!mapping) throw new Error("Loan product accounting mapping is required before repayment");
  await assertPeriodOpen(transaction, { officeId: current.officeId, businessDate: params.businessDate });
  const allocation = allocateRepayment(current.installments, params.amountMinor);
  if (allocation.interestMinor > 0n && !mapping.interestIncomeAccountId) throw new Error("Interest income account is not configured");
  if (allocation.feesMinor > 0n && !mapping.feeIncomeAccountId) throw new Error("Fee income account is not configured");
  // Monitoring fee posts to its own dedicated income account (see Problem 2 in the accounting
  // audit) so it never shares a ledger line with interest or generic fees even when their rates
  // coincide, falling back to the legacy feeIncomeAccountId for organizations that have not yet
  // configured monitoringFeeIncomeAccountId.
  const monitoringFeeIncomeAccountId = mapping.monitoringFeeIncomeAccountId ?? mapping.feeIncomeAccountId;
  if (allocation.monitoringFeeMinor > 0n && !monitoringFeeIncomeAccountId) throw new Error("Monitoring fee income account is not configured");
  const assessedPenaltyMinor = allocation.allocations.reduce((sum, item) => sum + (item.penaltyAssessedOn ? item.penaltiesMinor : 0n), 0n);
  const unassessedPenaltyMinor = allocation.penaltiesMinor - assessedPenaltyMinor;
  if (unassessedPenaltyMinor > 0n && !mapping.penaltyIncomeAccountId) throw new Error("Penalty income account is not configured");
  if (assessedPenaltyMinor > 0n && !mapping.penaltyReceivableAccountId) throw new Error("Penalty receivable account is not configured");
  const overpaymentSweepAccount =
   allocation.overpaymentMinor > 0n
     ? await resolveOverpaymentSweepSavingsAccount(transaction, {
         clientId: current.clientId,
         groupId: current.groupId,
         currencyCode: current.denominationCurrency,
         preferredSavingsAccountId: params.preferredOverpaymentSavingsAccountId,
       })
     : null;
  const overpaymentSweepLiabilityAccountId = overpaymentSweepAccount
   ? await resolveSavingsLiabilityAccountId(transaction, {
       organizationId: current.office.organizationId,
       savingsProductId: overpaymentSweepAccount.productId,
       savingsProductShortName: overpaymentSweepAccount.product?.shortName ?? null,
     })
   : null;
  const sweptOverpaymentMinor = overpaymentSweepAccount ? allocation.overpaymentMinor : 0n;
  const retainedOverpaymentMinor = allocation.overpaymentMinor - sweptOverpaymentMinor;
  if (retainedOverpaymentMinor > 0n && !mapping.overpaymentLiabilityAccountId) {
   throw new Error("Overpayment liability account is not configured");
  }

  const transactionRecord = await transaction.loanTransaction.create({
    data: {
      loanId: current.id,
      transactionType: "REPAYMENT",
      businessDate: params.businessDate,
      settlementCurrency: current.denominationCurrency,
      settlementChannel: params.source.channelName,
      settlementAccountId: params.source.settlementAccountId,
      settlementAmountMinor: params.amountMinor,
      denominationAmountMinor: params.amountMinor,
      externalReference: params.externalReference,
      idempotencyKey: params.idempotencyKey,
      recordedByUserId: params.actorUserId ?? undefined,
    },
  });
  for (const item of allocation.allocations) {
    await transaction.loanInstallment.update({
      where: { id: item.installmentId },
      data: {
        principalPaidMinor: { increment: item.principalMinor },
        interestPaidMinor: { increment: item.interestMinor },
        feesPaidMinor: { increment: item.feesMinor },
        penaltiesPaidMinor: { increment: item.penaltiesMinor },
        monitoringFeePaidMinor: { increment: item.monitoringFeeMinor },
      },
    });
    await transaction.loanTransactionAllocation.create({
      data: {
        transactionId: transactionRecord.id,
        installmentId: item.installmentId,
        principalMinor: item.principalMinor,
        interestMinor: item.interestMinor,
        feesMinor: item.feesMinor,
        penaltiesMinor: item.penaltiesMinor,
        monitoringFeeMinor: item.monitoringFeeMinor,
      },
    });
  }
  const penaltyCredits =
    assessedPenaltyMinor > 0n
      ? [
          { accountId: mapping.penaltyReceivableAccountId, amount: assessedPenaltyMinor, memo: "Penalties" },
          { accountId: mapping.penaltyIncomeAccountId, amount: unassessedPenaltyMinor, memo: "Penalties" },
        ]
      : [{ accountId: mapping.penaltyIncomeAccountId, amount: allocation.penaltiesMinor, memo: "Penalties" }];
  const journal = await transaction.journal.create({
    data: {
      officeId: current.officeId,
      businessDate: params.businessDate,
      referenceType: "LOAN_REPAYMENT",
      referenceId: transactionRecord.id,
      narration: `Repayment ${current.accountNumber}`,
      idempotencyKey: `journal:${params.idempotencyKey}`,
    },
  });
  const credits = [
    { accountId: mapping.principalReceivableAccountId, amount: allocation.principalMinor, memo: "Principal" },
    { accountId: mapping.interestIncomeAccountId, amount: allocation.interestMinor, memo: "Interest" },
    { accountId: mapping.feeIncomeAccountId, amount: allocation.feesMinor, memo: "Fees" },
    { accountId: monitoringFeeIncomeAccountId, amount: allocation.monitoringFeeMinor, memo: "Monitoring fee" },
    ...penaltyCredits,
    {
      accountId: overpaymentSweepLiabilityAccountId,
      amount: sweptOverpaymentMinor,
      memo: overpaymentSweepAccount?.accountNumber ?? "Overpayment sweep",
    },
    { accountId: mapping.overpaymentLiabilityAccountId, amount: retainedOverpaymentMinor, memo: "Overpayment" },
  ].filter((line): line is { accountId: string; amount: bigint; memo: string } => Boolean(line.accountId) && line.amount > 0n);
  const journalLines = [
    { journalId: journal.id, accountId: params.source.ledgerAccountId, direction: "DEBIT" as const, amountMinor: params.amountMinor, memo: params.source.channelName },
    ...credits.map((line) => ({ journalId: journal.id, accountId: line.accountId, direction: "CREDIT" as const, amountMinor: line.amount, memo: line.memo })),
  ];
  assertBalancedJournal(journalLines.map((line) => ({ ...line, currencyCode: current.denominationCurrency })));
  await transaction.journalLine.createMany({ data: journalLines });
  await transaction.journal.update({ where: { id: journal.id }, data: { status: "POSTED", postedAt: new Date() } });
  if (sweptOverpaymentMinor > 0n && overpaymentSweepAccount) {
    const sweepReason = buildLoanOverpaymentSweepReason(current.accountNumber);
    await recordSavingsTransactionInTransaction(transaction, {
      savingsAccountId: overpaymentSweepAccount.id,
      actorUserId: params.actorUserId,
      transactionType: "DEPOSIT",
      amountMinor: sweptOverpaymentMinor,
      settlementAccountId: params.source.settlementAccountId,
      reason: sweepReason,
      externalReference: params.externalReference ?? sweepReason,
      idempotencyKey: buildLoanOverpaymentSavingsIdempotencyKey(transactionRecord.id),
      businessDate: params.businessDate,
      postJournal: false,
    });
  } else if (retainedOverpaymentMinor > 0n) {
    console.warn(
      `[post-repayment] Loan ${current.accountNumber} retained ${retainedOverpaymentMinor.toString()} in overpayment liability because no active savings account was available for the owner.`,
    );
  }
  const totalOutstanding = current.installments.reduce((sum, installment) => sum + installmentDueMinor(installment) - installmentPaidMinor(installment), 0n);
  const remainingAfter = totalOutstanding - (params.amountMinor - allocation.overpaymentMinor);
  const allocatedByInstallment = new Map(allocation.allocations.map((item) => [item.installmentId, item]));
  const overdueRemainingAfter = current.installments.filter((installment) => installment.dueOn < params.businessDate).reduce((sum, installment) => {
    const item = allocatedByInstallment.get(installment.id);
    return sum + installmentDueMinor(installment) - installmentPaidMinor(installment) - (item?.principalMinor ?? 0n) - (item?.interestMinor ?? 0n) - (item?.feesMinor ?? 0n) - (item?.penaltiesMinor ?? 0n) - (item?.monitoringFeeMinor ?? 0n);
  }, 0n);
  if (retainedOverpaymentMinor > 0n) await transaction.loan.update({ where: { id: current.id }, data: { status: "OVERPAID" } });
  else if (remainingAfter <= 0n) await transaction.loan.update({ where: { id: current.id }, data: { status: "CLOSED" } });
  else if (current.status === "IN_ARREARS" && overdueRemainingAfter <= 0n) await transaction.loan.update({ where: { id: current.id }, data: { status: "ACTIVE" } });
  const correlationId = randomUUID();
  const metadata = {
    loanId: current.id,
    amountMinor: params.amountMinor.toString(),
    settlementAccountId: params.source.settlementAccountId ?? null,
    settlementAccount: params.source.channelName,
    allocation: {
      principal: allocation.principalMinor.toString(),
      interest: allocation.interestMinor.toString(),
      fees: allocation.feesMinor.toString(),
      monitoringFee: allocation.monitoringFeeMinor.toString(),
      penalties: allocation.penaltiesMinor.toString(),
      overpayment: allocation.overpaymentMinor.toString(),
    },
    overpaymentSweep:
      sweptOverpaymentMinor > 0n && overpaymentSweepAccount
        ? {
            savingsAccountId: overpaymentSweepAccount.id,
            savingsAccountNumber: overpaymentSweepAccount.accountNumber,
            amountMinor: sweptOverpaymentMinor.toString(),
          }
        : null,
    overpaymentRetainedOnLiability: retainedOverpaymentMinor > 0n,
  };
  const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.repayment.recorded", metadata })).digest("hex");
  await transaction.auditEvent.create({ data: { actorId: params.actorUserId, action: "loan.repayment.recorded", entityType: "Loan", entityId: current.id, correlationId, metadata, eventHash } });
  await transaction.outboxEvent.create({ data: { aggregateType: "Loan", aggregateId: current.id, eventType: "loan.repayment.recorded", payload: metadata } });
  return transactionRecord;
}

export async function postRepayment(
  prisma: PrismaClient,
  command: { loanId: string; actorUserId: string; amountMinor: bigint; settlementAccountId: string; businessDate: Date; externalReference?: string; idempotencyKey: string },
) {
  if (command.amountMinor <= 0n) throw new Error("Repayment must be positive");
  const existing = await prisma.loanTransaction.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
  if (existing) return existing;
  const loan = await prisma.loan.findUnique({ where: { id: command.loanId }, include: { office: true } });
  if (!loan) throw new Error("Loan not found");
  if (!(OPEN_LOAN_STATUSES as readonly string[]).includes(loan.status)) throw new Error("Loan is not open for repayment");
  if (loan.denominationCurrency !== "UGX") throw new Error("Only UGX-denominated repayments are enabled");
  await new AuthorizationService(prisma).assertAllowed({ actorUserId: command.actorUserId, permission: permissions.loanRepayment, organizationId: loan.office.organizationId, officeId: loan.officeId });

  return prisma.$transaction(async (transaction) => {
    const duplicate = await transaction.loanTransaction.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
    if (duplicate) return duplicate;
    const settlement = await transaction.settlementAccount.findFirst({ where: { id: command.settlementAccountId, organizationId: loan.office.organizationId, currencyCode: loan.denominationCurrency, active: true } });
    if (!settlement) throw new Error("Selected settlement account is not available");
    return applyRepaymentInTransaction(transaction, {
      loanId: loan.id,
      amountMinor: command.amountMinor,
      businessDate: command.businessDate,
      externalReference: command.externalReference,
      idempotencyKey: command.idempotencyKey,
      actorUserId: command.actorUserId,
      source: { ledgerAccountId: settlement.ledgerAccountId, channelName: settlement.name, settlementAccountId: settlement.id },
    });
  }, { isolationLevel: "Serializable" });
}

export type TransferSavingsToLoanCommand = Readonly<{
  savingsAccountId: string;
  loanId: string;
  actorUserId: string;
  amountMinor: bigint;
  businessDate: Date;
  externalReference?: string;
  idempotencyKey: string;
}>;

/**
 * Moves money from a client's own savings account to pay down their own loan, with no cash
 * leaving the institution. Unlike postRepayment(), this never touches a settlement account: the
 * journal DEBITs the savings liability account directly (via resolveSavingsLiabilityAccountId,
 * the same helper disburse-loan.ts uses) and CREDITs the loan's income/receivable buckets exactly
 * like a normal repayment. The savings balance reduction is mirrored as a WITHDRAWAL
 * SavingsTransaction with postJournal:false, since the journal above already covers the
 * liability-side leg -- posting a second journal here would double-count it (same pattern
 * disburse-loan.ts and execute-standing-order-sweep.ts already use for their savings mirrors).
 */
export async function transferSavingsToLoan(prisma: PrismaClient, command: TransferSavingsToLoanCommand) {
  if (command.amountMinor <= 0n) throw new Error("Transfer amount must be positive");
  const existing = await prisma.loanTransaction.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
  if (existing) return existing;

  const loan = await prisma.loan.findUnique({ where: { id: command.loanId }, include: { office: true } });
  if (!loan) throw new Error("Loan not found");
  if (!(OPEN_LOAN_STATUSES as readonly string[]).includes(loan.status)) throw new Error("Loan is not open for repayment");
  if (loan.denominationCurrency !== "UGX") throw new Error("Only UGX-denominated repayments are enabled");

  const savingsAccount = await prisma.savingsAccount.findUnique({
    where: { id: command.savingsAccountId },
    select: { id: true, clientId: true, groupId: true, status: true, currencyCode: true },
  });
  if (!savingsAccount) throw new Error("Savings account not found");
  if (savingsAccount.status !== "ACTIVE") throw new Error("Savings account is not active");
  if (savingsAccount.currencyCode !== loan.denominationCurrency) throw new Error("Savings account currency does not match the loan");
  // An internal transfer only ever moves money between a member's own accounts, never between
  // different members -- reject anything else outright rather than silently allowing it.
  const sameOwner =
    (savingsAccount.clientId != null && savingsAccount.clientId === loan.clientId) ||
    (savingsAccount.groupId != null && savingsAccount.groupId === loan.groupId);
  if (!sameOwner) throw new Error("Savings account and loan must belong to the same client or group");

  const authorization = new AuthorizationService(prisma);
  await authorization.assertAllowed({ actorUserId: command.actorUserId, permission: permissions.loanRepayment, organizationId: loan.office.organizationId, officeId: loan.officeId });
  await authorization.assertAllowed({ actorUserId: command.actorUserId, permission: permissions.savingsTransact, organizationId: loan.office.organizationId, officeId: loan.officeId });

  return prisma.$transaction(async (transaction) => {
    const duplicate = await transaction.loanTransaction.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
    if (duplicate) return duplicate;

    const account = await transaction.savingsAccount.findUniqueOrThrow({
      where: { id: command.savingsAccountId },
      select: {
        id: true,
        accountNumber: true,
        productId: true,
        transactions: { select: { amountMinor: true } },
        client: { select: { organizationId: true } },
        group: { select: { organizationId: true } },
        product: { select: { shortName: true } },
      },
    });
    const balance = account.transactions.reduce((sum, item) => sum + item.amountMinor, 0n);
    if (command.amountMinor > balance) throw new Error("Transfer exceeds the available savings balance");

    const organizationId = account.client?.organizationId ?? account.group?.organizationId ?? loan.office.organizationId;
    const savingsLiabilityAccountId = await resolveSavingsLiabilityAccountId(transaction, {
      organizationId,
      savingsProductId: account.productId,
      savingsProductShortName: account.product?.shortName ?? null,
    });

    const transactionRecord = await applyRepaymentInTransaction(transaction, {
      loanId: loan.id,
      amountMinor: command.amountMinor,
      businessDate: command.businessDate,
      externalReference: command.externalReference,
      idempotencyKey: command.idempotencyKey,
      actorUserId: command.actorUserId,
      source: { ledgerAccountId: savingsLiabilityAccountId, channelName: `Savings ${account.accountNumber}` },
      preferredOverpaymentSavingsAccountId: account.id,
    });

    await recordSavingsTransactionInTransaction(transaction, {
      savingsAccountId: account.id,
      actorUserId: command.actorUserId,
      transactionType: "WITHDRAWAL",
      amountMinor: command.amountMinor,
      reason: command.externalReference ?? `Transfer to loan ${loan.accountNumber}`,
      idempotencyKey: `savings-to-loan-transfer:${transactionRecord.id}:savings-debit`,
      businessDate: command.businessDate,
      postJournal: false,
    });

    return transactionRecord;
  }, { isolationLevel: "Serializable" });
}
