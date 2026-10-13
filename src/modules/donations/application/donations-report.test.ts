import { describe, expect, it, vi } from "vitest";

import { toUsdMinor } from "./donation-wallet-balance";
import { loadDonationsReport } from "./donations-report";

describe("toUsdMinor", () => {
  it("converts a token balance into a USD minor value", () => {
    expect(toUsdMinor(1_000_000n, 6)).toBe(100n);
    expect(toUsdMinor(1_234_500n, 6)).toBe(123n);
    expect(toUsdMinor(1_234_560n, 6)).toBe(123n);
    expect(toUsdMinor(0n, 6)).toBe(0n);
  });
});

describe("loadDonationsReport", () => {
  it("summarises succeeded and pending donations", async () => {
    const prisma = {
      donationRequest: {
        findMany: vi.fn(async () => [
          { id: "a", name: "Ada", email: "a@x.com", message: null, country: null, city: null, phone: null, amountUsdMinor: 2500n, amountSats: 5000n, status: "SUCCEEDED", succeededAt: new Date("2026-01-01"), createdAt: new Date("2026-01-01"), _count: { lightningInvoices: 1 } },
          { id: "b", name: "Ben", email: "b@x.com", message: null, country: "UG", city: "Kampala", phone: null, amountUsdMinor: 1000n, amountSats: null, status: "PENDING", succeededAt: null, createdAt: new Date("2026-01-02"), _count: { lightningInvoices: 0 } },
        ]),
      },
    };

    const report = await loadDonationsReport(prisma as never);

    expect(report.totalDonations).toBe(2);
    expect(report.succeededCount).toBe(1);
    expect(report.pendingCount).toBe(1);
    expect(report.succeededUsdMinor).toBe(2500n);
    expect(report.totalUsdMinor).toBe(3500n);
    expect(report.successRate).toBe(50);
    expect(report.rows[0].donorName).toBe("Ada");
  });

  it("ends up with a null success rate when there are no requests", async () => {
    const prisma = { donationRequest: { findMany: vi.fn(async () => []) } };
    const report = await loadDonationsReport(prisma as never);
    expect(report.totalDonations).toBe(0);
    expect(report.successRate).toBeNull();
  });
});
