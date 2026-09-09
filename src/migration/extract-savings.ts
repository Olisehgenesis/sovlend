import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeArtifact, writeManifest, type ArtifactManifest, type MigrationManifest } from "./archive";
import { ReadOnlyFineractClient } from "./fineract-client";
import { extractSavingsAccountIdsFromAccountsPayload } from "./legacy-savings";

export async function extractLegacySavingsHistory(
  environment: NodeJS.ProcessEnv,
  options: Readonly<{ root?: string }> = {},
) {
  const baseUrl = required(environment, "LEGACY_BASE_URL");
  const tenant = required(environment, "LEGACY_TENANT_ID");
  const username = required(environment, "LEGACY_USERNAME");
  const password = required(environment, "LEGACY_PASSWORD");
  const root = options.root
    ? path.resolve(options.root)
    : path.resolve(environment.MIGRATION_ARCHIVE_DIR ?? ".migration-data", required(environment, "MIGRATION_RUN_ID"));
  const staggerMs = Number.parseInt(environment.MIGRATION_STAGGER_MS ?? "120", 10);

  const client = new ReadOnlyFineractClient(baseUrl, tenant, username, password);
  const extractedAt = new Date().toISOString();
  const artifacts: ArtifactManifest[] = await loadManifestArtifacts(root);
  const checkpointFile = path.join(root, ".checkpoint-savings-history.json");
  const checkpoint = await loadCheckpoint(checkpointFile);
  const done = new Set(checkpoint.done);
  const accountIds = await readSavingsAccountIds(root);

  let accountsProcessed = 0;
  const errors: string[] = [];

  for (const accountId of accountIds) {
    const key = String(accountId);
    if (done.has(key)) continue;

    try {
      const payload = await client.getSavingsAccount(accountId);
      const artifact = await writeArtifact(root, "savings-accounts", accountId, accountId, payload, 1);
      artifacts.push(artifact);
      done.add(key);
      accountsProcessed += 1;
      await sleep(staggerMs);
    } catch (error) {
      errors.push(`savings:${accountId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (accountsProcessed > 0 && accountsProcessed % 25 === 0) {
      await writeManifest(root, { formatVersion: 1, sourceSystem: "fineract", sourceTenant: tenant, extractedAt, artifacts: deduplicate(artifacts) });
      await writeFile(checkpointFile, JSON.stringify({ done: [...done] }), { mode: 0o600 });
    }
  }

  const manifest: MigrationManifest = { formatVersion: 1, sourceSystem: "fineract", sourceTenant: tenant, extractedAt, artifacts: deduplicate(artifacts) };
  await writeManifest(root, manifest);
  await writeFile(checkpointFile, JSON.stringify({ done: [...done] }), { mode: 0o600 });

  return { root, accountsDiscovered: accountIds.length, accountsProcessed, errors };
}

async function readSavingsAccountIds(root: string): Promise<number[]> {
  const ids = new Set<number>();

  for (const entity of ["client-accounts", "group-accounts"] as const) {
    const folder = path.join(root, "raw", entity);
    let files: string[];
    try {
      files = (await readdir(folder)).filter((file) => file.endsWith(".json")).sort();
    } catch {
      continue;
    }

    for (const file of files) {
      const payload = JSON.parse(await readFile(path.join(folder, file), "utf8")) as unknown;
      for (const accountId of extractSavingsAccountIdsFromAccountsPayload(payload)) ids.add(accountId);
    }
  }

  return [...ids].sort((left, right) => left - right);
}

async function loadManifestArtifacts(root: string): Promise<ArtifactManifest[]> {
  try {
    return (JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as MigrationManifest).artifacts;
  } catch {
    return [];
  }
}

async function loadCheckpoint(file: string): Promise<{ done: string[] }> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return { done: [] };
  }
}

function deduplicate(artifacts: ArtifactManifest[]) {
  return [...new Map(artifacts.map((artifact) => [`${artifact.entity}:${artifact.page}`, artifact])).values()].sort(
    (left, right) => left.entity.localeCompare(right.entity) || left.page - right.page,
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  process.loadEnvFile?.(".env");

  const root = process.argv[2];
  const result = await extractLegacySavingsHistory(process.env, root ? { root } : {});
  console.log(`Extracted savings history for ${result.accountsProcessed}/${result.accountsDiscovered} accounts into ${result.root}`);
  if (result.errors.length > 0) console.log(`${result.errors.length} issues:\n${result.errors.join("\n")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
