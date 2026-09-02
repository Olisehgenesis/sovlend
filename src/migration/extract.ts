import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256, writeArtifact, writeManifest, type ArtifactManifest, type MigrationManifest } from "./archive";
import { migrationEntitySchema, ReadOnlyFineractClient, type LegacyEntity } from "./fineract-client";

const defaultEntities: LegacyEntity[] = ["offices", "currencies", "staff", "loanproducts", "savingsproducts", "charges", "glaccounts", "centers", "groups", "clients"];

export async function extractLegacy(environment: NodeJS.ProcessEnv) {
  const baseUrl = required(environment, "LEGACY_BASE_URL");
  const tenant = required(environment, "LEGACY_TENANT_ID");
  const username = required(environment, "LEGACY_USERNAME");
  const password = required(environment, "LEGACY_PASSWORD");
  const archiveBase = environment.MIGRATION_ARCHIVE_DIR ?? ".migration-data";
  const runId = environment.MIGRATION_RUN_ID ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
  const root = path.resolve(archiveBase, runId);
  const entities = (environment.MIGRATION_ENTITIES?.split(",") ?? defaultEntities).map((value) => migrationEntitySchema.parse(value.trim()));
  const client = new ReadOnlyFineractClient(baseUrl, tenant, username, password);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const extractedAt = new Date().toISOString();
  const artifacts: ArtifactManifest[] = await loadExistingArtifacts(root);

  for (const entity of entities) {
    const checkpointFile = path.join(root, `.checkpoint-${entity}.json`);
    const checkpoint = await loadCheckpoint(checkpointFile);
    if (checkpoint.completed) continue;
    let page = checkpoint.page;
    let offset = checkpoint.offset;
    let hasMore = true;
    while (hasMore) {
      const payload = await client.getPage(entity, offset, 200);
      const recordCount = countRecords(payload);
      const artifact = await writeArtifact(root, entity, page, offset, payload, recordCount);
      const previous = artifacts.find((item) => item.entity === entity && item.page === page - 1);
      if (previous && previous.sha256 === artifact.sha256) {
        await rm(path.join(root, artifact.file));
        await writeFile(checkpointFile, JSON.stringify({ page, offset, completed: true, stoppedReason: "identical-page" }), { mode: 0o600 });
        hasMore = false;
        continue;
      }
      artifacts.push(artifact);
      await writeManifest(root, { formatVersion: 1, sourceSystem: "fineract", sourceTenant: tenant, extractedAt, artifacts: deduplicate(artifacts) });
      hasMore = pageHasMore(payload, offset, recordCount);
      page += 1;
      offset += recordCount;
      await writeFile(checkpointFile, JSON.stringify({ page, offset, completed: !hasMore }), { mode: 0o600 });
      if (recordCount === 0) hasMore = false;
    }
  }

  const manifest: MigrationManifest = { formatVersion: 1, sourceSystem: "fineract", sourceTenant: tenant, extractedAt, artifacts: deduplicate(artifacts) };
  await writeManifest(root, manifest);
  return { root, manifest };
}

function countRecords(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== "object") return 0;
  const record = payload as Record<string, unknown>;
  for (const key of ["pageItems", "content", "clients", "groups", "centers", "loanProducts", "savingsProducts", "charges"]) {
    if (Array.isArray(record[key])) return record[key].length;
  }
  return typeof record.id === "number" ? 1 : Object.keys(record).length > 0 ? 1 : 0;
}

function pageHasMore(payload: unknown, offset: number, recordCount: number) {
  if (!payload || typeof payload !== "object") return false;
  const total = (payload as Record<string, unknown>).totalFilteredRecords;
  if (typeof total === "number") return offset + recordCount < total;
  return recordCount === 200;
}

async function loadCheckpoint(file: string): Promise<{ page: number; offset: number; completed: boolean }> {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return { page: 0, offset: 0, completed: false }; }
}

async function loadExistingArtifacts(root: string): Promise<ArtifactManifest[]> {
  try {
    return (JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as MigrationManifest).artifacts;
  } catch {
    const rawRoot = path.join(root, "raw");
    const artifacts: ArtifactManifest[] = [];
    let entities: string[] = [];
    try { entities = await readdir(rawRoot); } catch { return []; }
    for (const entity of entities) {
      const files = (await readdir(path.join(rawRoot, entity))).filter((file) => file.endsWith(".json")).sort();
      for (const fileName of files) {
        const body = await readFile(path.join(rawRoot, entity, fileName), "utf8");
        const page = Number.parseInt(fileName, 10);
        artifacts.push({ entity, page, offset: page * 200, recordCount: countRecords(JSON.parse(body)), file: path.join("raw", entity, fileName), sha256: sha256(body) });
      }
    }
    return artifacts;
  }
}

function deduplicate(artifacts: ArtifactManifest[]) {
  return [...new Map(artifacts.map((artifact) => [`${artifact.entity}:${artifact.page}`, artifact])).values()].sort((left, right) => left.entity.localeCompare(right.entity) || left.page - right.page);
}

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}