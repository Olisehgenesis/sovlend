import { describe, expect, it } from "vitest";

import {
  buildChargeSnapshot,
  buildCollateralSnapshot,
  buildTermsSnapshot,
  createLoanApplicationSchema,
  readChargeSnapshot,
  readCollateralSnapshot,
  readTermsSnapshot,
  updateLoanApplicationSchema,
} from "./loan-application-payload";

describe("loan application payload helpers", () => {
  it("strips undefined term fields while preserving valid overrides", () => {
    expect(buildTermsSnapshot({ annualRateBps: 2_400, arrearsToleranceMinor: undefined })).toEqual({ annualRateBps: 2_400 });
    expect(readTermsSnapshot({ annualRateBps: 2_400, unknown: "ignored" })).toEqual({ annualRateBps: 2_400 });
  });

  it("round-trips charge and collateral snapshots in the approval-compatible shape", () => {
    const charges = buildChargeSnapshot([{ chargeDefinitionId: "f9df3ae3-1e53-40d9-b88f-c44293d2ed47", name: "Processing fee", amountMinor: "2500", collectedOn: undefined }]);
    const collateral = buildCollateralSnapshot([{ type: "Bike", description: "Delivery bike", estimatedValueMinor: "500000" }]);

    expect(readChargeSnapshot(charges)).toEqual([{ chargeDefinitionId: "f9df3ae3-1e53-40d9-b88f-c44293d2ed47", name: "Processing fee", amountMinor: "2500" }]);
    expect(readCollateralSnapshot(collateral)).toEqual([{ type: "Bike", description: "Delivery bike", estimatedValueMinor: "500000" }]);
  });

  it("accepts expiry dates but rejects legacy disbursement and savings-linkage fields", () => {
    const basePayload = {
      clientId: "10c37978-c861-4aac-9d4a-5ff72c9a660a",
      productId: "f9df3ae3-1e53-40d9-b88f-c44293d2ed47",
      proposedPrincipalMinor: "2500000",
      applicationExpiresOn: "2026-09-30",
    };

    expect(createLoanApplicationSchema.safeParse(basePayload).success).toBe(true);
    expect(createLoanApplicationSchema.safeParse({ ...basePayload, disbursementOn: "2026-10-01" }).success).toBe(false);
    expect(createLoanApplicationSchema.safeParse({ ...basePayload, savingsAccountId: "9b6b7e2b-3d0a-4b8f-8f0a-6f4a2f7b1c11" }).success).toBe(false);
    expect(updateLoanApplicationSchema.safeParse({ applicationExpiresOn: "2026-09-30" }).success).toBe(true);
    expect(updateLoanApplicationSchema.safeParse({ disbursementOn: "2026-10-01" }).success).toBe(false);
  });
});
