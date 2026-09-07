import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Local disk storage; production deployments must mount a writable volume (or swap in an
// S3 adapter) since the web container filesystem is read-only. Mirrors src/lib/document-storage.ts
// but keeps export packages in their own directory since they can be much larger and are
// generated (not user-uploaded).
const STORAGE_DIR = path.join(process.cwd(), ".uploads", "loan-exports");

export async function storeExportBytes(bytes: Buffer): Promise<{ objectKey: string; sha256: string; byteSize: number }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(path.join(STORAGE_DIR, sha256), bytes);
  return { objectKey: sha256, sha256, byteSize: bytes.byteLength };
}

export async function readExportBytes(objectKey: string): Promise<Buffer> {
  return readFile(path.join(STORAGE_DIR, objectKey));
}
