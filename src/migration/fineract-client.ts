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

  private buildUrl(relativePath: string, searchParams?: Record<string, string>) {
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}/${relativePath.replace(/^\//, "")}`);
    if (url.origin !== this.origin) throw new Error("Legacy request origin changed unexpectedly");
    for (const [key, value] of Object.entries(searchParams ?? {})) url.searchParams.set(key, value);
    return url;
  }

  private async fetchWithRetry(url: URL, accept: string): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: { Authorization: this.authorization, "Fineract-Platform-TenantId": this.tenantId, Accept: accept },
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(45_000),
        });
        if (!response.ok) throw new Error(`Legacy GET ${url.pathname} failed with HTTP ${response.status}`);
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt + Math.random() * 250));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Legacy GET ${url.pathname} failed`);
  }

  async getPage(entity: LegacyEntity, offset: number, limit: number): Promise<unknown> {
    if (!allowedPaths.includes(entity)) throw new Error(`Legacy endpoint is not allowlisted: ${entity}`);
    const url = this.buildUrl(entity, { offset: String(offset), limit: String(limit) });
    const response = await this.fetchWithRetry(url, "application/json");
    return response.json();
  }

  /** Full client record including family members, groups, etc. */
  async getClient(clientId: number): Promise<unknown> {
    const response = await this.fetchWithRetry(this.buildUrl(`clients/${clientId}`, { associations: "all" }), "application/json");
    return response.json();
  }

  async getClientSubResource(clientId: number, resource: "familymembers" | "identifiers" | "notes" | "documents"): Promise<unknown> {
    const response = await this.fetchWithRetry(this.buildUrl(`clients/${clientId}/${resource}`), "application/json");
    return response.json();
  }

  async getClientAccounts(clientId: number): Promise<unknown> {
    const response = await this.fetchWithRetry(this.buildUrl(`clients/${clientId}/accounts`), "application/json");
    return response.json();
  }

  async getLoan(loanId: number): Promise<unknown> {
    const response = await this.fetchWithRetry(this.buildUrl(`loans/${loanId}`, { associations: "repaymentSchedule,transactions" }), "application/json");
    return response.json();
  }

  async downloadClientDocument(clientId: number, documentId: number): Promise<{ bytes: Buffer; contentType: string }> {
    const response = await this.fetchWithRetry(this.buildUrl(`clients/${clientId}/documents/${documentId}/attachment`), "*/*");
    const arrayBuffer = await response.arrayBuffer();
    return { bytes: Buffer.from(arrayBuffer), contentType: response.headers.get("content-type") ?? "application/octet-stream" };
  }
}


export const migrationEntitySchema = z.enum(allowedPaths);