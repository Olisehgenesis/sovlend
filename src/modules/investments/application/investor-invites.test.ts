import { describe, expect, it } from "vitest";

import { hashInviteToken } from "./investor-invites";

describe("investor invite tokens", () => {
  it("stores a deterministic hash rather than the invitation secret", () => {
    const token = "secret-invitation-token";
    const hash = hashInviteToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
  });
});