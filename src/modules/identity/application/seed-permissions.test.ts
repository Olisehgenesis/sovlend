import { describe, expect, it } from "vitest";

import { permissions } from "../domain/permissions";
import { permissionDescriptions } from "./seed-permissions";

describe("permission seed descriptions", () => {
  it("has a description for every declared permission code", () => {
    const missing = Object.entries(permissions)
      .filter(([, code]) => !permissionDescriptions[code])
      .map(([key]) => key);

    expect(missing).toEqual([]);
  });
});
