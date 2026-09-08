import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { canEditSubmittedLoanApplication } from "@/modules/lending/application/loan-application-access";
import {
  buildChargeSnapshot,
  buildCollateralSnapshot,
  buildTermsSnapshot,
  readChargeSnapshot,
  readCollateralSnapshot,
  readTermsSnapshot,
  updateLoanApplicationSchema,
} from "@/modules/lending/application/loan-application-payload";

const editableFields = [
  "proposedPrincipalMinor",
  "purpose",
  "externalId",
  "applicationExpiresOn",
  "fundId",
  "loanOfficerId",
  "terms",
  "charges",
  "collateral",
] as const;

function hasOwn(payload: Record<string, unknown>, key: (typeof editableFields)[number]) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function toDateInput(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function normalizeApplicationState(application: {
  applicationExpiresOn: Date | null;
  chargesSnapshot: unknown;
  collateralSnapshot: unknown;
  externalId: string | null;
  fundId: string | null;
  loanOfficerId: string | null;
  proposedPrincipalMinor: bigint;
  purpose: string | null;
  termsSnapshot: unknown;
}) {
  return {
    proposedPrincipalMinor: application.proposedPrincipalMinor.toString(),
    purpose: application.purpose,
    externalId: application.externalId,
    applicationExpiresOn: toDateInput(application.applicationExpiresOn),
    fundId: application.fundId,
    loanOfficerId: application.loanOfficerId,
    terms: readTermsSnapshot(application.termsSnapshot),
    charges: readChargeSnapshot(application.chargesSnapshot),
    collateral: readCollateralSnapshot(application.collateralSnapshot),
  };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await request.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Invalid application update" }, { status: 400 });
  }

  if (!editableFields.some((field) => hasOwn(payload, field))) {
    return NextResponse.json({ error: "Provide at least one field to update" }, { status: 400 });
  }

  const parsed = updateLoanApplicationSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid application update" }, { status: 400 });

  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });

  const [application, actor] = await Promise.all([
    prisma.loanApplication.findFirst({
      where: { id: (await params).id, office: { organizationId: scope.organizationId } },
      include: {
        office: { select: { organizationId: true } },
        product: {
          select: {
            denominationCurrency: true,
            principalMaxMinor: true,
            principalMinMinor: true,
          },
        },
      },
    }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { systemRole: true } }),
  ]);

  if (!application || (scope.officeIds && !scope.officeIds.includes(application.officeId))) {
    return NextResponse.json({ error: "Loan application not found" }, { status: 404 });
  }

  if (application.status !== "SUBMITTED") {
    return NextResponse.json({ error: "Only submitted applications awaiting review can be edited" }, { status: 409 });
  }

  try {
    await new AuthorizationService(prisma).assertAllowed({
      actorUserId: session.user.id,
      permission: permissions.loanApply,
      organizationId: application.office.organizationId,
      officeId: application.officeId,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return NextResponse.json({ error: "You cannot edit this application" }, { status: 403 });
    }
    throw error;
  }

  if (!canEditSubmittedLoanApplication({ actorUserId: session.user.id, actorSystemRole: actor?.systemRole, submittedById: application.submittedById })) {
    return NextResponse.json({ error: "Only the submitter or an approving manager can edit this application" }, { status: 403 });
  }

  if (hasOwn(payload, "proposedPrincipalMinor")) {
    const principal = BigInt(parsed.data.proposedPrincipalMinor ?? "0");
    if (principal < application.product.principalMinMinor || principal > application.product.principalMaxMinor) {
      return NextResponse.json({ error: "Requested principal is outside the selected product range" }, { status: 400 });
    }
  }

  const [loanOfficer, fund] = await Promise.all([
    hasOwn(payload, "loanOfficerId") && parsed.data.loanOfficerId
      ? prisma.user.findFirst({
          where: { id: parsed.data.loanOfficerId, organizationId: application.office.organizationId, systemRole: "LOAN_OFFICER" },
        })
      : null,
    hasOwn(payload, "fundId") && parsed.data.fundId
      ? prisma.fund.findFirst({
          where: { id: parsed.data.fundId, organizationId: application.office.organizationId, isActive: true },
        })
      : null,
  ]);

  if (hasOwn(payload, "loanOfficerId") && parsed.data.loanOfficerId && !loanOfficer) {
    return NextResponse.json({ error: "Selected loan officer was not found" }, { status: 404 });
  }
  if (hasOwn(payload, "fundId") && parsed.data.fundId && !fund) {
    return NextResponse.json({ error: "Selected fund was not found" }, { status: 404 });
  }

  const beforeState = normalizeApplicationState(application);
  const nextTerms = hasOwn(payload, "terms")
    ? {
        ...beforeState.terms,
        ...readTermsSnapshot(parsed.data.terms ?? {}),
      }
    : beforeState.terms;
  const afterState = {
    proposedPrincipalMinor: hasOwn(payload, "proposedPrincipalMinor") ? parsed.data.proposedPrincipalMinor ?? beforeState.proposedPrincipalMinor : beforeState.proposedPrincipalMinor,
    purpose: hasOwn(payload, "purpose") ? parsed.data.purpose || null : beforeState.purpose,
    externalId: hasOwn(payload, "externalId") ? parsed.data.externalId || null : beforeState.externalId,
    applicationExpiresOn: hasOwn(payload, "applicationExpiresOn") ? parsed.data.applicationExpiresOn ?? null : beforeState.applicationExpiresOn,
    fundId: hasOwn(payload, "fundId") ? parsed.data.fundId ?? null : beforeState.fundId,
    loanOfficerId: hasOwn(payload, "loanOfficerId") ? parsed.data.loanOfficerId ?? null : beforeState.loanOfficerId,
    terms: nextTerms,
    charges: hasOwn(payload, "charges") ? readChargeSnapshot(parsed.data.charges ?? []) : beforeState.charges,
    collateral: hasOwn(payload, "collateral") ? readCollateralSnapshot(parsed.data.collateral ?? []) : beforeState.collateral,
  };

  const changes = Object.fromEntries(
    Object.entries(afterState)
      .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(beforeState[key as keyof typeof beforeState]))
      .map(([key, value]) => [key, { before: beforeState[key as keyof typeof beforeState], after: value }]),
  );

  if (Object.keys(changes).length === 0) {
    return NextResponse.json({
      id: application.id,
      status: application.status,
      ...afterState,
      updatedAt: application.updatedAt.toISOString(),
    });
  }

  const correlationId = randomUUID();
  const metadata = {
    applicationId: application.id,
    editorUserId: session.user.id,
    changes,
  };
  const eventHash = createHash("sha256").update(JSON.stringify({ correlationId, action: "loan.application.edited", metadata })).digest("hex");

  const updated = await prisma.$transaction(async (transaction) => {
    const current = await transaction.loanApplication.findUniqueOrThrow({
      where: { id: application.id },
      select: { status: true },
    });
    if (current.status !== "SUBMITTED") throw new Error("Application was changed by another operation");

    const data: Prisma.LoanApplicationUpdateInput = {};
    if (hasOwn(payload, "proposedPrincipalMinor") && parsed.data.proposedPrincipalMinor) data.proposedPrincipalMinor = BigInt(parsed.data.proposedPrincipalMinor);
    if (hasOwn(payload, "purpose")) data.purpose = parsed.data.purpose || null;
    if (hasOwn(payload, "externalId")) data.externalId = parsed.data.externalId || null;
    if (hasOwn(payload, "applicationExpiresOn")) data.applicationExpiresOn = parsed.data.applicationExpiresOn ? new Date(`${parsed.data.applicationExpiresOn}T00:00:00.000Z`) : null;
    if (hasOwn(payload, "fundId")) data.fund = parsed.data.fundId ? { connect: { id: parsed.data.fundId } } : { disconnect: true };
    if (hasOwn(payload, "loanOfficerId")) data.loanOfficer = parsed.data.loanOfficerId ? { connect: { id: parsed.data.loanOfficerId } } : { disconnect: true };
    if (hasOwn(payload, "terms")) data.termsSnapshot = buildTermsSnapshot(nextTerms) ?? Prisma.DbNull;
    if (hasOwn(payload, "charges")) data.chargesSnapshot = buildChargeSnapshot(parsed.data.charges ?? []);
    if (hasOwn(payload, "collateral")) data.collateralSnapshot = buildCollateralSnapshot(parsed.data.collateral ?? []);

    await transaction.loanApplication.update({ where: { id: application.id }, data });

    await transaction.auditEvent.create({
      data: {
        actorId: session.user.id,
        action: "loan.application.edited",
        entityType: "LoanApplication",
        entityId: application.id,
        correlationId,
        metadata,
        eventHash,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        aggregateType: "LoanApplication",
        aggregateId: application.id,
        eventType: "loan.application.edited",
        payload: metadata,
      },
    });

    return transaction.loanApplication.findUniqueOrThrow({ where: { id: application.id } });
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    proposedPrincipalMinor: updated.proposedPrincipalMinor.toString(),
    purpose: updated.purpose,
    externalId: updated.externalId,
    applicationExpiresOn: toDateInput(updated.applicationExpiresOn),
    fundId: updated.fundId,
    loanOfficerId: updated.loanOfficerId,
    terms: readTermsSnapshot(updated.termsSnapshot),
    charges: readChargeSnapshot(updated.chargesSnapshot),
    collateral: readCollateralSnapshot(updated.collateralSnapshot),
    updatedAt: updated.updatedAt.toISOString(),
  });
}
