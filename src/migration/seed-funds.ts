import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";

const legacyFundsSchema = z.array(
  z.object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(150),
  }),
);

type SeedFundsOptions = Readonly<{
  organizationId?: string;
  organizationName?: string;
}>;

export type SeedFundsResult = Readonly<{
  organizationsProcessed: number;
  fundsInFile: number;
  fundsCreated: number;
  fundsExisting: number;
}>;

async function loadLegacyFunds() {
  const file = new URL("./data/legacy-funds.json", import.meta.url);
  return legacyFundsSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

async function resolveOrganizations(prisma: PrismaClient, options: SeedFundsOptions) {
  if (options.organizationId) {
    return [await prisma.organization.findUniqueOrThrow({ where: { id: options.organizationId }, select: { id: true, name: true } })];
  }
  if (options.organizationName) {
    return [await prisma.organization.findFirstOrThrow({ where: { name: options.organizationName }, select: { id: true, name: true } })];
  }
  const organizations = await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (organizations.length === 0) throw new Error("No organizations found to seed funds into");
  return organizations;
}

export async function seedFunds(prisma: PrismaClient, options: SeedFundsOptions = {}): Promise<SeedFundsResult> {
  const [organizations, legacyFunds] = await Promise.all([resolveOrganizations(prisma, options), loadLegacyFunds()]);
  let fundsCreated = 0;
  let fundsExisting = 0;

  for (const organization of organizations) {
    for (const fund of legacyFunds) {
      const existing = await prisma.fund.findUnique({
        where: {
          organizationId_name: {
            organizationId: organization.id,
            name: fund.name,
          },
        },
        select: { id: true },
      });
      if (existing) {
        fundsExisting += 1;
        continue;
      }
      await prisma.fund.create({
        data: {
          organizationId: organization.id,
          name: fund.name,
          code: null,
          isActive: true,
        },
      });
      fundsCreated += 1;
    }
  }

  return {
    organizationsProcessed: organizations.length,
    fundsInFile: legacyFunds.length,
    fundsCreated,
    fundsExisting,
  };
}

async function main() {
  try {
    const result = await seedFunds(prisma, {
      organizationId: process.env.MIGRATION_ORGANIZATION_ID,
      organizationName: process.env.MIGRATION_ORGANIZATION_NAME,
    });
    console.log(
      `Seeded legacy funds for ${result.organizationsProcessed} organization(s): ${result.fundsCreated} created, ${result.fundsExisting} already existed (${result.fundsInFile} fund names in source file).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
