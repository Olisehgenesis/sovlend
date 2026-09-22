import { describe, expect, it } from "vitest";

import { isPostableLedgerAccount } from "./postable-ledger-account";

describe("isPostableLedgerAccount", () => {
  it("lets active detail accounts be posted to even when the imported Fineract flag is off", () => {
    expect(isPostableLedgerAccount({ active: true, usage: "DETAIL" })).toBe(true);
  });

  it("rejects header and inactive accounts", () => {
    expect(isPostableLedgerAccount({ active: true, usage: "HEADER" })).toBe(false);
    expect(isPostableLedgerAccount({ active: false, usage: "DETAIL" })).toBe(false);
  });
});
