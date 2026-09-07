import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256, writeArtifact, writeManifest, type ArtifactManifest, type MigrationManifest } from "./archive";
import { ReadOnlyFineractClient } from "./fineract-client";

/**
 * Read-only, resumable, loan-by-loan / client-by-client extraction of legacy loan
 * history (schedule + transactions) into the same checksummed archive format used
 * by `extract.ts`. This is additive: it does not touch the client/group/product
 * roster artifacts already pulled by `extractLegacy`, only appends `client-accounts`,
 * `group-accounts`, and `loans` artifacts and folds them into the same manifest.
 *
 * Never writes to the legacy system -- every call is a GET through
 * ReadOnlyFineractClient, which is hard-restricted to HTTPS and re-validates the
 * request origin hasn't changed between calls.
 */
export async function extractLegacyLoanHistory(environment: NodeJS.ProcessEnv) {
  const baseUrl = required(environment, "LEGACY_BASE_URL");
  const tenant = required(environment, "LEGACY_TENANT_ID");
  const username = required(environment, "LEGACY_USERNAME");
  const password = required(environment, "LEGACY_PASSWORD");
  const archiveBase = environment.MIGRATION_ARCHIVE_DIR ?? ".migration-data";
  const runId = required(environment, "MIGRATION_RUN_ID");
  const root = path.resolve(archiveBase, runId);
  const staggerMs = Number.parseInt(environment.MIGRATION_STAGGER_MS ?? "120", 10);

  const client = new ReadOnlyFineractClient(baseUrl, tenant, username, password);
  const extractedAt = new Date().toISOString();
  const artifacts: ArtifactManifest[] = await loadManifestArtifacts(root);
  const seenLoanIds = new Set<number>();

  const clientIds = await readEntityIds(root, "clients");
  const groupIds = await readEntityIds(root, "groups");

  const checkpointFile = path.join(root, ".checkpoint-loan-history.json");
  const checkpoint = await loadCheckpoint(checkpointFile);
  const done = new Set(checkpoint.done);

  let processed = 0;
  let loansExtracted = 0;
  const errors: string[] = [];

  const owners: Array<{ kind: "client" | "group"; id: number }> = [
    ...clientIds.map((id) => ({ kind: "client" as const, id })),
    ...groupIds.map((id) => ({ kind: "group" as const, id })),
  ];

  for (const owner of owners) {
    const key = `${owner.kind}:${owner.id}`;
    if (done.has(key)) continue;
    try {
      const accountsPayload =
        owner.kind === "client" ? await client.getClientAccounts(owner.id) : await client.getGroupAccounts(owner.id);
      const entity = owner.kind === "client" ? "client-accounts" : "group-accounts";
      const artifact = await writeArtifact(root, entity, owner.id, owner.id, accountsPayload, 1);
      artifacts.push(artifact);

      for (const loanId of extractLoanIds(accountsPayload)) {
        if (seenLoanIds.has(loanId)) continue;
        seenLoanIds.add(loanId);
        await sleep(staggerMs);
        const loanPayload = await client.getLoan(loanId);
        const loanArtifact = await writeArtifact(root, "loans", loanId, loanId, loanPayload, 1);
        artifacts.push(loanArtifact);
        loansExtracted += 1;
      }

      done.add(key);
      processed += 1;
      await sleep(staggerMs);
    } catch (error) {
      errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (processed % 25 === 0) {
      await writeManifest(root, { formatVersion: 1, sourceSystem: "fineract", sourceTenant: tenant, extractedAt, artifacts: deduplicate(artifacts) });
      await writeFile(checkpointFile, JSON.stringify({ done: [...done] }), { mode: 0o600 });
    }
  }

  const manifest: MigrationManifest = { formatVersion: 1, sourceSystem: "fineract", sourceTenant: tenant, extractedAt, artifacts: deduplicate(artifacts) };
  await writeManifest(root, manifest);
  await writeFile(checkpointFile, JSON.stringify({ done: [...done] }), { mode: 0o600 });

  return { root, ownersProcessed: processed, loansExtracted, errors };
}

function extractLoanIds(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const loanAccounts = record.loanAccounts;
  if (!Array.isArray(loanAccounts)) return [];
  return loanAccounts
    .map((account) => (account && typeof account === "object" ? (account as Record<string, unknown>).id : undefined))
    .filter((id): id is number => typeof id === "number");
}

async function readEntityIds(root: string, entity: "clients" | "groups"): Promise<number[]> {
  const folder = path.join(root, "raw", entity);
  let files: string[];
  try {
    files = (await readdir(folder)).filter((file) => file.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const ids: number[] = [];
  for (const file of files) {
    const payload = JSON.parse(await readFile(path.join(folder, file), "utf8")) as unknown;
    const record = payload as Record<string, unknown>;
    const items = Array.isArray(record.pageItems) ? record.pageItems : Array.isArray(payload) ? (payload as unknown[]) : [];
    for (const item of items) {
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "number") {
        ids.push((item as Record<string, unknown>).id as number);
      }
    }
  }
  return ids;
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

// Ensure the archive root exists before first write (defensive; extractLegacy already creates it).
export async function ensureArchiveRoot(archiveBase: string, runId: string) {
  await mkdir(path.resolve(archiveBase, runId), { recursive: true, mode: 0o700 });
}
