import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { permissionDescriptions } from "@/modules/identity/application/seed-permissions";
import { permissions } from "@/modules/identity/domain/permissions";
import { decideLoanServiceAction, parseServiceActionPayload } from "@/modules/lending/application/loan-service-actions";

async function main() {
  const { values } = parseArgs({
    options: {
      "user-id": { type: "string" }, "expected-name": { type: "string" },
      "office-id": { type: "string" }, reason: { type: "string" },
      "approve-request": { type: "string" }, "expected-payment-minor": { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  const input = z.object({
    "user-id": z.string().min(1), "expected-name": z.string().min(1),
    "office-id": z.string().uuid(), reason: z.string().trim().min(1),
    "approve-request": z.string().uuid().optional(),
    "expected-payment-minor": z.string().regex(/^[1-9]\d*$/).optional(),
    apply: z.boolean(),
  }).parse(values);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input["user-id"] } });
  const office = await prisma.office.findUniqueOrThrow({ where: { id: input["office-id"] } });
  if (user.name !== input["expected-name"] || user.organizationId !== office.organizationId || user.officeId !== office.id) {
    throw new Error("Expected user identity, organization, and office must match before granting permission");
  }

  const request = input["approve-request"]
    ? await prisma.loanServiceRequest.findUniqueOrThrow({ where: { id: input["approve-request"] }, include: { loan: true } })
    : null;
  if (request) {
    if (request.actionType !== "TRANSACTION_REVERSAL" || request.loan.officeId !== office.id || request.requestedById !== user.id) {
      throw new Error("Only this user's repayment cancellation request in the selected office can be authorized");
    }
    const payload = parseServiceActionPayload("TRANSACTION_REVERSAL", request.payload);
    if (!("transactionId" in payload) || typeof payload.transactionId !== "string") throw new Error("Repayment cancellation transaction is missing");
    const payment = await prisma.loanTransaction.findUniqueOrThrow({ where: { id: payload.transactionId } });
    if (!input["expected-payment-minor"] || payment.loanId !== request.loanId || payment.denominationAmountMinor.toString() !== input["expected-payment-minor"]) {
      throw new Error("The request's payment must match the explicitly expected amount and loan");
    }
  }
  console.log(JSON.stringify({
    dryRun: !input.apply, user: user.name, office: office.name,
    permission: permissions.loanRepaymentReverse,
    requestId: request?.id ?? null, requestStatus: request?.status ?? null,
  }));
  if (!input.apply) return;

  await prisma.$transaction(async (tx) => {
    const code = permissions.loanRepaymentReverse;
    await tx.permissionDefinition.upsert({
      where: { code }, create: { code, description: permissionDescriptions[code], riskLevel: "HIGH" },
      update: { description: permissionDescriptions[code], riskLevel: "HIGH" },
    });
    const name = `Direct repayment cancellation - ${user.id}`;
    const group = await tx.permissionGroup.upsert({
      where: { organizationId_name: { organizationId: office.organizationId, name } },
      create: { organizationId: office.organizationId, name, description: input.reason },
      update: {},
    });
    await tx.permissionGroupPermission.upsert({
      where: { groupId_permissionCode: { groupId: group.id, permissionCode: code } },
      create: { groupId: group.id, permissionCode: code }, update: {},
    });
    const assignment = await tx.userPermissionAssignment.upsert({
      where: { userId_groupId_scope_officeId: { userId: user.id, groupId: group.id, scope: "OFFICE", officeId: office.id } },
      create: { userId: user.id, groupId: group.id, scope: "OFFICE", officeId: office.id },
      update: { validFrom: new Date(), validUntil: null },
    });
    const correlationId = randomUUID();
    const metadata = {
      userId: user.id, permission: code, assignmentId: assignment.id, officeId: office.id,
      executionSource: "SSH operator", userDirected: true, reason: input.reason,
    };
    const action = "permission.repayment_cancellation.granted";
    const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action, metadata })).digest("hex");
    await tx.auditEvent.create({ data: { actorId: null, action, entityType: "User", entityId: user.id, correlationId, metadata, eventHash } });
  }, { isolationLevel: "Serializable" });
  console.log("Granted office-scoped direct repayment cancellation; existing role assignments were preserved.");

  if (request) {
    const result = await decideLoanServiceAction(prisma, {
      requestId: request.id, actorUserId: user.id, decision: "APPROVE",
      note: `Executed by SSH operator on behalf of ${user.name} under LOAN_REPAYMENT_REVERSE permission. User-directed: ${input.reason}`,
    });
    console.log(JSON.stringify({ requestId: result.id, status: result.status, reversalTransactionId: result.resultTransactionId }));
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
