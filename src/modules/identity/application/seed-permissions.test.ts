import { describe, expect, it } from "vitest";

import { defaultPermissionGroups, permissions } from "../domain/permissions";
import { permissionDescriptions } from "./seed-permissions";

describe("permission seed descriptions", () => {
  it("has a description for every declared permission code", () => {
    const missing = Object.entries(permissions)
      .filter(([, code]) => !permissionDescriptions[code])
      .map(([key]) => key);

    expect(missing).toEqual([]);
  });
  it("does not enable direct repayment cancellation in any default role", () => {
    expect(Object.values(defaultPermissionGroups).some((codes) => codes.includes(permissions.loanRepaymentReverse))).toBe(false);
  });
});
