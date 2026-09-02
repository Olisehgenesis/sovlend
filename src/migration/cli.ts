import { rebuildManifest, verifyArchive } from "./archive";
import { extractLegacy } from "./extract";
import { ReadOnlyFineractClient } from "./fineract-client";
import { importAllLegacyData } from "./import-all";
import { importFoundation } from "./import-foundation";
import { prisma } from "@/lib/prisma";

async function main() {
  const command = process.argv[2];
  if (command === "extract") {
    const result = await extractLegacy(process.env);
    console.log(`Extracted ${result.manifest.artifacts.length} checksummed pages to ${result.root}`);
    return;
  }
  if (command === "verify") {
    const root = process.argv[3];
    if (!root) throw new Error("Usage: pnpm migration:verify <archive-directory>");
    const manifest = await verifyArchive(root);
    console.log(`Verified ${manifest.artifacts.length} artifacts for tenant ${manifest.sourceTenant}`);
    return;
  }
  if (command === "rebuild-manifest") {
    const root = process.argv[3];
    const tenant = process.env.LEGACY_TENANT_ID;
    if (!root || !tenant) throw new Error("Usage: LEGACY_TENANT_ID=... pnpm migration:manifest <archive-directory>");
    const manifest = await rebuildManifest(root, tenant);
    console.log(`Rebuilt manifest with ${manifest.artifacts.length} artifacts`);
    return;
  }
  if (command === "import") {
    const root = process.argv[3];
    const organizationName = process.env.MIGRATION_ORGANIZATION_NAME;
    if (!root || !organizationName) throw new Error("Usage: MIGRATION_ORGANIZATION_NAME=... pnpm migration:import <archive-directory>");
    const result = await importFoundation(prisma, root, organizationName);
    console.log(`Imported verified foundation run ${result.runId} with ${result.artifacts} artifacts`);
    return;
  }
  if (command === "import-all-clients") {
    const organizationName = process.env.MIGRATION_ORGANIZATION_NAME;
    const officeName = process.env.MIGRATION_DEFAULT_OFFICE_NAME;
    const actorEmail = process.env.MIGRATION_ACTOR_EMAIL;
    const includeLoans = process.env.MIGRATION_INCLUDE_LOANS === "true";
    const includeGroups = process.env.MIGRATION_INCLUDE_GROUPS !== "false";
    const { LEGACY_BASE_URL, LEGACY_TENANT_ID, LEGACY_USERNAME, LEGACY_PASSWORD } = process.env;
    if (!organizationName || !officeName || !actorEmail || !LEGACY_BASE_URL || !LEGACY_TENANT_ID || !LEGACY_USERNAME || !LEGACY_PASSWORD) {
      throw new Error("Usage: MIGRATION_ORGANIZATION_NAME=... MIGRATION_DEFAULT_OFFICE_NAME=... MIGRATION_ACTOR_EMAIL=... [MIGRATION_INCLUDE_LOANS=true] [MIGRATION_INCLUDE_GROUPS=false] LEGACY_*=... pnpm migration:import-all-clients");
    }
    const organization = await prisma.organization.findFirstOrThrow({ where: { name: organizationName } });
    const office = await prisma.office.findFirstOrThrow({ where: { name: officeName, organizationId: organization.id } });
    const actor = await prisma.user.findFirstOrThrow({ where: { email: actorEmail.toLowerCase() } });
    const fineract = new ReadOnlyFineractClient(LEGACY_BASE_URL, LEGACY_TENANT_ID, LEGACY_USERNAME, LEGACY_PASSWORD);
    const result = await importAllLegacyData(prisma, fineract, { organizationId: organization.id, defaultOfficeId: office.id, actorUserId: actor.id, includeLoans, includeGroups });
    console.log(`Imported ${result.clientsImported} clients (${result.clientsSkipped} already present), ${result.groupsImported} groups (${result.groupsSkipped} already present), ${result.loansImported} loans.`);
    if (result.errors.length > 0) console.log(`${result.errors.length} issues:\n${result.errors.join("\n")}`);
    return;
  }
  throw new Error("Usage: migration:extract | migration:verify <archive-directory> | migration:manifest <archive-directory> | migration:import <archive-directory> | migration:import-all-clients");
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });