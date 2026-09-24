import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, groupScopeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";
import { ADMISSION_GROUP_CHARGE_NAME, MEMBER_CRB_FEE_CHARGE_NAME, MEMBER_CRB_INCOME_CHARGE_NAME, openingChargeNames } from "@/modules/charges/domain/opening-charges";
import { nextSubAccountNumber } from "@/modules/lending/domain/sub-account-numbering";

const schema = z.object({
  chargeCrb: z.boolean().default(false),
});

const GROUP_JOURNAL_CONTRIBUTION_SHORT_NAME = "GGS";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id } = await params;
  const group = await prisma.group.findFirst({ where: { id, organizationId: scope.organizationId, ...groupScopeWhere(scope) } });
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  if (group.status !== "ACTIVE") return NextResponse.json({ error: "Group must be active" }, { status: 400 });

  try {
    await new AuthorizationService(prisma).assertAllowed({
      actorUserId: session.user.id,
      permission: permissions.savingsTransact,
      organizationId: scope.organizationId,
      officeId: group.officeId,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot open savings accounts for this group" }, { status: 403 });
    throw error;
  }

  const product = await prisma.savingsProduct.findFirst({
    where: { organizationId: scope.organizationId, shortName: GROUP_JOURNAL_CONTRIBUTION_SHORT_NAME, active: true },
  });
  if (!product) return NextResponse.json({ error: "Group journal contribution product is not configured" }, { status: 400 });

  const existing = await prisma.savingsAccount.findFirst({
    where: { groupId: group.id, productId: product.id },
    select: { id: true, accountNumber: true },
  });
  if (existing) return NextResponse.json({ error: "This group already has a journal contribution account" }, { status: 409 });

  const chargeNames = openingChargeNames({ membership: "GROUP", chargeCrb: parsed.data.chargeCrb });
  const chargeDefinitions = await prisma.chargeDefinition.findMany({
    where: { organizationId: scope.organizationId, appliesTo: "SAVINGS", active: true, name: { in: [...chargeNames] } },
  });

  const existingCount = await prisma.savingsAccount.count({ where: { groupId: group.id } });
  const accountNumber = nextSubAccountNumber(group.accountNumber, "S", existingCount);
  const termsSnapshot = {
    productId: product.id,
    name: product.name,
    shortName: product.shortName,
    nominalAnnualRateBps: product.nominalAnnualRateBps,
    minOpeningBalanceMinor: product.minOpeningBalanceMinor.toString(),
  };

  const savingsAccount = await prisma.$transaction(async (transaction) => {
    const account = await transaction.savingsAccount.create({
      data: {
        groupId: group.id,
        accountNumber,
        accountType: "SAVINGS",
        currencyCode: product.currencyCode,
        status: "SUBMITTED",
        productId: product.id,
        termsSnapshot,
        submittedOn: new Date(),
        submittedById: session.user.id,
      },
    });
    for (const definition of chargeDefinitions) {
      const amountMinor = definition.calculationType === "FLAT" ? (definition.amountMinor ?? 0n) : 0n;
      if (amountMinor <= 0n) continue;
      await transaction.charge.create({
        data: {
          groupId: group.id,
          savingsAccountId: account.id,
          chargeDefinitionId: definition.id,
          name: definition.name,
          amountMinor,
          currencyCode: definition.currencyCode,
        },
      });
    }
    return account;
  });

  return NextResponse.json({
    id: savingsAccount.id,
    accountNumber: savingsAccount.accountNumber,
    admissionCharge: ADMISSION_GROUP_CHARGE_NAME,
    crbCharges: parsed.data.chargeCrb ? [MEMBER_CRB_INCOME_CHARGE_NAME, MEMBER_CRB_FEE_CHARGE_NAME] : [],
  }, { status: 201 });
}
