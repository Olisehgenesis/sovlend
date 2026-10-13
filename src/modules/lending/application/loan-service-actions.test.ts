import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissions } from "@/modules/identity/domain/permissions";
import { assertBalancedJournal } from "@/modules/ledger/domain/journal";

const grants = vi.hoisted(() => new Set<string>());
vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class {
    async isAllowed({ permission }: { permission: string }) { return grants.has(permission); }
    async assertAllowed({ permission }: { permission: string }) {
      if (!grants.has(permission)) throw new Error(`Permission denied: ${permission}`);
    }
  },
}));

import { decideLoanServiceAction, requestLoanServiceAction } from "./loan-service-actions";

const paymentId = "00000000-0000-4000-8000-000000000001";
const requestId = "00000000-0000-4000-8000-000000000002";
const payload = { transactionId: paymentId, businessDate: "2026-10-07" };

function buildPrismaMock(options: { excess?: bigint; savingsFunded?: boolean; dueOn?: string; missingAllocations?: boolean } = {}) {
  const excess = options.excess ?? 6_154n;
  const principal = 4_203_846n;
  const amount = principal + excess;
  const installment = {
    id: "installment", dueOn: new Date(options.dueOn ?? "2026-09-24"), installmentNumber: 30,
    principalDueMinor: principal, principalPaidMinor: principal, principalWaivedMinor: 0n,
    interestDueMinor: 0n, interestPaidMinor: 0n, interestWaivedMinor: 0n,
    feesDueMinor: 0n, feesPaidMinor: 0n, feesWaivedMinor: 0n,
    monitoringFeeDueMinor: 0n, monitoringFeePaidMinor: 0n, monitoringFeeWaivedMinor: 0n,
    penaltiesDueMinor: 0n, penaltiesPaidMinor: 0n, penaltiesWaivedMinor: 0n,
  };
  const allocation = { installmentId: installment.id, principalMinor: principal, interestMinor: 0n, feesMinor: 0n, monitoringFeeMinor: 0n, penaltiesMinor: 0n };
  const payment = {
    id: paymentId, loanId: "loan", transactionType: "REPAYMENT", reversedById: null as string | null,
    settlementCurrency: "UGX", settlementChannel: "Cash", settlementAccountId: options.savingsFunded ? null : "cash",
    settlementAmountMinor: amount, denominationAmountMinor: amount, externalReference: "16019",
    allocations: options.missingAllocations ? [] : [allocation],
  };
  const loan = {
    id: "loan", status: "CLOSED", accountNumber: "LEGACY-1012", officeId: "office",
    denominationCurrency: "UGX", office: { organizationId: "org" }, installments: [installment],
    transactions: [payment],
  };
  const request = {
    id: requestId, loanId: loan.id, actionType: "TRANSACTION_REVERSAL", status: "PENDING",
    requestedById: "maker", payload, reason: "wrongly posted", resultTransactionId: null as string | null,
  };
  const originalLines: Array<{ accountId: string; direction: "DEBIT" | "CREDIT"; amountMinor: bigint; memo: string }> = [
    { accountId: options.savingsFunded ? "savings-liability" : "cash", direction: "DEBIT", amountMinor: amount, memo: "Funding" },
    { accountId: "principal-receivable", direction: "CREDIT", amountMinor: principal, memo: "Principal" },
    ...(excess > 0n ? [{ accountId: "savings-liability", direction: "CREDIT" as const, amountMinor: excess, memo: "SV-1" }] : []),
  ];
  const savings = {
    id: "savings", accountNumber: "SV-1", clientId: "client", groupId: null, productId: null,
    currencyCode: "UGX", status: "ACTIVE", client: { organizationId: "org", officeId: "office" },
    group: null, product: null, transactions: [{ amountMinor: excess }],
  };
  const savingsCredit = {
    id: "sweep", savingsAccountId: savings.id, transactionType: "DEPOSIT", amountMinor: excess,
    idempotencyKey: `loan-overpayment:${paymentId}:savings-credit`,
  };
  const savingsDebit = {
    id: "funding", savingsAccountId: savings.id, transactionType: "WITHDRAWAL", amountMinor: -amount,
    idempotencyKey: `savings-to-loan-transfer:${paymentId}:savings-debit`,
  };
  const tx = {
    loan: {
      findUnique: vi.fn(async () => loan),
      findUniqueOrThrow: vi.fn(async () => loan),
      update: vi.fn(async ({ data }: { data: { status: string } }) => Object.assign(loan, data)),
    },
    loanTransaction: {
      findMany: vi.fn(async (): Promise<Array<{ id: string; denominationAmountMinor: bigint; allocations: typeof payment.allocations }>> => []),
      findUniqueOrThrow: vi.fn(async () => payment),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "reversal", ...data })),
      update: vi.fn(async ({ data }: { data: { reversedById: string } }) => Object.assign(payment, data)),
    },
    loanInstallment: {
      update: vi.fn(async ({ data }: { data: Record<string, { decrement: bigint }> }) => {
        for (const key of ["principalPaidMinor", "interestPaidMinor", "feesPaidMinor", "monitoringFeePaidMinor", "penaltiesPaidMinor"] as const) {
          installment[key] -= data[key].decrement;
        }
        return installment;
      }),
      findMany: vi.fn(async () => [installment]),
    },
    loanTransactionAllocation: { create: vi.fn(async () => ({})) },
    loanServiceRequest: {
      findUnique: vi.fn(async (): Promise<typeof request | null> => request),
      findUniqueOrThrow: vi.fn(async () => request),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...request, ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(request, data)),
    },
    savingsAccount: { findUniqueOrThrow: vi.fn(async () => savings) },
    savingsTransaction: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
        where.idempotencyKey === savingsCredit.idempotencyKey && excess > 0n ? savingsCredit :
          where.idempotencyKey === savingsDebit.idempotencyKey && options.savingsFunded ? savingsDebit : null),
      create: vi.fn(async ({ data }: { data: { amountMinor: bigint } }) => {
        savings.transactions.push({ amountMinor: data.amountMinor });
        return { id: "savings-reversal", ...data };
      }),
    },
    journal: {
      findFirst: vi.fn(async () => ({ id: "original-journal", lines: originalLines })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "reversal-journal", ...data })),
      update: vi.fn(async () => ({})),
    },
    journalLine: { createMany: vi.fn(async ({ data }: { data: Array<{ accountId: string; direction: "DEBIT" | "CREDIT"; amountMinor: bigint }> }) => ({ count: data.length })) },
    accountingClosure: { findFirst: vi.fn(async () => null) },
    auditEvent: { create: vi.fn(async () => ({})) },
    outboxEvent: { create: vi.fn(async () => ({})) },
  };
  const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const before = structuredClone({ installment, payment, loan, request, savings });
    try { return await callback(tx); } catch (error) {
      Object.assign(installment, before.installment);
      Object.assign(payment, before.payment);
      Object.assign(loan, { status: before.loan.status });
      Object.assign(request, before.request);
      Object.assign(savings, before.savings);
      throw error;
    }
  });
  const prisma = { ...tx, $transaction: transaction } as unknown as PrismaClient;
  return { prisma, tx, loan, request, payment, installment, savings, originalLines, transaction };
}

