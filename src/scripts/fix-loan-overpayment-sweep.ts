import { prisma } from "@/lib/prisma";
import { assertBalancedJournal } from "@/modules/ledger/domain/journal";
import { buildLoanOverpaymentSavingsIdempotencyKey } from "@/modules/lending/application/post-repayment";
import { installmentDueMinor, installmentPaidMinor } from "@/modules/lending/domain/loan-outstanding";
import { formatMinor } from "@/modules/money/domain/format-minor";
import { recordSavingsTransactionInTransaction } from "@/modules/savings/application/post-savings-transaction";
import { resolveSavingsLiabilityAccountId } from "@/modules/savings/application/savings-ledger";

const TARGET_LOAN_ID = "02025d79-f4d4-4892-bdd5-d4a06c7349bd";
const TARGET_EXTERNAL_REFERENCE = "finsihing kain";
const TARGET_REPAYMENT_AMOUNT_MINOR = 28_000_000n;

function ensureLocalDevDatabase() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.includes("localhost:5433")) {
    throw new Error("Refusing to run: this fix script is restricted to the local dev database on localhost:5433.");
  }
}

function buildSweepReason(loanAccountNumber: string) {
  return `Loan overpayment sweep - ${loanAccountNumber}`;
}

function buildSweepJournalIdempotencyKey(repaymentTransactionId: string) {
  return `journal:loan-overpayment:${repaymentTransactionId}:reclass`;
}

async function loadSnapshot() {
  const loan = await prisma.loan.findUniqueOrThrow({
    where: { id: TARGET_LOAN_ID },
    include: {
      client: {
        select: {
          accountNumber: true,
          firstName: true,
          lastName: true,
          savingsAccounts: {
            where: { status: "ACTIVE", currencyCode: "UGX" },
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
            select: {
              id: true,
              accountNumber: true,
              isDefault: true,
              transactions: { select: { amountMinor: true } },
            },
          },
        },
      },
      installments: {
        orderBy: [{ dueOn: "asc" }, { installmentNumber: "asc" }],
      },
    },
  });
  const repayment = await prisma.loanTransaction.findFirstOrThrow({
    where: {
      loanId: TARGET_LOAN_ID,
      transactionType: "REPAYMENT",
      settlementAmountMinor: TARGET_REPAYMENT_AMOUNT_MINOR,
      externalReference: TARGET_EXTERNAL_REFERENCE,
    },
    select: {
      id: true,
      businessDate: true,
      settlementAmountMinor: true,
      externalReference: true,
    },
  });
  const allocations = await prisma.loanTransactionAllocation.findMany({
    where: { transactionId: repayment.id },
    select: {
      principalMinor: true,
      interestMinor: true,
      feesMinor: true,
      penaltiesMinor: true,
      monitoringFeeMinor: true,
    },
  });
  const selectedSavings = loan.client?.savingsAccounts[0] ?? null;
  const selectedSavingsBalanceMinor = selectedSavings
    ? selectedSavings.transactions.reduce((sum, transaction) => sum + transaction.amountMinor, 0n)
    : null;
  const outstandingMinor = loan.installments.reduce(
    (sum, installment) => sum + installmentDueMinor(installment) - installmentPaidMinor(installment),
    0n,
  );
  const allocatedMinor = allocations.reduce(
    (sum, allocation) =>
      sum +
      allocation.principalMinor +
      allocation.interestMinor +
      allocation.feesMinor +
      allocation.penaltiesMinor +
      allocation.monitoringFeeMinor,
    0n,
  );
  const overpaymentMinor = repayment.settlementAmountMinor - allocatedMinor;

  return {
    loanAccountNumber: loan.accountNumber,
    loanStatus: loan.status,
    clientAccountNumber: loan.client?.accountNumber ?? null,
    clientName: loan.client ? `${loan.client.firstName} ${loan.client.lastName}` : null,
    savingsAccountNumber: selectedSavings?.accountNumber ?? null,
    savingsBalanceMinor: selectedSavingsBalanceMinor,
    outstandingMinor,
    repaymentId: repayment.id,
    overpaymentMinor,
  };
}

