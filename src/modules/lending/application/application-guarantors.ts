import type { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { AuthorizationService } from "@/modules/identity/application/authorization-service";
import { officeWhere, type UserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

export const applicationGuarantorSchema = z.object({
  clientId: z.uuid().optional(),
  firstName: z.string().trim().min(1).max(150),
  lastName: z.string().trim().min(1).max(150),
  phone: z.string().trim().min(1).max(50),
  relationship: z.string().trim().max(150).optional(),
  gender: z.string().trim().max(50).optional(),
  nationalId: z.string().trim().max(150).optional(),
  address: z.string().trim().max(1000).optional(),
  occupation: z.string().trim().max(150).optional(),
  employer: z.string().trim().max(150).optional(),
  bio: z.string().trim().max(2000).optional(),
  dateOfBirth: z.iso.date().refine((date) => date <= new Date().toISOString().slice(0, 10), "Date of birth cannot be in the future").optional(),
}).strict();

export type ApplicationGuarantor = z.infer<typeof applicationGuarantorSchema>;

export function readApplicationGuarantors(value: unknown): ApplicationGuarantor[] {
  if (value === null || value === undefined) return [];
  return z.array(applicationGuarantorSchema).max(50).parse(value);
}

export class ApplicationGuarantorError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function addApplicationGuarantor(
  db: PrismaClient,
  scope: UserDataScope,
  command: { applicationId: string; actorUserId: string; guarantor: ApplicationGuarantor; profileId?: string },
) {
  const guarantor = applicationGuarantorSchema.parse(command.guarantor);
  return db.$transaction(async (tx) => {
    const application = await tx.loanApplication.findFirst({
      where: { id: command.applicationId, office: { organizationId: scope.organizationId }, ...officeWhere(scope) },
    });
    if (!application) throw new ApplicationGuarantorError("Loan application not found", 404);
    if (application.status !== "SUBMITTED" && application.status !== "DRAFT") throw new ApplicationGuarantorError("Guarantors can only be added while the application is awaiting approval", 409);
    await new AuthorizationService(db).assertAllowed({
      actorUserId: command.actorUserId, permission: permissions.loanApply,
      organizationId: scope.organizationId, officeId: application.officeId,
    });
    if (command.profileId && !await tx.guarantorProfile.findFirst({ where: { id: command.profileId, applicationId: application.id } })) throw new ApplicationGuarantorError("Guarantor not found", 404);
    if (guarantor.clientId) {
      const client = await tx.client.findFirst({ where: { id: guarantor.clientId, organizationId: scope.organizationId, ...officeWhere(scope) } });
      if (!client) throw new ApplicationGuarantorError("Selected client is not in your permitted offices", 404);
      if (client.id === application.clientId) throw new ApplicationGuarantorError("The borrower cannot guarantee their own loan", 400);
    }
    const count = await tx.guarantorProfile.count({ where: { applicationId: application.id } });
    if (!command.profileId && count >= 50) throw new ApplicationGuarantorError("An application can have at most 50 guarantors", 400);
    const updated = await tx.loanApplication.updateMany({
      where: { id: application.id, status: application.status, updatedAt: application.updatedAt },
      data: { updatedAt: new Date() },
    });
    if (updated.count !== 1) throw new ApplicationGuarantorError("Application changed. Refresh and try again", 409);
    const data = {
      firstName: guarantor.firstName, lastName: guarantor.lastName, phone: guarantor.phone,
      clientId: guarantor.clientId ?? null, relationship: guarantor.relationship || null,
      dateOfBirth: guarantor.dateOfBirth ? new Date(`${guarantor.dateOfBirth}T00:00:00Z`) : null,
      gender: guarantor.gender || null, nationalId: guarantor.nationalId || null, address: guarantor.address || null,
      occupation: guarantor.occupation || null, employer: guarantor.employer || null, bio: guarantor.bio || null,
    };
    const profile = command.profileId
      ? await tx.guarantorProfile.update({ where: { id: command.profileId }, data })
      : await tx.guarantorProfile.create({ data: { ...data, applicationId: application.id } });
    const correlationId = randomUUID();
    const metadata = { applicationId: application.id, profileId: profile.id };
    const action = command.profileId ? "loan.application.guarantor.updated" : "loan.application.guarantor.added";
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action, metadata })).digest("hex");
    await tx.auditEvent.create({ data: { actorId: command.actorUserId, action, entityType: "LoanApplication", entityId: application.id, correlationId, metadata, eventHash } });
    return profile.id;
  });
}
