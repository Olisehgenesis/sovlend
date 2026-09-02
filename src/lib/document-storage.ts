import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Local disk storage; production deployments must mount a writable volume (or swap in an S3 adapter) since the web container filesystem is read-only.
const STORAGE_DIR = path.join(process.cwd(), ".uploads", "documents");

export async function storeDocumentBytes(bytes: Buffer): Promise<string> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await mkdir(STORAGE_DIR, { recursive: true });
  await writeFile(path.join(STORAGE_DIR, sha256), bytes);
  return sha256;
}

export async function readDocumentBytes(objectKey: string): Promise<Buffer> {
  return readFile(path.join(STORAGE_DIR, objectKey));
}
