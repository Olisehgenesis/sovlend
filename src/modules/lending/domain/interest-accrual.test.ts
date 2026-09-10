import { describe, expect, it } from "vitest";

import { computeAccruableInterestMinor, isInstallmentInterestAccruable } from "./interest-accrual";

describe("isInstallmentInterestAccruable", () => {
  it("is eligible the day the installment becomes due", () => {
    expect(
      isInstallmentInterestAccruable({
        dueOn: new Date("2026-09-07T00:00:00.000Z"),
        today: new Date("2026-09-07T00:00:00.000Z"),
        interestAccruedOn: null,
      }),
    ).toBe(true);
  });

  it("is eligible within the lookback buffer after the due date", () => {
    expect(
      isInstallmentInterestAccruable({
        dueOn: new Date("2026-09-07T00:00:00.000Z"),
        today: new Date("2026-09-09T00:00:00.000Z"),
        interestAccruedOn: null,
        lookbackBufferDays: 3,
      }),
    ).toBe(true);
  });

  it("is not eligible before the due date", () => {
    expect(
      isInstallmentInterestAccruable({
        dueOn: new Date("2026-09-07T00:00:00.000Z"),
        today: new Date("2026-09-05T00:00:00.000Z"),
        interestAccruedOn: null,
      }),
    ).toBe(false);
  });

  it("is not eligible once the lookback buffer has passed", () => {
    expect(
      isInstallmentInterestAccruable({
        dueOn: new Date("2026-09-07T00:00:00.000Z"),
        today: new Date("2026-09-20T00:00:00.000Z"),
        interestAccruedOn: null,
        lookbackBufferDays: 3,
      }),
    ).toBe(false);
  });

  it("is never eligible once already accrued", () => {
    expect(
      isInstallmentInterestAccruable({
        dueOn: new Date("2026-09-07T00:00:00.000Z"),
        today: new Date("2026-09-07T00:00:00.000Z"),
        interestAccruedOn: new Date("2026-09-07T00:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("rejects a negative lookbackBufferDays", () => {
    expect(() =>
      isInstallmentInterestAccruable({
        dueOn: new Date("2026-09-07T00:00:00.000Z"),
        today: new Date("2026-09-07T00:00:00.000Z"),
        interestAccruedOn: null,
        lookbackBufferDays: -1,
      }),
    ).toThrow("lookbackBufferDays must be a non-negative integer");
  });
});

describe("computeAccruableInterestMinor", () => {
  it("returns the interest outstanding after payments and waivers", () => {
    expect(
      computeAccruableInterestMinor({ interestDueMinor: 1_000n, interestPaidMinor: 200n, interestWaivedMinor: 100n }),
    ).toBe(700n);
  });

  it("defaults interestWaivedMinor to 0 when not provided", () => {
    expect(computeAccruableInterestMinor({ interestDueMinor: 1_000n, interestPaidMinor: 400n })).toBe(600n);
  });

  it("floors at 0 when the installment is already fully collected", () => {
    expect(
      computeAccruableInterestMinor({ interestDueMinor: 1_000n, interestPaidMinor: 1_000n, interestWaivedMinor: 0n }),
    ).toBe(0n);
  });

  it("floors at 0 rather than going negative when paid+waived exceed due", () => {
    expect(
      computeAccruableInterestMinor({ interestDueMinor: 1_000n, interestPaidMinor: 900n, interestWaivedMinor: 200n }),
    ).toBe(0n);
  });
});
