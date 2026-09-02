import { z } from "zod";

const allowedPaths = [
  "offices",
  "currencies",
  "staff",
  "clients",
  "groups",
  "centers",
  "loanproducts",
  "savingsproducts",
  "charges",
  "glaccounts",
  "roles",
  "users",
] as const;

export type LegacyEntity = (typeof allowedPaths)[number];

export class ReadOnlyFineractClient {
  private readonly origin: string;
  private readonly authorization: string;

  constructor(
    private readonly baseUrl: string,
    tenantId: string,
    username: string,
    password: string,
  ) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") throw new Error("Legacy migration requires HTTPS");
    this.origin = url.origin;
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
    this.tenantId = tenantId;
  }

  private readonly tenantId: string;

  async getPage(entity: LegacyEntity, offset: number, limit: number): Promise<unknown> {
    if (!allowedPaths.includes(entity)) throw new Error(`Legacy endpoint is not allowlisted: ${entity}`);
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}/${entity}`);
    if (url.origin !== this.origin) throw new Error("Legacy request origin changed unexpectedly");
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));

    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: { Authorization: this.authorization, "Fineract-Platform-TenantId": this.tenantId, Accept: "application/json" },
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(45_000),
        });
        if (!response.ok) throw new Error(`Legacy GET ${entity} failed with HTTP ${response.status}`);
        return response.json();
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt + Math.random() * 250));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Legacy GET ${entity} failed`);
  }
}

export const migrationEntitySchema = z.enum(allowedPaths);