async function main() {
  ensureLocalDevDatabase();

  const before = await loadSnapshot();
  console.log("=== Before ===");
  console.log(`Client: ${before.clientName} (${before.clientAccountNumber})`);
  console.log(`Loan: ${before.loanAccountNumber} status=${before.loanStatus} outstanding=${formatMinor(before.outstandingMinor, "UGX")}`);
  console.log(
    `Savings: ${before.savingsAccountNumber ?? "none"} balance=${before.savingsBalanceMinor === null ? "n/a" : formatMinor(before.savingsBalanceMinor, "UGX")}`,
  );
  console.log(`Repayment: ${before.repaymentId} overpayment=${formatMinor(before.overpaymentMinor, "UGX")}`);

  await prisma.$transaction(
    async (tx) => {
      const loan = await tx.loan.findUniqueOrThrow({
        where: { id: TARGET_LOAN_ID },
        include: {
          client: {
            select: {
              accountNumber: true,
              savingsAccounts: {
                where: { status: "ACTIVE", currencyCode: "UGX" },
                orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
                select: {
                  id: true,
                  accountNumber: true,
                  productId: true,
                  isDefault: true,
                  product: { select: { shortName: true } },
                },
              },
            },
          },
          product: { include: { accountingMapping: true } },
          office: true,
          installments: true,
        },
      });

      const repayment = await tx.loanTransaction.findFirstOrThrow({
        where: {
          loanId: TARGET_LOAN_ID,
          transactionType: "REPAYMENT",
          settlementAmountMinor: TARGET_REPAYMENT_AMOUNT_MINOR,
          externalReference: TARGET_EXTERNAL_REFERENCE,
        },
        select: {
          id: true,
          businessDate: true,
          settlementAmountMinor: true,
          settlementAccountId: true,
          externalReference: true,
        },
      });

      const allocations = await tx.loanTransactionAllocation.findMany({
        where: { transactionId: repayment.id },
        select: {
          principalMinor: true,
          interestMinor: true,
          feesMinor: true,
          penaltiesMinor: true,
          monitoringFeeMinor: true,
        },
      });
      const allocatedMinor = allocations.reduce(
        (sum, allocation) =>
          sum +
          allocation.principalMinor +
          allocation.interestMinor +
          allocation.feesMinor +
          allocation.penaltiesMinor +
          allocation.monitoringFeeMinor,
        0n,
      );
      const overpaymentMinor = repayment.settlementAmountMinor - allocatedMinor;
      if (overpaymentMinor <= 0n) {
        throw new Error("Target repayment is not overpaid; nothing to sweep.");
      }

      const mapping = loan.product.accountingMapping;
      if (!mapping?.overpaymentLiabilityAccountId) {
        throw new Error("Loan overpayment liability account is not configured.");
      }

      const savingsAccount = loan.client?.savingsAccounts[0] ?? null;
      if (!savingsAccount) {
        throw new Error("Client has no active UGX savings account to receive the overpayment sweep.");
      }

      const savingsLiabilityAccountId = await resolveSavingsLiabilityAccountId(tx, {
        organizationId: loan.office.organizationId,
        savingsProductId: savingsAccount.productId,
        savingsProductShortName: savingsAccount.product?.shortName ?? null,
      });
      const savingsIdempotencyKey = buildLoanOverpaymentSavingsIdempotencyKey(repayment.id);
      const sweepJournalIdempotencyKey = buildSweepJournalIdempotencyKey(repayment.id);
      const sweepReason = buildSweepReason(loan.accountNumber);

      const [existingSweepJournal, existingSavingsTx, repaymentJournal] = await Promise.all([
        tx.journal.findUnique({ where: { idempotencyKey: sweepJournalIdempotencyKey } }),
        tx.savingsTransaction.findUnique({ where: { idempotencyKey: savingsIdempotencyKey } }),
        tx.journal.findFirst({
          where: {
            referenceType: "LOAN_REPAYMENT",
            referenceId: repayment.id,
          },
          include: { lines: true },
        }),
      ]);

      if (!repaymentJournal) {
        throw new Error("Original repayment journal was not found.");
      }
      const recordedLiabilityCredit = repaymentJournal.lines.find(
        (line) =>
          line.accountId === mapping.overpaymentLiabilityAccountId &&
          line.direction === "CREDIT",
      );
      if (!recordedLiabilityCredit && !existingSweepJournal) {
        throw new Error("Original repayment journal does not contain the expected overpayment liability credit.");
      }
      if (recordedLiabilityCredit && recordedLiabilityCredit.amountMinor !== overpaymentMinor && !existingSweepJournal) {
        throw new Error(
          `Original repayment journal credited ${recordedLiabilityCredit.amountMinor.toString()} but expected ${overpaymentMinor.toString()} of overpayment.`,
        );
      }

      if (!existingSavingsTx) {
        await recordSavingsTransactionInTransaction(tx, {
          savingsAccountId: savingsAccount.id,
          actorUserId: null,
          transactionType: "DEPOSIT",
          amountMinor: overpaymentMinor,
          settlementAccountId: repayment.settlementAccountId ?? undefined,
          reason: sweepReason,
          externalReference: repayment.externalReference ?? sweepReason,
          idempotencyKey: savingsIdempotencyKey,
          businessDate: repayment.businessDate,
          postJournal: false,
        });
      }

      if (!existingSweepJournal) {
        const journalLines = [
          {
            accountId: mapping.overpaymentLiabilityAccountId,
            currencyCode: loan.denominationCurrency,
            direction: "DEBIT" as const,
            amountMinor: overpaymentMinor,
            memo: "Overpayment sweep",
          },
          {
            accountId: savingsLiabilityAccountId,
            currencyCode: loan.denominationCurrency,
            direction: "CREDIT" as const,
            amountMinor: overpaymentMinor,
            memo: savingsAccount.accountNumber,
          },
        ];
        assertBalancedJournal(journalLines);

        const journal = await tx.journal.create({
          data: {
            officeId: loan.officeId,
            businessDate: repayment.businessDate,
            referenceType: "LOAN_OVERPAYMENT_SWEEP",
            referenceId: repayment.id,
            narration: `Overpayment sweep ${loan.accountNumber}`,
            idempotencyKey: sweepJournalIdempotencyKey,
          },
        });
        await tx.journalLine.createMany({
          data: journalLines.map((line) => ({
            journalId: journal.id,
            accountId: line.accountId,
            direction: line.direction,
            amountMinor: line.amountMinor,
            memo: line.memo,
          })),
        });
        await tx.journal.update({
          where: { id: journal.id },
          data: { status: "POSTED", postedAt: new Date() },
        });
      }

      const outstandingMinor = loan.installments.reduce(
        (sum, installment) => sum + installmentDueMinor(installment) - installmentPaidMinor(installment),
        0n,
      );
      if (outstandingMinor <= 0n && loan.status !== "CLOSED") {
        await tx.loan.update({
          where: { id: loan.id },
          data: { status: "CLOSED" },
        });
      }
    },
    { isolationLevel: "Serializable" },
  );

  const after = await loadSnapshot();
  console.log("\n=== After ===");
  console.log(`Loan: ${after.loanAccountNumber} status=${after.loanStatus} outstanding=${formatMinor(after.outstandingMinor, "UGX")}`);
  console.log(
    `Savings: ${after.savingsAccountNumber ?? "none"} balance=${after.savingsBalanceMinor === null ? "n/a" : formatMinor(after.savingsBalanceMinor, "UGX")}`,
  );
  const deltaMinor =
    before.savingsBalanceMinor !== null && after.savingsBalanceMinor !== null
      ? after.savingsBalanceMinor - before.savingsBalanceMinor
      : null;
  console.log(`Savings delta: ${deltaMinor === null ? "n/a" : formatMinor(deltaMinor, "UGX")}`);
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
