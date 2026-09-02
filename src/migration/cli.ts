import { rebuildManifest, verifyArchive } from "./archive";
import { extractLegacy } from "./extract";
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
  throw new Error("Usage: migration:extract | migration:verify <archive-directory> | migration:manifest <archive-directory> | migration:import <archive-directory>");
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });