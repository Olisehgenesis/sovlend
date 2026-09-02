import { describe, expect, it } from "vitest";

import { reminderJobId, reminderJobSchema } from "./reminder";

describe("repayment reminder jobs", () => {
  it("use a deterministic installment and reminder type identity", () => {
    const data = reminderJobSchema.parse({
      loanId: "10c37978-c861-4aac-9d4a-5ff72c9a660a",
      installmentId: "d8359aa2-57f4-4e6b-8070-973695c18fad",
      clientId: "3c6dad45-3665-49f4-bc4e-d5f33c830bae",
      accountNumber: "SL-001042",
      type: "REPAYMENT_DUE_TODAY",
      dueOn: "2026-09-01T00:00:00.000Z",
      amountDueMinor: "408308",
      currencyCode: "UGX",
    });

    expect(reminderJobId(data)).toBe(
      "repayment:d8359aa2-57f4-4e6b-8070-973695c18fad:REPAYMENT_DUE_TODAY",
    );
  });
});