beforeEach(() => {
  grants.clear();
  grants.add(permissions.loanReverse);
});

describe("repayment cancellation", () => {
  it("reverses all UGX 42,100, recovers the savings excess, and reopens the loan for top-up payoff", async () => {
    const { prisma, tx, loan, installment, savings, transaction } = buildPrismaMock();
    const result = await decideLoanServiceAction(prisma, { requestId, actorUserId: "checker", decision: "APPROVE" });
    expect(result.status).toBe("APPROVED");
    expect(installment.principalPaidMinor).toBe(0n);
    expect(loan.status).toBe("IN_ARREARS");
    expect(savings.transactions.reduce((sum, item) => sum + item.amountMinor, 0n)).toBe(0n);
    expect(tx.journal.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reversalOfId: "original-journal" }),
    }));
    const { data: lines } = tx.journalLine.createMany.mock.calls[0][0];
    assertBalancedJournal(lines.map((line) => ({ ...line, currencyCode: "UGX" })));
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: "principal-receivable", direction: "DEBIT", amountMinor: 4_203_846n }),
      expect.objectContaining({ accountId: "savings-liability", direction: "DEBIT", amountMinor: 6_154n }),
      expect.objectContaining({ accountId: "cash", direction: "CREDIT", amountMinor: 4_210_000n }),
    ]));
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("keeps exact-payoff cancellations working and reopens a not-yet-due loan as active", async () => {
    const { prisma, loan, tx } = buildPrismaMock({ excess: 0n, dueOn: "2026-10-15" });
    await decideLoanServiceAction(prisma, { requestId, actorUserId: "checker", decision: "APPROVE" });
    expect(loan.status).toBe("ACTIVE");
    expect(tx.savingsTransaction.create).not.toHaveBeenCalled();
  });

  it("uses the original receivable accounts even if the product mapping has changed", async () => {
    const { prisma, originalLines, tx } = buildPrismaMock();
    originalLines[1].accountId = "original-accrued-receivable";
    await decideLoanServiceAction(prisma, { requestId, actorUserId: "checker", decision: "APPROVE" });
    expect(tx.journalLine.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ accountId: "original-accrued-receivable", direction: "DEBIT" })]),
    }));
  });

  it("restores savings-funded repayments without requiring a cash settlement account", async () => {
    const { prisma, savings, tx } = buildPrismaMock({ savingsFunded: true });
    await decideLoanServiceAction(prisma, { requestId, actorUserId: "checker", decision: "APPROVE" });
    expect(savings.transactions.reduce((sum, item) => sum + item.amountMinor, 0n)).toBe(4_210_000n);
    expect(tx.savingsTransaction.create).toHaveBeenCalledTimes(2);
  });

  it("rolls back the cancellation when the savings overpayment has been spent", async () => {
    const { prisma, savings, loan, request, payment, installment } = buildPrismaMock();
    savings.transactions = [{ amountMinor: 0n }];
    await expect(decideLoanServiceAction(prisma, { requestId, actorUserId: "checker", decision: "APPROVE" })).rejects.toThrow("Withdrawal exceeds available balance");
    expect(loan.status).toBe("CLOSED");
    expect(request.status).toBe("PENDING");
    expect(payment.reversedById).toBeNull();
    expect(installment.principalPaidMinor).toBe(4_203_846n);
  });

  it("rejects missing installment allocations rather than cancelling without restoring debt", async () => {
    const { prisma, tx } = buildPrismaMock({ excess: 0n, missingAllocations: true });
    await expect(decideLoanServiceAction(prisma, { requestId, actorUserId: "checker", decision: "APPROVE" })).rejects.toThrow("allocations are incomplete");
    expect(tx.loanTransaction.create).not.toHaveBeenCalled();
  });

  it("retries an approved request without moving money again", async () => {
    const { prisma, tx } = buildPrismaMock();
    const command = { requestId, actorUserId: "checker", decision: "APPROVE" as const };
    await decideLoanServiceAction(prisma, command);
    await decideLoanServiceAction(prisma, command);
    expect(tx.loanTransaction.create).toHaveBeenCalledTimes(1);
    expect(tx.savingsTransaction.create).toHaveBeenCalledTimes(1);
  });

  it("closes an overpaid loan when its final retained overpayment is cancelled", async () => {
    const { prisma, loan, installment, payment, originalLines } = buildPrismaMock({ excess: 0n });
    loan.status = "OVERPAID";
    installment.principalDueMinor = 0n;
    installment.principalPaidMinor = 0n;
    payment.allocations = [];
    originalLines[1].memo = "Overpayment";
    originalLines[1].accountId = "overpayment-liability";
    await decideLoanServiceAction(prisma, { requestId, actorUserId: "checker", decision: "APPROVE" });
    expect(loan.status).toBe("CLOSED");
  });

  it("preserves overpaid status when another unreversed payment still has retained excess", async () => {
    const { prisma, tx, loan, installment, payment, originalLines } = buildPrismaMock({ excess: 0n });
    loan.status = "OVERPAID";
    installment.principalDueMinor = 0n;
    installment.principalPaidMinor = 0n;
    payment.allocations = [];
    originalLines[1].memo = "Overpayment";
    tx.loanTransaction.findMany.mockResolvedValueOnce([{ id: "other-payment", denominationAmountMinor: 100n, allocations: [] }]);
    await decideLoanServiceAction(prisma, { requestId, actorUserId: "checker", decision: "APPROVE" });
    expect(loan.status).toBe("OVERPAID");
  });
});

