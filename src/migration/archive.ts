import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ArtifactManifest = {
  entity: string;
  page: number;
  offset: number;
  recordCount: number;
  file: string;
  sha256: string;
};

export type MigrationManifest = {
  formatVersion: 1;
  sourceSystem: "fineract";
  sourceTenant: string;
  extractedAt: string;
  artifacts: ArtifactManifest[];
};

export async function writeArtifact(root: string, entity: string, page: number, offset: number, payload: unknown, recordCount: number) {
  const folder = path.join(root, "raw", entity);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const file = path.join("raw", entity, `${String(page).padStart(6, "0")}.json`);
  const absolute = path.join(root, file);
  const temporary = `${absolute}.tmp`;
  const body = `${JSON.stringify(payload)}\n`;
  await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, absolute);
  return { entity, page, offset, recordCount, file, sha256: sha256(body) } satisfies ArtifactManifest;
}

export async function writeManifest(root: string, manifest: MigrationManifest) {
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(root, "manifest.json"), body, { mode: 0o600 });
  await writeFile(path.join(root, "manifest.sha256"), `${sha256(body)}  manifest.json\n`, { mode: 0o600 });
}

export async function verifyArchive(root: string) {
  const manifestBody = await readFile(path.join(root, "manifest.json"), "utf8");
  const checksum = await readFile(path.join(root, "manifest.sha256"), "utf8");
  if (!checksum.startsWith(sha256(manifestBody))) throw new Error("Manifest checksum mismatch");
  const manifest = JSON.parse(manifestBody) as MigrationManifest;
  for (const artifact of manifest.artifacts) {
    const body = await readFile(path.join(root, artifact.file), "utf8");
    if (sha256(body) !== artifact.sha256) throw new Error(`Artifact checksum mismatch: ${artifact.file}`);
  }
  return manifest;
}

export async function rebuildManifest(root: string, sourceTenant: string) {
  const artifacts: ArtifactManifest[] = [];
  const rawRoot = path.join(root, "raw");
  const entities = await readdir(rawRoot);
  for (const entity of entities) {
    const files = (await readdir(path.join(rawRoot, entity))).filter((file) => file.endsWith(".json")).sort();
    for (const fileName of files) {
      const body = await readFile(path.join(rawRoot, entity, fileName), "utf8");
      const payload = JSON.parse(body) as unknown;
      const page = Number.parseInt(fileName, 10);
      artifacts.push({ entity, page, offset: page * 200, recordCount: countRecords(payload), file: path.join("raw", entity, fileName), sha256: sha256(body) });
    }
  }
  const manifest: MigrationManifest = { formatVersion: 1, sourceSystem: "fineract", sourceTenant, extractedAt: new Date().toISOString(), artifacts };
  await writeManifest(root, manifest);
  return manifest;
}

function countRecords(payload: unknown) {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== "object") return 0;
  const record = payload as Record<string, unknown>;
  for (const key of ["pageItems", "content", "clients", "groups", "centers", "loanProducts", "savingsProducts", "charges"]) {
    if (Array.isArray(record[key])) return record[key].length;
  }
  return 1;
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}