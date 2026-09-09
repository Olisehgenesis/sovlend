import { describe, expect, it } from "vitest";

import { getLoanTodayTransactionsConfig } from "@/lib/loan-today-transactions-config";

describe("getLoanTodayTransactionsConfig", () => {
  it("returns collection copy for REPAYMENT", () => {
    const config = getLoanTodayTransactionsConfig("REPAYMENT");
    expect(config.breadcrumbLabel).toBe("Collected today");
    expect(config.heading).toBe("Repayments collected today");
    expect(config.summaryNoun).toBe("repayment transactions");
    expect(config.summaryVerb).toBe("recorded");
    expect(config.emptyTitle).toBe("No repayments collected today");
  });

  it("returns disbursement copy for DISBURSEMENT", () => {
    const config = getLoanTodayTransactionsConfig("DISBURSEMENT");
    expect(config.breadcrumbLabel).toBe("Disbursed today");
    expect(config.heading).toBe("Loans disbursed today");
    expect(config.summaryNoun).toBe("disbursement transactions");
    expect(config.summaryVerb).toBe("released");
    expect(config.emptyTitle).toBe("No loans disbursed today");
  });

  it("keeps the two variants distinct", () => {
    const repayment = getLoanTodayTransactionsConfig("REPAYMENT");
    const disbursement = getLoanTodayTransactionsConfig("DISBURSEMENT");
    expect(repayment).not.toEqual(disbursement);
  });
});
