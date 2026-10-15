import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectVersionsCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export interface FileStore {
  put(key: string, content: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
function validKey(key: string) {
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.pdf$/.test(key)) throw new Error("Invalid stored-file reference");
  return key;
}
export function localFileStore(directory: string): FileStore {
  const root = resolve(directory);
  const file = (key: string) => { const path = resolve(root, validKey(key)); if (!path.startsWith(root + sep)) throw new Error("Invalid stored-file reference"); return path; };
  return {
    async put(key, content) {
      if (content.length > MAX_PDF_BYTES) throw new Error("File exceeds storage limit");
      const path = file(key); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, content, { flag: "wx", mode: 0o600 });
    },
    async get(key) { const path = file(key); if ((await stat(path)).size > MAX_PDF_BYTES) throw new Error("File exceeds storage limit"); return readFile(path); },
    async remove(key) { await rm(file(key), { force: true }); },
  };
}
export function backblazeFileStore(options: { endpoint: string; region: string; bucket: string; keyId: string; applicationKey: string }): FileStore {
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== "https:" || !/^s3\.[a-z0-9-]+\.backblazeb2\.com$/.test(endpoint.hostname) || endpoint.pathname !== "/" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("B2_ENDPOINT must be the HTTPS Backblaze S3 endpoint");
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{1,61}[A-Za-z0-9]$/.test(options.bucket) || !options.region || !options.keyId || !options.applicationKey) throw new Error("Backblaze storage configuration is incomplete");
  const client = new S3Client({ endpoint: endpoint.origin, region: options.region, forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: options.keyId, secretAccessKey: options.applicationKey } });
  const sendOptions = () => ({ abortSignal: AbortSignal.timeout(30_000) });
  return {
    async put(key, content) {
      if (content.length > MAX_PDF_BYTES) throw new Error("File exceeds storage limit");
      await client.send(new PutObjectCommand({ Bucket: options.bucket, Key: validKey(key), Body: content, ContentType: "application/pdf" }), sendOptions());
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: options.bucket, Key: validKey(key) }), sendOptions());
      if (!result.Body || (result.ContentLength || 0) > MAX_PDF_BYTES) throw new Error("File exceeds storage limit");
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const part of result.Body as AsyncIterable<Uint8Array>) { size += part.length; if (size > MAX_PDF_BYTES) { (result.Body as { destroy?: () => void }).destroy?.(); throw new Error("File exceeds storage limit"); } chunks.push(part); }
      return Buffer.concat(chunks);
    },
    async remove(key) {
      validKey(key);
      // B2 retains object versions. Remove every version and delete marker, not just the visible name.
      for (let batch = 0; batch < 10; batch++) {
        const result = await client.send(new ListObjectVersionsCommand({ Bucket: options.bucket, Prefix: key, MaxKeys: 1000 }), sendOptions());
        const versions = [...result.Versions || [], ...result.DeleteMarkers || []].filter(v => v.Key === key && v.VersionId).map(v => ({ Key: key, VersionId: v.VersionId! }));
        if (!versions.length) return;
        const removed = await client.send(new DeleteObjectsCommand({ Bucket: options.bucket, Delete: { Objects: versions, Quiet: true } }), sendOptions());
        if (removed.Errors?.length) throw new Error("Stored-file deletion will retry");
      }
      throw new Error("Stored-file deletion has more versions to process");
    },
  };
}
