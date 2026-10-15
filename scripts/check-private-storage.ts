import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { backblazeFileStore } from "../apps/server/src/file-store.js";
import { pdf } from "../tests/pdf-fixture.js";
// Run with private environment values. Never print SDK errors or request objects.
const options = { endpoint: process.env.B2_ENDPOINT!, region: process.env.B2_REGION!, bucket: process.env.B2_BUCKET!, keyId: process.env.B2_KEY_ID!, applicationKey: process.env.B2_APPLICATION_KEY! };
const key = `${randomUUID()}/${randomUUID()}.pdf`, content = pdf("Synthetic storage acceptance"), store = backblazeFileStore(options);
const evidence: Record<string, unknown> = { checkedAt: new Date().toISOString(), provider: "Backblaze B2", fixture: "Synthetic PDF only", reference: "https://www.backblaze.com/docs/cloud-storage-s3-compatible-api" };
let written = false;
try {
  await store.put(key, content); written = true; evidence.upload = true;
  evidence.downloadMatches = (await store.get(key)).equals(content);
  const unauthenticated = await fetch(`${options.endpoint}/${encodeURIComponent(options.bucket)}/${key}`, { signal: AbortSignal.timeout(10000), redirect: "error" });
  evidence.anonymousDownloadDenied = [401, 403].includes(unauthenticated.status);
  await unauthenticated.body?.cancel();
  await store.remove(key); written = false;
  try { await store.get(key); evidence.deleted = false; } catch (e) { evidence.deleted = (e as { name: string }).name === "NoSuchKey"; }
  evidence.passed = evidence.upload && evidence.downloadMatches && evidence.anonymousDownloadDenied && evidence.deleted;
} catch (e) { evidence.passed = false; evidence.errorType = (e as { name?: string }).name || "StorageCheckFailed"; }
finally { if (written) { try { await store.remove(key); evidence.cleanup = true; } catch { evidence.cleanup = "retry_required"; } } }
await writeFile("docs/evidence/library-v2/backblaze-transfer.json", JSON.stringify(evidence, null, 2)+"\n");
console.log(JSON.stringify(evidence));
if (!evidence.passed) process.exitCode = 1;
