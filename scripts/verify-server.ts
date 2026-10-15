import { randomBytes } from "node:crypto";
import { inviteAdmin } from "../apps/server/src/admin-auth.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fixture } from "../tests/helpers.js";
import { createApp } from "../apps/server/src/app.js";
import { createMailer } from "../apps/server/src/mail.js";
const f = await fixture();
await mkdir(".data", { recursive: true });
await writeFile(
  ".data/browser-schema.json",
  JSON.stringify({ schema: f.schema }),
  { mode: 0o600 },
);
const adminOptions = {
  origin: "http://127.0.0.1:3101", encryptionKey: randomBytes(32).toString("base64"), production: false,
  mailer: createMailer({ directory: resolve(".data/verification-mail"), production: false }),
};
const app = await createApp(f.db, {
  requestRateLimit: 3000,
  adminOrigin: adminOptions.origin,
  adminEncryptionKey: adminOptions.encryptionKey,
  origin: "http://127.0.0.1:3100",
  publicApiUrl: "http://127.0.0.1:4100",
  mailer: createMailer({
    directory: resolve(".data/verification-mail"),
    production: false,
  }),
});
await app.listen({ port: 4100, host: "127.0.0.1" });
await inviteAdmin(f.db,adminOptions,{email:"owner@admin.example.test",name:"Stash owner",role:"owner",bootstrap:true});
console.log("Isolated Stash verification server ready on 4100.");
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await f.close();
    process.exit(0);
  });
