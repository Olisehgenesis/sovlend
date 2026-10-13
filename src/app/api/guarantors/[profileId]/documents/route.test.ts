import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), scope: vi.fn(), allowed: vi.fn(), profile: vi.fn(), document: vi.fn(),
  read: vi.fn(), store: vi.fn(), lock: vi.fn(), create: vi.fn(), audit: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/modules/identity/application/data-scope", () => ({
  getUserDataScope: mocks.scope, officeWhere: () => ({ officeId: { in: ["office"] } }),
}));
vi.mock("@/modules/identity/application/authorization-service", () => ({ AuthorizationService: class { isAllowed = mocks.allowed; } }));
vi.mock("@/lib/document-storage", () => ({ readDocumentBytes: mocks.read, storeDocumentBytes: mocks.store }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    guarantorProfile: { findFirst: mocks.profile }, guarantorDocument: { findFirst: mocks.document },
    $transaction: async (run: (tx: unknown) => unknown) => run({
      loanApplication: { updateMany: mocks.lock }, guarantorDocument: { create: mocks.create }, auditEvent: { create: mocks.audit },
    }),
  },
}));
import { GET, POST } from "./route";
const id = "d5e2c650-10ad-4b9c-a01d-7cae9ed29454";
const docId = "d5e2c650-10ad-4b9c-a01d-7cae9ed29455";
const params = { params: Promise.resolve({ profileId: id }) };
function upload() {
  const form = new FormData();
  form.set("name", "Guarantor ID"); form.set("file", new File(["test"], "id.txt", { type: "text/plain" }));
  return new Request("http://localhost/api/guarantors/documents", { method: "POST", body: form });
}
describe("guarantor documents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "actor" } });
    mocks.scope.mockResolvedValue({ organizationId: "org", officeIds: ["office"] });
    mocks.allowed.mockResolvedValue(true);
    mocks.profile.mockResolvedValue({ id, applicationId: "app", application: { officeId: "office", status: "SUBMITTED", updatedAt: new Date("2026-10-07") } });
    mocks.lock.mockResolvedValue({ count: 1 }); mocks.store.mockResolvedValue("hash");
    mocks.create.mockResolvedValue({ id: docId });
  });
  it("stores a document on its own guarantor and audits the upload", async () => {
    expect((await POST(upload(), params)).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ data: { profileId: id, uploadedById: "actor", name: "Guarantor ID", sha256: "hash", mediaType: "text/plain" } });
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it("rejects another office's guarantor", async () => {
    mocks.profile.mockResolvedValue(null);
    expect((await POST(upload(), params)).status).toBe(404);
    expect(mocks.profile).toHaveBeenCalledWith(expect.objectContaining({ where: { id, application: { office: { organizationId: "org" }, officeId: { in: ["office"] } } } }));
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("requires permission and locks uploads after approval", async () => {
    mocks.allowed.mockResolvedValue(false);
    expect((await POST(upload(), params)).status).toBe(403);
    mocks.allowed.mockResolvedValue(true);
    mocks.profile.mockResolvedValue({ id, applicationId: "app", application: { officeId: "office", status: "APPROVED" } });
    expect((await POST(upload(), params)).status).toBe(409);
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("does not attach a document after concurrent approval", async () => {
    mocks.lock.mockResolvedValue({ count: 0 });
    expect((await POST(upload(), params)).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("downloads only this guarantor's document after approval", async () => {
    mocks.document.mockResolvedValue({ id: docId, sha256: "hash", name: "ID", mediaType: "text/plain" });
    mocks.read.mockResolvedValue(Buffer.from("test"));
    const response = await GET(new Request(`http://localhost/documents?documentId=${docId}`), params);
    expect(response.status).toBe(200); expect(await response.text()).toBe("test");
    expect(mocks.document).toHaveBeenCalledWith({ where: { id: docId, profileId: id } });
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
  });
  it("does not serve a document attached to another guarantor", async () => {
    mocks.document.mockResolvedValue(null);
    expect((await GET(new Request(`http://localhost/documents?documentId=${docId}`), params)).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
