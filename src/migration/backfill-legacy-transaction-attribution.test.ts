import { describe, expect, it } from "vitest";

import { deterministicUuid } from "./import-foundation";
import {
  loanLookupKey,
  planLegacyTransactionBackfill,
  resolveSavingsRecordedByUser,
  resolveSettlementAccountForPaymentType,
  savingsLookupKey,
} from "./backfill-legacy-transaction-attribution";

describe("resolveSettlementAccountForPaymentType", () => {
  const settlementAccounts = [
    { id: "cash-id", name: "Cash", provider: null, active: true },
    { id: "yo-id", name: "Yo Payments", provider: "Yo Payments", active: true },
  ] as const;

  it("matches exact payment type names case-insensitively", () => {
    expect(resolveSettlementAccountForPaymentType("yo payments", settlementAccounts)).toEqual({
      kind: "matched",
      settlementAccountId: "yo-id",
      settlementAccountName: "Yo Payments",
      matchStrategy: "exact",
    });
  });

  it("skips unmatched payment type names", () => {
    expect(resolveSettlementAccountForPaymentType("Suspense Payments", settlementAccounts)).toEqual({
      kind: "unmatched",
      paymentTypeName: "Suspense Payments",
    });
  });
});

describe("resolveSavingsRecordedByUser", () => {
  const organizationId = "fba203d9-7366-4f6b-8295-cdde462e6649";

  it("resolves <id>_DELETED_<name> usernames via legacy staff id", () => {
    const userId = deterministicUuid(`staff:${organizationId}:27`);
    expect(
      resolveSavingsRecordedByUser(
        "27_DELETED_Sylvia",
        organizationId,
        [{ id: 27, firstname: "Sylvia", displayName: "Bukirwa, Sylvia" }],
        new Set([userId]),
      ),
    ).toEqual({
      kind: "matched",
      userId,
      legacyStaffId: 27,
      matchSource: "deleted-id",
    });
  });

  it("leaves ambiguous plain-name usernames unresolved", () => {
    expect(
      resolveSavingsRecordedByUser(
        "Robinah",
        organizationId,
        [
          { id: 2, firstname: "Robinah", displayName: "A, Robinah" },
          { id: 3, firstname: "Robinah", displayName: "B, Robinah" },
        ],
        new Set(),
      ),
    ).toEqual({
      kind: "ambiguous-username",
      username: "Robinah",
      matchingStaffIds: [2, 3],
    });
  });

  it("leaves system usernames unresolved", () => {
    expect(resolveSavingsRecordedByUser("PaybillAPI", organizationId, [], new Set())).toEqual({
      kind: "system-username",
      username: "PaybillAPI",
    });
  });
});

describe("planLegacyTransactionBackfill", () => {
  it("is idempotent once planned updates are applied", () => {
    const organizationId = "fba203d9-7366-4f6b-8295-cdde462e6649";
    const joanUserId = deterministicUuid(`staff:${organizationId}:4`);
    const settlementAccounts = [
      { id: "cash-id", name: "Cash", provider: null, active: true },
      { id: "yo-id", name: "Yo Payments", provider: "Yo Payments", active: true },
    ] as const;
    const staffRecords = [{ id: 4, firstname: "Joan", displayName: "Nakayiza, Joan" }] as const;

    const initialLoanTransactions = [{ id: "loan-tx-1", externalReference: "legacy:12:34", settlementAccountId: null }] as const;
    const initialSavingsTransactions = [
      {
        id: "savings-tx-1",
        externalReference: "90",
        settlementAccountId: null,
        recordedByUserId: null,
        savingsAccountNumber: "000000789",
      },
    ] as const;

    const rawLoanTransactionsByKey = new Map([[loanLookupKey(12, 34), { paymentTypeName: "Cash Payment" }]]);
    const rawSavingsTransactionsByKey = new Map([
      [savingsLookupKey(789, 90), { paymentTypeName: "Yo Payments", submittedByUsername: "Joan" }],
    ]);

    const firstPlan = planLegacyTransactionBackfill({
      organizationId,
      settlementAccounts,
      staffRecords,
      existingUserIds: new Set([joanUserId]),
      loanTransactions: initialLoanTransactions,
      savingsTransactions: initialSavingsTransactions,
      rawLoanTransactionsByKey,
      rawSavingsTransactionsByKey,
    });

    expect(firstPlan.loanSettlementUpdates).toEqual([{ id: "loan-tx-1", value: "cash-id" }]);
    expect(firstPlan.savingsSettlementUpdates).toEqual([{ id: "savings-tx-1", value: "yo-id" }]);
    expect(firstPlan.savingsRecordedByUpdates).toEqual([{ id: "savings-tx-1", value: joanUserId }]);

    const secondPlan = planLegacyTransactionBackfill({
      organizationId,
      settlementAccounts,
      staffRecords,
      existingUserIds: new Set([joanUserId]),
      loanTransactions: [{ ...initialLoanTransactions[0], settlementAccountId: "cash-id" }],
      savingsTransactions: [{ ...initialSavingsTransactions[0], settlementAccountId: "yo-id", recordedByUserId: joanUserId }],
      rawLoanTransactionsByKey,
      rawSavingsTransactionsByKey,
    });

    expect(secondPlan.loanSettlementUpdates).toEqual([]);
    expect(secondPlan.savingsSettlementUpdates).toEqual([]);
    expect(secondPlan.savingsRecordedByUpdates).toEqual([]);
  });
});
