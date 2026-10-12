import pg from "pg";
import { randomUUID } from "node:crypto";
import { openDatabase } from "@stash/db";
import { createApp } from "../apps/server/src/app.js";
import type { Mail } from "../apps/server/src/mail.js";
export const BASE =
  process.env.TEST_DATABASE_URL || "postgresql://127.0.0.1:55432/stash_test";
export async function fixture() {
  const url = new URL(BASE);
  if (!url.pathname.endsWith("_test"))
    throw new Error("Test database name must end in _test.");
  const admin = new pg.Pool({ connectionString: BASE }),
    schema = `test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set("options", `-csearch_path=${schema}`);
  const connection = await openDatabase({ url: url.toString(), migrate: true });
  const mail: Mail[] = [];
  const app = await createApp(connection.db, {
    mailer: {
      async send(message) {
        mail.push(message);
      },
    },
  });
  await app.ready();
  const request = (
    method: any,
    path: string,
    body?: unknown,
    cookie?: string,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url: path,
      headers: {
        origin: "http://127.0.0.1:3000",
        ...(cookie && { cookie }),
        ...headers,
      },
      ...(body !== undefined && { payload: body as object }),
    });
  async function signup(email = `${randomUUID()}@example.test`) {
    const response = await request("POST", "/api/auth/signup", {
      email,
      name: "Test User",
      password: "correct horse battery staple",
    });
    if (response.statusCode !== 201) throw new Error(response.body);
    return {
      cookie: response.headers["set-cookie"]!.toString().split(";")[0],
      user: response.json().user,
      email,
    };
  }
  const token = (purpose: "verify" | "reset", email: string) =>
    new URL(
      mail
        .filter(
          (m) =>
            m.to === email &&
            m.subject
              .toLowerCase()
              .includes(purpose === "verify" ? "verify" : "reset"),
        )
        .at(-1)!
        .text.match(/https?:\/\/\S+/)![0],
    ).searchParams.get(purpose)!;
  return {
    ...connection,
    app,
    mail,
    request,
    signup,
    token,
    schema,
    url: url.toString(),
    admin,
    async close() {
      await app.close();
      await connection.close();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    },
  };
}
