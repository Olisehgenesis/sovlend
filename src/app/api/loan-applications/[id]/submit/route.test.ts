import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(), scope: vi.fn(), allowed: vi.fn(), application: vi.fn(), actor: vi.fn(), update: vi.fn(), audit: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/modules/identity/application/data-scope", () => ({
  getUserDataScope: mocks.scope, officeWhere: () => ({ officeId: { in: ["office"] } }),
}));
vi.mock("@/modules/identity/application/authorization-service", () => ({ AuthorizationService: class { isAllowed = mocks.allowed; } }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    loanApplication: { findFirst: mocks.application }, user: { findUnique: mocks.actor },
    $transaction: async (run: (tx: unknown) => unknown) => run({ loanApplication: { updateMany: mocks.update }, auditEvent: { create: mocks.audit } }),
  },
}));
import { POST } from "./route";
const id = "31cf8dad-6817-4c78-b85e-e907c94be38f";
const params = { params: Promise.resolve({ id }) };
const request = () => new Request("http://localhost/submit", { method: "POST" });
const application = { id, status: "DRAFT", officeId: "office", submittedById: "actor", updatedAt: new Date("2026-10-07"), proposedPrincipalMinor: 300000000n, product: { principalMinMinor: 100n, principalMaxMinor: 500000000n } };
describe("resubmitting a loan draft", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ user: { id: "actor" } });
    mocks.scope.mockResolvedValue({ organizationId: "org", officeIds: ["office"] });
    mocks.application.mockResolvedValue(application);
    mocks.actor.mockResolvedValue({ systemRole: "LOAN_OFFICER" });
    mocks.allowed.mockResolvedValue(true); mocks.update.mockResolvedValue({ count: 1 });
  });
  it("requires a new approval and records the actual resubmitter as maker", async () => {
    expect((await POST(request(), params)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id, status: "DRAFT", updatedAt: application.updatedAt },
      data: { status: "SUBMITTED", submittedAt: expect.any(Date), submittedById: "actor" },
    });
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.application).toHaveBeenCalledWith(expect.objectContaining({ where: { id, office: { organizationId: "org" }, officeId: { in: ["office"] } } }));
  });
  it("rejects stale drafts without writing an audit success", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    expect((await POST(request(), params)).status).toBe(409);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("requires permission and draft ownership or a manager", async () => {
    mocks.allowed.mockResolvedValue(false);
    expect((await POST(request(), params)).status).toBe(403);
    mocks.allowed.mockResolvedValue(true); mocks.application.mockResolvedValue({ ...application, submittedById: "another-maker" });
    expect((await POST(request(), params)).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects non-drafts, invalid principal and invalid IDs", async () => {
    mocks.application.mockResolvedValue({ ...application, status: "APPROVED" });
    expect((await POST(request(), params)).status).toBe(409);
    mocks.application.mockResolvedValue({ ...application, proposedPrincipalMinor: 0n });
    expect((await POST(request(), params)).status).toBe(400);
    expect((await POST(request(), { params: Promise.resolve({ id: "invalid" }) })).status).toBe(400);
  });
});
