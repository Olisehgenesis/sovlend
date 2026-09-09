import { describe, expect, it } from "vitest";

import { extractSavingsAccountIdsFromAccountsPayload, planLegacySavingsTransactionImports } from "./legacy-savings";

describe("extractSavingsAccountIdsFromAccountsPayload", () => {
  it("returns unique numeric savings account ids from owner account payloads", () => {
    expect(
      extractSavingsAccountIdsFromAccountsPayload({
        savingsAccounts: [{ id: 678 }, { id: 679 }, { id: 678 }, { id: "680" }, null],
      }),
    ).toEqual([678, 679]);
  });
});

describe("planLegacySavingsTransactionImports", () => {
  it("plans only missing transactions using historical idempotency keys and signed amounts", () => {
    const result = planLegacySavingsTransactionImports(
      "000000678",
      {
        id: 678,
        currency: { decimalPlaces: 2 },
        transactions: [
          { id: 4134, amount: 50, date: [2026, 9, 1], transactionType: { value: "Deposit", deposit: true } },
          { id: 4135, amount: 5, date: [2026, 9, 2], transactionType: { value: "Withdrawal", withdrawal: true } },
          { id: 4136, amount: 7, date: [2026, 9, 3], reversed: true, transactionType: { value: "Deposit", deposit: true } },
        ],
      },
      new Set(["savings-tx-678-4134"]),
    );

    expect(result.skipped).toEqual([]);
    expect(
      result.transactionsToCreate.map((transaction) => ({
        externalReference: transaction.externalReference,
        idempotencyKey: transaction.idempotencyKey,
        transactionType: transaction.transactionType,
        amountMinor: transaction.amountMinor,
        createdAt: transaction.createdAt.toISOString(),
      })),
    ).toEqual([
      {
        externalReference: "4135",
        idempotencyKey: "savings-tx-678-4135",
        transactionType: "Withdrawal",
        amountMinor: -500n,
        createdAt: "2026-09-02T00:00:00.000Z",
      },
      {
        externalReference: "4136",
        idempotencyKey: "savings-tx-678-4136",
        transactionType: "Deposit",
        amountMinor: 0n,
        createdAt: "2026-09-03T00:00:00.000Z",
      },
    ]);
  });

  it("reports malformed legacy transactions without inserting them", () => {
    const result = planLegacySavingsTransactionImports("000000678", {
      id: 678,
      transactions: [{ id: "not-a-number", amount: 5, transactionType: { value: "Deposit", deposit: true } }],
    });

    expect(result.transactionsToCreate).toEqual([]);
    expect(result.skipped).toEqual(["000000678: encountered transaction without numeric id"]);
  });
});
