import { describe, expect, it } from "vitest";

import { STAFF_SYSTEM_ROLES, assignableStaffWhere } from "./staff-roles";

describe("assignableStaffWhere", () => {
  it("excludes archived staff from officer pickers", () => {
    expect(assignableStaffWhere()).toEqual({
      systemRole: { in: [...STAFF_SYSTEM_ROLES] },
      NOT: { banned: true },
    });
  });

  it("still lists an already-assigned archived officer on that record", () => {
    expect(assignableStaffWhere({ includeUserId: "ghost", officeId: "head" })).toEqual({
      OR: [
        { id: "ghost" },
        { systemRole: { in: [...STAFF_SYSTEM_ROLES] }, NOT: { banned: true }, officeId: "head" },
      ],
    });
  });
});
