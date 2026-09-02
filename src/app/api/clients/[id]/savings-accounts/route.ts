import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AuthorizationService, PermissionDeniedError } from "@/modules/identity/application/authorization-service";
import { getUserDataScope, officeWhere } from "@/modules/identity/application/data-scope";
import { permissions } from "@/modules/identity/domain/permissions";

const schema = z.object({
  accountType: z.enum(["SAVINGS", "SHARE", "FIXED_DEPOSIT", "RECURRING_DEPOSIT"]).default("SAVINGS"),
  productId: z.string().uuid().optional(),
  submittedOn: z.iso.date().optional(),
  fieldOfficerId: z.string().optional(),
  externalId: z.string().trim().max(100).optional(),
  chargeDefinitionIds: z.array(z.string().uuid()).default([]),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid account type" }, { status: 400 });
  const scope = await getUserDataScope(prisma, session.user.id);
  if (!scope) return NextResponse.json({ error: "Workspace assignment required" }, { status: 403 });
  const { id } = await params;
  const client = await prisma.client.findFirst({ where: { id, organizationId: scope.organizationId, ...officeWhere(scope) } });
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  try {
    await new AuthorizationService(prisma).assertAllowed({ actorUserId: session.user.id, permission: permissions.savingsTransact, organizationId: scope.organizationId, officeId: client.officeId });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return NextResponse.json({ error: "You cannot open savings accounts for this client" }, { status: 403 });
    throw error;
  }
  if (client.status !== "ACTIVE") return NextResponse.json({ error: "Client must be active" }, { status: 400 });

  let product: { id: string; name: string; shortName: string; currencyCode: string; nominalAnnualRateBps: number; minOpeningBalanceMinor: bigint } | null = null;
  if (parsed.data.productId) {
    product = await prisma.savingsProduct.findFirst({ where: { id: parsed.data.productId, organizationId: scope.organizationId, active: true } });
    if (!product) return NextResponse.json({ error: "Savings product not found" }, { status: 404 });
  }

  if (parsed.data.fieldOfficerId) {
    const officer = await prisma.user.findFirst({ where: { id: parsed.data.fieldOfficerId, organizationId: scope.organizationId } });
    if (!officer) return NextResponse.json({ error: "Field officer not found" }, { status: 404 });
  }

  let chargeDefinitions: Array<{ id: string; name: string; amountMinor: bigint | null; percentageBps: number | null; calculationType: string; currencyCode: string }> = [];
  if (parsed.data.chargeDefinitionIds.length > 0) {
    chargeDefinitions = await prisma.chargeDefinition.findMany({ where: { id: { in: parsed.data.chargeDefinitionIds }, organizationId: scope.organizationId, appliesTo: "SAVINGS", active: true } });
    if (chargeDefinitions.length !== parsed.data.chargeDefinitionIds.length) return NextResponse.json({ error: "One or more charges are invalid" }, { status: 400 });
  }

  const existingCount = await prisma.savingsAccount.count({ where: { clientId: client.id } });
  const accountNumber = existingCount === 0 ? client.accountNumber : `${client.accountNumber}-S${existingCount + 1}`;

  // Snapshot product terms at opening time so later edits to the product never change this account's terms.
  const termsSnapshot = product ? { productId: product.id, name: product.name, shortName: product.shortName, nominalAnnualRateBps: product.nominalAnnualRateBps, minOpeningBalanceMinor: product.minOpeningBalanceMinor.toString() } : undefined;

  const savingsAccount = await prisma.$transaction(async (transaction) => {
    const account = await transaction.savingsAccount.create({
      data: {
        clientId: client.id,
        accountNumber,
        accountType: parsed.data.accountType,
        currencyCode: product?.currencyCode ?? "UGX",
        status: "SUBMITTED",
        productId: product?.id,
        termsSnapshot,
        submittedOn: parsed.data.submittedOn ? new Date(`${parsed.data.submittedOn}T00:00:00.000Z`) : new Date(),
        submittedById: session.user.id,
        fieldOfficerId: parsed.data.fieldOfficerId || null,
        externalId: parsed.data.externalId || null,
      },
    });
    for (const definition of chargeDefinitions) {
      const amountMinor = definition.calculationType === "FLAT"
        ? (definition.amountMinor ?? 0n)
        : BigInt(Math.round((product?.minOpeningBalanceMinor ? Number(product.minOpeningBalanceMinor) : 0) * ((definition.percentageBps ?? 0) / 10_000)));
      await transaction.charge.create({
        data: { clientId: client.id, savingsAccountId: account.id, chargeDefinitionId: definition.id, name: definition.name, amountMinor, currencyCode: definition.currencyCode },
      });
    }
    return account;
  });
  return NextResponse.json({ id: savingsAccount.id, accountNumber: savingsAccount.accountNumber }, { status: 201 });
}
