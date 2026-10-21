import { describe, expect, it } from "vitest";

import { moveUtcDayToWeekday, planScheduleDateChange, scheduleDateLockReason, shiftUtcDay, utcWeekdayName, type ScheduleDateRow } from "./schedule-date-change";

const disbursedOn = new Date("2026-09-01T00:00:00.000Z");

function row(partial: Partial<ScheduleDateRow> & Pick<ScheduleDateRow, "id" | "installmentNumber" | "dueOn">): ScheduleDateRow {
  return {
    outstandingMinor: 1_000n,
    penaltyAssessedOn: null,
    interestAccruedOn: null,
    hasActivePayment: false,
    ...partial,
  };
}

const first = row({ id: "a", installmentNumber: 1, dueOn: new Date("2026-09-15T00:00:00.000Z") });
const second = row({ id: "b", installmentNumber: 2, dueOn: new Date("2026-10-15T00:00:00.000Z") });

describe("weekday placement", () => {
  it("moves a Tuesday due date onto Friday of the same week", () => {
    expect(utcWeekdayName("2026-10-06")).toBe("Tuesday");
    expect(moveUtcDayToWeekday("2026-10-06", 5)).toBe("2026-10-09");
    expect(utcWeekdayName("2026-10-09")).toBe("Friday");
  });

  it("can place the same dates on any other weekday, or shift the whole set", () => {
    expect(moveUtcDayToWeekday("2026-10-06", 1)).toBe("2026-10-05");
    expect(shiftUtcDay("2026-10-06", 10)).toBe("2026-10-16");
    expect(shiftUtcDay("2026-10-06", -1)).toBe("2026-10-05");
  });
});

describe("planScheduleDateChange", () => {
  it("moves unpaid dates and sets maturity to the last installment", () => {
    const plan = planScheduleDateChange({
      disbursedOn,
      installments: [second, first],
      proposed: [
        { id: "a", dueOn: "2026-11-01" },
        { id: "b", dueOn: "2026-12-01" },
      ],
    });
    expect(plan.changes.map((change) => change.installmentNumber)).toEqual([1, 2]);
    expect(plan.maturesOn.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("leaves a locked date in place when it is unchanged", () => {
    const paid = row({ id: "a", installmentNumber: 1, dueOn: first.dueOn, outstandingMinor: 0n });
    const plan = planScheduleDateChange({
      disbursedOn,
      installments: [paid, second],
      proposed: [
        { id: "a", dueOn: "2026-09-15" },
        { id: "b", dueOn: "2026-11-15" },
      ],
    });
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]?.id).toBe("b");
  });

  it.each([
    ["Penalty already assessed", { penaltyAssessedOn: new Date("2026-09-20T00:00:00.000Z") }],
    ["Interest already accrued", { interestAccruedOn: new Date("2026-09-20T00:00:00.000Z") }],
    ["Payment already recorded", { hasActivePayment: true }],
    ["Settled", { outstandingMinor: 0n }],
  ] as const)("refuses to move an installment when %s", (reason, patch) => {
    expect(scheduleDateLockReason({ outstandingMinor: 1_000n, penaltyAssessedOn: null, interestAccruedOn: null, hasActivePayment: false, ...patch })).toBe(reason);
    expect(() => planScheduleDateChange({
      disbursedOn,
      installments: [row({ ...first, ...patch }), second],
      proposed: [{ id: "a", dueOn: "2026-11-01" }],
    })).toThrow(reason);
  });

  it("rejects dates on or before disbursement, shared days, and reversed order", () => {
    expect(() => planScheduleDateChange({
      disbursedOn,
      installments: [first, second],
      proposed: [{ id: "a", dueOn: "2026-09-01" }],
    })).toThrow("after the disbursement date");
    expect(() => planScheduleDateChange({
      disbursedOn,
      installments: [first, second],
      proposed: [{ id: "b", dueOn: "2026-09-15" }],
    })).toThrow("same day");
    expect(() => planScheduleDateChange({
      disbursedOn,
      installments: [first, second],
      proposed: [{ id: "b", dueOn: "2026-09-10" }],
    })).toThrow("installment order");
  });

  it("rejects an empty change, an unknown installment, and an invalid day", () => {
    expect(() => planScheduleDateChange({
      disbursedOn,
      installments: [first, second],
      proposed: [{ id: "a", dueOn: "2026-09-15" }],
    })).toThrow("No repayment dates changed");
    expect(() => planScheduleDateChange({
      disbursedOn,
      installments: [first],
      proposed: [{ id: "missing", dueOn: "2026-11-01" }],
    })).toThrow("Unknown installment");
    expect(() => planScheduleDateChange({
      disbursedOn,
      installments: [first],
      proposed: [{ id: "a", dueOn: "2026-02-31" }],
    })).toThrow("valid due date");
  });
});
