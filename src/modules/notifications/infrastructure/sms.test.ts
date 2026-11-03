import { describe, expect, it } from "vitest";

import { normalizeSmsPhone } from "./sms";
import { repaymentSmsMessage, standingOrderSmsMessage } from "../domain/sms-copy";

describe("normalizeSmsPhone", () => {
  it("converts local Uganda numbers to 256", () => {
    expect(normalizeSmsPhone("0766234780")).toBe("256766234780");
    expect(normalizeSmsPhone("+256 766 234 780")).toBe("256766234780");
  });
});

describe("repayment SMS copy", () => {
  it("starts JUMPSTART and asks to pay the loan amount", () => {
    expect(repaymentSmsMessage({ type: "REPAYMENT_DUE_SOON", amount: "UGX 50,000", dueDate: "2026-10-31" })).toBe(
      "JUMPSTART: Please pay your loan of UGX 50,000 due on 2026-10-31.",
    );
    expect(repaymentSmsMessage({ type: "REPAYMENT_DUE_TODAY", amount: "UGX 50,000", dueDate: "2026-10-29" })).toBe(
      "JUMPSTART: Please pay your loan of UGX 50,000 due TODAY (2026-10-29).",
    );
    expect(
      repaymentSmsMessage({ type: "REPAYMENT_OVERDUE", amount: "UGX 50,000", dueDate: "2026-10-31", fees: "UGX 2,000" }),
    ).toBe("JUMPSTART: Please pay your loan of UGX 50,000 which is OVERDUE (was due 2026-10-31) including UGX 2,000 in fees/penalties.");
    expect(standingOrderSmsMessage("UGX 10,000", "000000908L5")).toMatch(/^JUMPSTART:/);
  });
});
