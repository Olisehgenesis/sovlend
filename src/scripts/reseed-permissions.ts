import { prisma } from "@/lib/prisma";
import { seedPermissionGroups } from "@/modules/identity/application/seed-permissions";

/**
 * Idempotent re-run of permission-group seeding for every existing organization. Needed
 * whenever new permission codes (e.g. new report permissions) are added after an org's
 * initial bootstrap, since `seedPermissionGroups` only runs automatically during
 * `import-foundation.ts`'s first-time import. Safe to run repeatedly — every write is an
 * upsert.
 */
async function main() {
  const organizations = await prisma.organization.findMany({ select: { id: true, name: true } });
  for (const organization of organizations) {
    await seedPermissionGroups(prisma, organization.id);
    console.log(`Reseeded permission groups for ${organization.name} (${organization.id}).`);
  }
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
