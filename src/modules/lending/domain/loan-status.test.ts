import { describe, expect, it } from "vitest";

import { determineServicingStatus } from "./loan-status";

describe("loan servicing status", () => {
  it("marks overdue outstanding loans in arrears", () => expect(determineServicingStatus({ currentStatus: "ACTIVE", totalOutstandingMinor: 10n, overdueOutstandingMinor: 1n })).toBe("IN_ARREARS"));
  it("cures an arrears loan with no overdue balance", () => expect(determineServicingStatus({ currentStatus: "IN_ARREARS", totalOutstandingMinor: 10n, overdueOutstandingMinor: 0n })).toBe("ACTIVE"));
  it("closes a fully paid active loan", () => expect(determineServicingStatus({ currentStatus: "ACTIVE", totalOutstandingMinor: 0n, overdueOutstandingMinor: 0n })).toBe("CLOSED"));
  it("does not change written-off loans", () => expect(determineServicingStatus({ currentStatus: "WRITTEN_OFF", totalOutstandingMinor: 10n, overdueOutstandingMinor: 10n })).toBe("WRITTEN_OFF"));
});