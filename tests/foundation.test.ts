import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { openDatabase } from "@stash/db";
import { BASE, fixture } from "./helpers.js";
import { config } from "../apps/server/src/config.js";
import { createApp } from "../apps/server/src/app.js";
import { createMailer } from "../apps/server/src/mail.js";
import net from "node:net";
import { once } from "node:events";
test("T02/T03 versioned migrations upgrade legacy data, repeat safely, and survive reconnection", async () => {
  const admin = new pg.Pool({ connectionString: BASE }),
    schema = `upgrade_${randomUUID().replaceAll("-", "")}`,
    url = new URL(BASE);
  url.searchParams.set("options", `-csearch_path=${schema}`);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const client = new pg.Pool({ connectionString: url.toString() });
  let connection: Awaited<ReturnType<typeof openDatabase>> | undefined;
  try {
    await client.query(
      await readFile(
        new URL("../packages/db/migrations/0001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    const u = await client.query(
      "INSERT INTO users(email,password_hash,name) VALUES('legacy@example.test','legacy','Legacy') RETURNING id",
    );
    const userId = u.rows[0].id;
    const c = await client.query(
      "INSERT INTO collections(user_id,name) VALUES($1,'Old collection') RETURNING id",
      [userId],
    );
    await client.query(
      "INSERT INTO resources(user_id,url,title,notes,collection_id) VALUES($1,'https://example.test/legacy','Legacy title','Preserved notes',$2)",
      [userId, c.rows[0].id],
    );
    connection = await openDatabase({ url: url.toString(), migrate: true });
    await connection.migrate();
    assert.equal(
      Number(
        (await client.query("SELECT count(*) FROM stash_migrations")).rows[0]
          .count,
      ),
      4,
    );
    assert.equal(
      (await client.query("SELECT notes FROM resources")).rows[0].notes,
      "Preserved notes",
    );
    assert.equal(
      Number(
        (await client.query("SELECT count(*) FROM resource_collections"))
          .rows[0].count,
      ),
      1,
    );
    await connection.close();
    connection = await openDatabase({ url: url.toString() });
    assert.equal(
      (
        await connection.db.execute(
          (await import("drizzle-orm")).sql`SELECT name FROM users`,
        )
      ).rows[0].name,
      "Legacy",
    );
    await client.query(
      "UPDATE stash_migrations SET checksum='tampered' WHERE name='0001_initial.sql'",
    );
    await assert.rejects(connection.migrate(), /Applied migration changed/);
  } finally {
    if (connection) await connection.close();
    await client.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
test("T01/T19 configuration validation and production cookie flags", async () => {
  assert.throws(() => config({ NODE_ENV: "production" }), /HTTPS|requires/);
  assert.throws(() => config({ PORT: "0" }), /PORT/);
  assert.throws(
    () => config({ WEB_ORIGIN: "http://localhost/path" }),
    /origin/,
  );
  const productionEnv = { NODE_ENV: "production", WEB_ORIGIN: "https://stash.example", PUBLIC_API_URL: "https://api.stash.example", DATABASE_URL: "postgresql://localhost/stash", DELETION_JOURNAL_DIR: "/data/deletions" };
  assert.throws(() => config(productionEnv), /SMTP_URL/);
  assert.equal(config({ ...productionEnv, EMAIL_DISABLED: "true" }).emailDisabled, true);
  assert.equal(config({ ...productionEnv, RESEND_API_KEY: "test-key", MAIL_FROM: "Stash <noreply@example.test>" }).emailDisabled, false);
  assert.throws(() => config({ ...productionEnv, RESEND_API_KEY: "test-key" }), /MAIL_FROM/);
  const f = await fixture();
  const app = await createApp(f.db, {
    production: true,
    origin: "https://stash.example",
    publicApiUrl: "https://api.stash.example",
    mailer: { async send() {} },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      headers: { origin: "https://stash.example" },
      payload: {
        email: "prod@example.test",
        name: "Production",
        password: "correct horse battery staple",
      },
    });
    assert.equal(response.statusCode, 201);
    assert.match(response.headers["set-cookie"]!.toString(), /Secure/);
    assert.match(response.headers["set-cookie"]!.toString(), /HttpOnly/);
    assert.equal((await app.inject("/ready")).statusCode, 200);
  } finally {
    await app.close();
    await f.close();
  }
});
test("T04 SMTP boundary accepts an actual account email without sending outside localhost", async () => {
  let message = "",
    collecting = false,
    buffer = "";
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 localhost ESMTP\r\n");
    socket.on("data", (bytes) => {
      buffer += bytes.toString();
      if (collecting) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end >= 0) {
          message = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          collecting = false;
          socket.write("250 accepted\r\n");
        }
        return;
      }
      let end;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^EHLO|HELO/.test(line))
          socket.write("250-localhost\r\n250 8BITMIME\r\n");
        else if (/^DATA/.test(line)) {
          collecting = true;
          socket.write("354 send message\r\n");
        } else if (/^QUIT/.test(line)) socket.end("221 goodbye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as net.AddressInfo).port;
    await createMailer({
      smtpUrl: `smtp://127.0.0.1:${port}`,
      from: "Stash <hello@example.test>",
      directory: ".data/unused",
      production: true,
    }).send({
      to: "test@example.test",
      subject: "Verify your Stash email",
      text: "Verify your email: https://stash.example/?verify=test-token",
    });
    assert.match(message, /Subject: Verify your Stash email/);
    assert.match(message, /verify=test-token/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("T04 account survives email delivery failure and can request verification later", async () => {
  const f = await fixture();
  const app = await createApp(f.db, {
    mailer: {
      async send() {
        throw new Error("SMTP unavailable");
      },
    },
  });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      headers: { origin: "http://127.0.0.1:3000" },
      payload: {
        name: "Recoverable",
        email: "recoverable@example.test",
        password: "correct horse battery staple",
      },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().emailSent, false);
    const cookie = response.headers["set-cookie"]!.toString().split(";")[0];
    assert.equal(
      (await f.request("POST", "/api/auth/resend", {}, cookie)).statusCode,
      200,
    );
    assert.equal(f.mail.length, 1);
  } finally {
    await app.close();
    await f.close();
  }
});

test("T04 Resend delivers signup and recovery links and keeps provider errors private", async (t) => {
  const f = await fixture();
  const messages: any[] = [];
  let reject = false;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal((options.headers as Record<string, string>).Authorization, "Bearer test-resend-secret");
    assert.ok(options.signal);
    if (reject) return new Response("provider details: test-resend-secret", { status: 429 });
    messages.push(JSON.parse(options.body as string));
    return Response.json({ id: randomUUID() });
  });
  const mailer = createMailer({ resendApiKey: "test-resend-secret", from: "Stash <noreply@example.test>", directory: ".data/unused", production: true });
  const app = await createApp(f.db, { mailer });
  try {
    const signup = await app.inject({ method: "POST", url: "/api/auth/signup", headers: { origin: "http://127.0.0.1:3000" }, payload: { name: "Resend test", email: "resend@example.test", password: "Stash123" } });
    assert.equal(signup.statusCode, 201);
    assert.equal(signup.json().emailSent, true);
    assert.equal(messages[0].from, "Stash <noreply@example.test>");
    assert.deepEqual(messages[0].to, ["resend@example.test"]);
    assert.match(messages[0].text, /\?verify=/);
    const forgot = await app.inject({ method: "POST", url: "/api/auth/forgot", headers: { origin: "http://127.0.0.1:3000" }, payload: { email: "resend@example.test" } });
    assert.equal(forgot.statusCode, 200);
    assert.match(messages[1].text, /\?reset=/);
    reject = true;
    await assert.rejects(mailer.send({ to: "resend@example.test", subject: "Test", text: "Test" }), { message: "Email delivery failed." });
    const before = messages.length;
    await assert.rejects(createMailer({ ...{ resendApiKey: "test-resend-secret", from: "Stash <noreply@example.test>", directory: ".data/unused", production: true }, disabled: true }).send({ to: "resend@example.test", subject: "Test", text: "Test" }));
    assert.equal(messages.length, before);
  } finally {
    await app.close();
    await f.close();
  }
});
