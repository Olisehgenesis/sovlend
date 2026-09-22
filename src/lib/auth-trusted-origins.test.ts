import { describe, expect, it } from "vitest";

import { extraTrustedOriginsFromEnv, trustedOriginsForAuthUrl } from "./auth-trusted-origins";

describe("trustedOriginsForAuthUrl", () => {
  it("keeps production on a single origin", () => {
    expect(trustedOriginsForAuthUrl("https://sovlend.com")).toEqual(["https://sovlend.com"]);
  });

  it("accepts any localhost or docker-internal port in local development", () => {
    const origins = trustedOriginsForAuthUrl("http://localhost:3000");
    expect(origins).toEqual(
      expect.arrayContaining([
        "http://localhost:3000",
        "http://localhost:*",
        "http://127.0.0.1:*",
        "http://host.docker.internal:*",
      ]),
    );
  });

  it("still works when BETTER_AUTH_URL has no port", () => {
    expect(trustedOriginsForAuthUrl("http://localhost")).toEqual(
      expect.arrayContaining(["http://localhost", "http://localhost:*"]),
    );
  });
});

describe("extraTrustedOriginsFromEnv", () => {
  it("splits a comma list", () => {
    expect(extraTrustedOriginsFromEnv("http://172.20.10.4:3001, https://preview.example ")).toEqual([
      "http://172.20.10.4:3001",
      "https://preview.example",
    ]);
  });
});
