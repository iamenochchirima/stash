import { fixture, BASE } from "../tests/helpers.js";
import { createApp } from "../apps/server/src/app.js";
import { createDeletionJournal } from "../apps/server/src/deletions.js";
import { openDatabase, users } from "@stash/db";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { sql } from "drizzle-orm";
const f = await fixture(),
  directory = resolve(".data/recovery-check"),
  journal = createDeletionJournal(`${directory}/deletions`);
await mkdir(directory, { recursive: true });
const pgBin = spawnSync("pg_config", ["--bindir"], {
  encoding: "utf8",
}).stdout.trim();
function command(binary: string, args: string[]) {
  const result = spawnSync(binary, args, { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`${binary} failed: ${result.stderr}`);
  return result.stdout;
}
let app = await createApp(f.db, { journal, mailer: { async send() {} } });
let child: ReturnType<typeof spawn> | undefined,
  connection: Awaited<ReturnType<typeof openDatabase>> | undefined;
const report: Record<string, unknown> = {};
try {
  const a = await f.signup("restart@example.test");
  await f.request("POST", "/api/auth/verify", {
    token: f.token("verify", a.email),
  });
  const collection = (
    await f.request("GET", "/api/collections", undefined, a.cookie)
  ).json().items[0];
  await f.request(
    "POST",
    "/api/resources",
    {
      url: "https://example.test/persist",
      title: "Persistent library",
      notes: "Restart proof",
      collectionIds: [collection.id],
    },
    a.cookie,
  );
  const key = (
    await f.request(
      "POST",
      "/api/keys",
      { name: "Persistent agent", scope: "write" },
      a.cookie,
    )
  ).json();
  const before = (await f.request("GET", "/api/me", undefined, a.cookie)).json()
    .user;
  const dump = resolve(directory, "backup.dump");
  command(`${pgBin}/pg_dump`, [
    "--dbname",
    BASE,
    "--schema",
    f.schema,
    "--format=custom",
    "--file",
    dump,
  ]);
  const deleted = await app.inject({
    method: "DELETE",
    url: "/api/me",
    headers: { origin: "http://127.0.0.1:3000", cookie: a.cookie },
    payload: {
      password: "correct horse battery staple",
      confirmation: "DELETE",
    },
  });
  if (deleted.statusCode !== 200) throw new Error(deleted.body);
  await app.close();
  await f.admin.query(`DROP SCHEMA ${f.schema} CASCADE`);
  command(`${pgBin}/pg_restore`, [
    "--dbname",
    BASE,
    "--no-owner",
    "--no-privileges",
    dump,
  ]);
  report.backupRestoresAccount = (await f.db.select().from(users)).length === 1;
  report.deletedAccountsPurged = await journal.apply(f.db);
  report.noResurrection = (await f.db.select().from(users)).length === 0;
  // Restore again only in this disposable schema to prove restart persistence before cleanup.
  await f.admin.query(`DROP SCHEMA ${f.schema} CASCADE`);
  command(`${pgBin}/pg_restore`, [
    "--dbname",
    BASE,
    "--no-owner",
    "--no-privileges",
    dump,
  ]);
  await f.app.close();
  await f.close(); // Drops original schema; create a restored disposable schema for the process check below.
  const admin = new pg.Pool({ connectionString: BASE });
  command(`${pgBin}/pg_restore`, [
    "--dbname",
    BASE,
    "--no-owner",
    "--no-privileges",
    dump,
  ]);
  await admin.end();
  const emptyJournal = resolve(directory, "empty-journal");
  child = spawn(process.execPath, ["apps/server/dist/index.js"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: f.url,
      WEB_ORIGIN: "https://stash.example",
      PUBLIC_API_URL: "https://api.stash.example",
      SMTP_URL: "smtp://127.0.0.1:9",
      MAIL_FROM: "Stash <hello@example.test>",
      DELETION_JOURNAL_DIR: emptyJournal,
      PORT: "4200",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout!.on("data", (b) => (logs += b.toString()));
  child.stderr!.on("data", (b) => (logs += b.toString()));
  const waitReady = async () => {
    for (let i = 0; i < 100; i++) {
      try {
        const response = await fetch("http://127.0.0.1:4200/ready");
        if (response.ok) return;
      } catch {}
      if (child?.exitCode !== null)
        throw new Error(`Production server exited: ${logs}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Readiness timeout: ${logs}`);
  };
  await waitReady();
  report.productionStartup = true;
  command(`${pgBin}/pg_ctl`, [
    "-D",
    resolve(".data/postgres"),
    "stop",
    "-m",
    "fast",
  ]);
  report.outageReadyStatus = (
    await fetch("http://127.0.0.1:4200/ready")
  ).status;
  command(`${pgBin}/pg_ctl`, [
    "-D",
    resolve(".data/postgres"),
    "-l",
    resolve(".data/postgres.log"),
    "-o",
    `-h 127.0.0.1 -p 55432 -k ${resolve(".data/pgsocket")}`,
    "start",
  ]);
  await waitReady();
  const me = (await (
    await fetch("http://127.0.0.1:4200/api/me", {
      headers: { cookie: a.cookie },
    })
  ).json()) as any;
  const library = (await (
    await fetch("http://127.0.0.1:4200/api/resources", {
      headers: { cookie: a.cookie },
    })
  ).json()) as any;
  const keys = (await (
    await fetch("http://127.0.0.1:4200/api/keys", {
      headers: { cookie: a.cookie },
    })
  ).json()) as any;
  report.profileAndOnboardingPersisted =
    JSON.stringify(me.user) === JSON.stringify(before);
  report.resourcesPersisted =
    library.items[0].notes === "Restart proof" &&
    library.items[0].collectionIds.includes(collection.id);
  report.credentialsPersisted = keys.items.some(
    (row: any) => row.id === key.id,
  );
  child.kill("SIGTERM");
  const [exit] = await once(child, "exit");
  report.gracefulShutdown = exit === 0;
  child = undefined;
  report.passed =
    report.backupRestoresAccount &&
    report.noResurrection &&
    report.productionStartup &&
    report.profileAndOnboardingPersisted &&
    report.resourcesPersisted &&
    report.credentialsPersisted &&
    report.outageReadyStatus === 503 &&
    report.gracefulShutdown;
  await writeFile(
    "docs/evidence/recovery.json",
    JSON.stringify(report, null, 2),
  );
  await writeFile("docs/evidence/production-smoke.txt", logs);
  console.log(report);
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  if (connection) await connection.close();
  const cleanup = new pg.Pool({ connectionString: BASE });
  await cleanup.query(`DROP SCHEMA IF EXISTS ${f.schema} CASCADE`);
  await cleanup.end();
  await rm(`${directory}/backup.dump`, { force: true });
}
