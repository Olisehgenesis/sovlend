import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type DefaultChargeDefinition = Readonly<{
  name: string;
  appliesTo: "LOAN" | "SAVINGS";
  calculationType: "FLAT" | "PERCENTAGE";
  amountMinor?: bigint;
  percentageBps?: number;
  penalty: boolean;
}>;

// Standard charge catalog matching the loan-officer workflow used in the legacy system, seeded as
// editable defaults so operators aren't starting from an empty charge list. Amounts mirror the
// legacy system's real-world configuration for the equivalent charges; admins can edit or
// deactivate any of these from Backoffice > Products > Charges at any time.
const DEFAULT_CHARGE_DEFINITIONS: readonly DefaultChargeDefinition[] = [
  {
    // amountMinor is stored in hundredths of a shilling (same ×100 scale as LoanProduct.principalMinMinor),
    // even though UGX has no real sub-unit — 10,000 UGX => 1_000_000 minor.
    name: "Loan processing fee",
    appliesTo: "LOAN",
    calculationType: "FLAT",
    amountMinor: 1_000_000n,
    penalty: false,
  },
  {
    name: "Admission fee",
    appliesTo: "LOAN",
    calculationType: "FLAT",
    amountMinor: 2_500_000n,
    penalty: false,
  },
  {
    name: "Penalty",
    appliesTo: "LOAN",
    calculationType: "PERCENTAGE",
    percentageBps: 100,
    penalty: true,
  },
];

type SeedChargeDefinitionsOptions = Readonly<{
  organizationId?: string;
  organizationName?: string;
}>;

export type SeedChargeDefinitionsResult = Readonly<{
  organizationsProcessed: number;
  chargesInCatalog: number;
  chargesCreated: number;
  chargesExisting: number;
}>;

async function resolveOrganizations(prisma: PrismaClient, options: SeedChargeDefinitionsOptions) {
  if (options.organizationId) {
    return [await prisma.organization.findUniqueOrThrow({ where: { id: options.organizationId }, select: { id: true, name: true } })];
  }
  if (options.organizationName) {
    return [await prisma.organization.findFirstOrThrow({ where: { name: options.organizationName }, select: { id: true, name: true } })];
  }
  const organizations = await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (organizations.length === 0) throw new Error("No organizations found to seed charge definitions into");
  return organizations;
}

export async function seedChargeDefinitions(
  prisma: PrismaClient,
  options: SeedChargeDefinitionsOptions = {},
): Promise<SeedChargeDefinitionsResult> {
  const organizations = await resolveOrganizations(prisma, options);
  let chargesCreated = 0;
  let chargesExisting = 0;

  for (const organization of organizations) {
    for (const charge of DEFAULT_CHARGE_DEFINITIONS) {
      const existing = await prisma.chargeDefinition.findUnique({
        where: { organizationId_name: { organizationId: organization.id, name: charge.name } },
        select: { id: true },
      });
      if (existing) {
        chargesExisting += 1;
        continue;
      }
      await prisma.chargeDefinition.create({
        data: {
          organizationId: organization.id,
          name: charge.name,
          appliesTo: charge.appliesTo,
          calculationType: charge.calculationType,
          amountMinor: charge.amountMinor ?? null,
          percentageBps: charge.percentageBps ?? null,
          currencyCode: "UGX",
          penalty: charge.penalty,
          active: true,
        },
      });
      chargesCreated += 1;
    }
  }

  return {
    organizationsProcessed: organizations.length,
    chargesInCatalog: DEFAULT_CHARGE_DEFINITIONS.length,
    chargesCreated,
    chargesExisting,
  };
}

async function main() {
  try {
    const result = await seedChargeDefinitions(prisma, {
      organizationId: process.env.MIGRATION_ORGANIZATION_ID,
      organizationName: process.env.MIGRATION_ORGANIZATION_NAME,
    });
    console.log(
      `Seeded default charge definitions for ${result.organizationsProcessed} organization(s): ${result.chargesCreated} created, ${result.chargesExisting} already existed (${result.chargesInCatalog} charges in catalog).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
