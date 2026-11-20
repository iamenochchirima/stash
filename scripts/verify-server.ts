import { verificationSummaryProvider } from "./verification-summary-provider.js";
import { randomBytes } from "node:crypto";
import { inviteAdmin } from "../apps/server/src/admin-auth.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { localFileStore } from "../apps/server/src/file-store.js";
import { fixture } from "../tests/helpers.js";
import { createApp } from "../apps/server/src/app.js";
import { createMailer } from "../apps/server/src/mail.js";
const f = await fixture();
const apiPort = Number(process.env.VERIFY_API_PORT ?? 4100);
const webPort = Number(process.env.VERIFY_WEB_PORT ?? 3100);
const adminPort = Number(process.env.VERIFY_ADMIN_PORT ?? 3101);
const schemaFile = `.data/browser-schema-${apiPort}.json`;
await mkdir(".data", { recursive: true });
await writeFile(
  schemaFile,
  JSON.stringify({ schema: f.schema }),
  { mode: 0o600 },
);
const adminOptions = {
  origin: `http://127.0.0.1:${adminPort}`, encryptionKey: randomBytes(32).toString("base64"), production: false,
  mailer: createMailer({ directory: resolve(".data/verification-mail"), production: false }),
};
const app = await createApp(f.db, {
  summaryProvider: verificationSummaryProvider,
  fileStore: localFileStore(resolve(`.data/verification-files/${f.schema}`)),
  requestRateLimit: 3000,
  adminOrigin: adminOptions.origin,
  adminEncryptionKey: adminOptions.encryptionKey,
  origin: `http://127.0.0.1:${webPort}`,
  publicApiUrl: `http://127.0.0.1:${apiPort}`,
  mailer: createMailer({
    directory: resolve(".data/verification-mail"),
    production: false,
  }),
});
await app.listen({ port: apiPort, host: "127.0.0.1" });
await inviteAdmin(f.db,adminOptions,{email:"owner@admin.example.test",name:"Stash owner",role:"owner",bootstrap:true});
console.log(`Isolated Stash verification server ready on ${apiPort}.`);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await f.close();
    process.exit(0);
  });
