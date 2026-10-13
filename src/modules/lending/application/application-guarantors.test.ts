import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorize = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/modules/identity/application/authorization-service", () => ({
  AuthorizationService: class { assertAllowed = authorize; },
}));
import { addApplicationGuarantor, applicationGuarantorSchema, readApplicationGuarantors } from "./application-guarantors";

const person = { firstName: "Jane", lastName: "Doe", phone: "0700000000" };
const scope = { organizationId: "org", officeIds: ["office"], officerUserId: null };
function mock(status = "SUBMITTED", count = 1, found = true) {
  const tx = {
    loanApplication: {
      findFirst: vi.fn(async () => found ? { id: "app", clientId: "borrower", officeId: "office", status, updatedAt: new Date("2026-10-07") } : null),
      updateMany: vi.fn(async () => ({ count })),
    },
    auditEvent: { create: vi.fn(async () => ({})) },
    guarantorProfile: {
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => ({ id: "profile" })),
      create: vi.fn(async () => ({ id: "profile" })),
      update: vi.fn(async () => ({ id: "profile" })),
    },
    client: { findFirst: vi.fn(async () => ({ id: "existing-client" })) },
  };
  return { tx, db: { $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)) } as unknown as PrismaClient };
}
describe("application guarantors", () => {
  beforeEach(() => authorize.mockReset());
  it("validates identity, dates, and existing snapshots", () => {
    expect(applicationGuarantorSchema.parse({ ...person, firstName: " Jane " }).firstName).toBe("Jane");
    expect(applicationGuarantorSchema.safeParse({ ...person, phone: "" }).success).toBe(false);
    expect(applicationGuarantorSchema.safeParse({ ...person, dateOfBirth: "2999-01-01" }).success).toBe(false);
    expect(readApplicationGuarantors(null)).toEqual([]);
    expect(() => readApplicationGuarantors([{}])).toThrow();
  });
  it("adds and audits under the office-scoped loan application permission", async () => {
    const { db, tx } = mock();
    expect(await addApplicationGuarantor(db, scope, { applicationId: "app", actorUserId: "actor", guarantor: person })).toBe("profile");
    expect(tx.loanApplication.findFirst).toHaveBeenCalledWith({ where: { id: "app", office: { organizationId: "org" }, officeId: { in: ["office"] } } });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ officeId: "office", actorUserId: "actor", permission: "LOAN_APPLICATION_CREATE" }));
    expect(tx.loanApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "SUBMITTED", updatedAt: new Date("2026-10-07") }) }));
    expect(tx.guarantorProfile.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ applicationId: "app", ...person }) }));
    expect(tx.auditEvent.create).toHaveBeenCalledOnce();
  });
  it.each(["APPROVED", "REJECTED", "DISBURSED"])("does not change a %s application", async (status) => {
    const { db, tx } = mock(status);
    await expect(addApplicationGuarantor(db, scope, { applicationId: "app", actorUserId: "actor", guarantor: person })).rejects.toThrow("awaiting approval");
    expect(tx.loanApplication.updateMany).not.toHaveBeenCalled();
  });
  it("rejects missing or out-of-scope applications", async () => {
    const { db } = mock("SUBMITTED", 1, false);
    await expect(addApplicationGuarantor(db, scope, { applicationId: "app", actorUserId: "actor", guarantor: person })).rejects.toThrow("not found");
  });
  it("rejects unauthorized writes", async () => {
    const { db, tx } = mock();
    authorize.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(addApplicationGuarantor(db, scope, { applicationId: "app", actorUserId: "actor", guarantor: person })).rejects.toThrow("Permission denied");
    expect(tx.loanApplication.updateMany).not.toHaveBeenCalled();
  });
  it("does not silently lose a concurrent edit or approval", async () => {
    const { db, tx } = mock("SUBMITTED", 0);
    await expect(addApplicationGuarantor(db, scope, { applicationId: "app", actorUserId: "actor", guarantor: person })).rejects.toThrow("Refresh");
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
  it("links a permitted existing client and stores biodata", async () => {
    const { db, tx } = mock();
    const clientId = "d5e2c650-10ad-4b9c-a01d-7cae9ed29454";
    await addApplicationGuarantor(db, scope, { applicationId: "app", actorUserId: "actor", guarantor: { ...person, clientId, bio: "Shop owner", address: "Entebbe" } });
    expect(tx.client.findFirst).toHaveBeenCalledWith({ where: { id: clientId, organizationId: "org", officeId: { in: ["office"] } } });
    expect(tx.guarantorProfile.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ clientId, bio: "Shop owner", address: "Entebbe" }) }));
  });
  it("rejects an out-of-scope client and a borrower guaranteeing themselves", async () => {
    const { db, tx } = mock();
    const command = { applicationId: "app", actorUserId: "actor", guarantor: { ...person, clientId: "d5e2c650-10ad-4b9c-a01d-7cae9ed29454" } };
    tx.client.findFirst.mockResolvedValueOnce(null as never);
    await expect(addApplicationGuarantor(db, scope, command)).rejects.toThrow("permitted offices");
    tx.client.findFirst.mockResolvedValueOnce({ id: "borrower" });
    await expect(addApplicationGuarantor(db, scope, command)).rejects.toThrow("own loan");
    expect(tx.guarantorProfile.create).not.toHaveBeenCalled();
  });
  it("edits only a profile belonging to this application", async () => {
    const { db, tx } = mock();
    await addApplicationGuarantor(db, scope, { applicationId: "app", actorUserId: "actor", guarantor: person, profileId: "profile" });
    expect(tx.guarantorProfile.findFirst).toHaveBeenCalledWith({ where: { id: "profile", applicationId: "app" } });
    expect(tx.guarantorProfile.update).toHaveBeenCalledOnce();
    tx.guarantorProfile.findFirst.mockResolvedValueOnce(null as never);
    await expect(addApplicationGuarantor(db, scope, { applicationId: "app", actorUserId: "actor", guarantor: person, profileId: "other" })).rejects.toThrow("not found");
  });
});