describe("direct repayment cancellation permissions", () => {
  it("retains maker-checker for users without the explicit direct permission", async () => {
    const { prisma } = buildPrismaMock();
    await expect(decideLoanServiceAction(prisma, { requestId, actorUserId: "maker", decision: "APPROVE" })).rejects.toThrow("Maker-checker violation");
  });

  it("allows a permitted user to execute their own pending cancellation with an explicit decision note", async () => {
    grants.clear();
    grants.add(permissions.loanRepaymentReverse);
    const { prisma } = buildPrismaMock();
    const result = await decideLoanServiceAction(prisma, { requestId, actorUserId: "maker", decision: "APPROVE" });
    expect(result).toMatchObject({ status: "APPROVED", decidedById: "maker", decisionNote: expect.stringContaining("LOAN_REPAYMENT_REVERSE") });
  });

  it("allows a permitted user to approve someone else's repayment cancellation", async () => {
    grants.clear();
    grants.add(permissions.loanRepaymentReverse);
    const { prisma } = buildPrismaMock();
    expect((await decideLoanServiceAction(prisma, { requestId, actorUserId: "checker", decision: "APPROVE" })).status).toBe("APPROVED");
  });

  it("does not allow self-approval of other servicing actions", async () => {
    grants.add(permissions.loanRepaymentReverse);
    const { prisma, request } = buildPrismaMock();
    request.actionType = "PREPAY";
    await expect(decideLoanServiceAction(prisma, { requestId, actorUserId: "maker", decision: "APPROVE" })).rejects.toThrow("Maker-checker violation");
  });

  it("creates and executes an audited direct cancellation atomically", async () => {
    grants.clear();
    grants.add(permissions.loanRepaymentReverse);
    const { prisma, tx } = buildPrismaMock();
    tx.loanServiceRequest.findUnique.mockResolvedValueOnce(null);
    const result = await requestLoanServiceAction(prisma, { loanId: "loan", actorUserId: "maker", actionType: "TRANSACTION_REVERSAL", reason: "wrongly posted", payload, idempotencyKey: requestId });
    expect(result).toMatchObject({ status: "APPROVED", decidedById: "maker", resultTransactionId: "reversal" });
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "loan.service_action.requested" }) }));
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "loan.transaction.reversed" }) }));
  });

  it("leaves request-only users' cancellations pending", async () => {
    grants.clear();
    grants.add(permissions.loanRepaymentReverseRequest);
    const { prisma, tx } = buildPrismaMock();
    tx.loanServiceRequest.findUnique.mockResolvedValueOnce(null);
    const result = await requestLoanServiceAction(prisma, { loanId: "loan", actorUserId: "maker", actionType: "TRANSACTION_REVERSAL", reason: "wrongly posted", payload, idempotencyKey: requestId });
    expect(result.status).toBe("PENDING");
    expect(tx.loanTransaction.create).not.toHaveBeenCalled();
  });
});
