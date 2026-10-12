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
const app = await createApp(f.db, {
  origin: "http://127.0.0.1:3100",
  publicApiUrl: "http://127.0.0.1:4100",
  mailer: createMailer({
    directory: resolve(".data/verification-mail"),
    production: false,
  }),
});
await app.listen({ port: 4100, host: "127.0.0.1" });
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
