import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { createApp } from "../apps/server/src/app.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "node:net";
import { once } from "node:events";
async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as any).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
const data = (result: any) => JSON.parse(result.content[0].text).data;
test("T13/E03 MCP SDK lifecycle, scopes, errors, revocation, and persisted retrieval milestones", async () => {
  const f = await fixture();
  let server: any;
  const clients: Client[] = [];
  try {
    const a = await f.signup(),
      b = await f.signup();
    await f.request("POST", "/api/auth/verify", {
      token: f.token("verify", a.email),
    });
    const key = (
        await f.request(
          "POST",
          "/api/keys",
          { name: "Writer", scope: "write" },
          a.cookie,
        )
      ).json(),
      read = (
        await f.request(
          "POST",
          "/api/keys",
          { name: "Reader", scope: "read" },
          a.cookie,
        )
      ).json();
    const port = await freePort(),
      endpoint = `http://127.0.0.1:${port}`;
    server = await createApp(f.db, {
      publicApiUrl: endpoint,
      mailer: { async send() {} },
    });
    await server.listen({ port, host: "127.0.0.1" });
    async function connect(token: string) {
      const client = new Client({
        name: "stash-test-client",
        version: "1.0.0",
      });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      clients.push(client);
      return client;
    }
    const writer = await connect(key.token),
      reader = await connect(read.token);
    assert.ok(
      (await writer.listTools()).tools.some((t) => t.name === "save_resource"),
    );
    assert.ok(
      !(await reader.listTools()).tools.some((t) => t.name === "save_resource"),
    );
    const saved = data(
      await writer.callTool({
        name: "save_resource",
        arguments: {
          url: "https://example.test/mcp",
          title: "Protocol research",
          notes: "Saved by one agent",
        },
      }),
    ).item;
    assert.equal(
      data(
        await reader.callTool({
          name: "get_resource",
          arguments: { id: saved.id },
        }),
      ).notes,
      "Saved by one agent",
    );
    assert.equal(
      (
        await reader.callTool({
          name: "save_resource",
          arguments: { url: "https://example.test/denied", title: "bad" },
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await writer.callTool({
          name: "get_resource",
          arguments: { id: "not-an-id" },
        })
      ).isError,
      true,
    );
    const foreign = (
      await f.request(
        "POST",
        "/api/resources",
        { url: "https://example.test/foreign", title: "Foreign private" },
        b.cookie,
      )
    ).json().item;
    assert.equal(
      (
        await writer.callTool({
          name: "get_resource",
          arguments: { id: foreign.id },
        })
      ).isError,
      true,
    );
    const me = (await f.request("GET", "/api/me", undefined, a.cookie)).json()
      .user;
    assert.equal(me.onboarding.connected, true);
    assert.equal(me.onboarding.retrieved, true);
    assert.equal(
      (await f.request("DELETE", `/api/keys/${key.id}`, {}, b.cookie))
        .statusCode,
      404,
    );
    await f.request("DELETE", `/api/keys/${read.id}`, {}, a.cookie);
    await assert.rejects(reader.listTools());
    await assert.rejects(connect("invalid"));
    assert.equal(
      (
        await server.inject({
          method: "GET",
          url: "/mcp",
          headers: { host: `127.0.0.1:${port}` },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/mcp?x=1",
          headers: { host: "evil.test", authorization: `Bearer ${key.token}` },
          payload: {},
        })
      ).statusCode,
      403,
    );
    const removed = await writer.callTool({
      name: "delete_resource",
      arguments: { id: saved.id },
    });
    assert.equal(data(removed).deleted, true);
  } finally {
    for (const client of clients) await client.close();
    if (server) await server.close();
    await f.close();
  }
});

test("Mixed-item MCP sharing, editing conflicts, lifecycle and read-only boundaries", async () => {
  const f = await fixture(); let server: any; const clients: Client[] = [];
  try {
    const a = await f.signup(), b = await f.signup();
    await f.request("POST", "/api/auth/verify", { token: f.token("verify", a.email) });
    const tokens = [];
    for (const scope of ["write", "write", "read"]) tokens.push((await f.request("POST", "/api/keys", { name: `Agent ${tokens.length}`, scope }, a.cookie)).json().token);
    const port = await freePort(), endpoint = `http://127.0.0.1:${port}`;
    server = await createApp(f.db, { publicApiUrl: endpoint, mailer: { async send() {} } });
    await server.listen({ port, host: "127.0.0.1" });
    for (const token of tokens) {
      const client = new Client({ name: "items-test", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })); clients.push(client);
    }
    const [writer, other, reader] = clients;
    const tools = (await reader.listTools()).tools.map(t => t.name);
    assert.ok(tools.includes("get_item")); assert.ok(!tools.includes("update_item"));
    const idea = data(await writer.callTool({ name: "save_item", arguments: { kind: "idea", body: "A shared research idea", notes: "Original thought" } })).item;
    assert.equal(data(await other.callTool({ name: "get_item", arguments: { id: idea.id } })).body, "A shared research idea");
    const updated = data(await other.callTool({ name: "update_item", arguments: { id: idea.id, revision: idea.revision, body: "Developed across agents" } }));
    assert.equal(updated.body, "Developed across agents");
    assert.ok((await writer.callTool({ name: "update_item", arguments: { id: idea.id, revision: idea.revision, body: "Stale overwrite" } })).isError);
    assert.equal(data(await reader.callTool({ name: "search_items", arguments: { q: "developed" } })).total, 1);
    assert.equal(data(await reader.callTool({ name: "list_resources", arguments: {} })).total, 0);
    const foreign = (await f.request("POST", "/api/items", { kind: "note", body: "Private foreign account" }, b.cookie)).json().item;
    assert.ok((await reader.callTool({ name: "get_item", arguments: { id: foreign.id } })).isError);
    await writer.callTool({ name: "archive_item", arguments: { id: idea.id, archived: true } });
    assert.equal(data(await reader.callTool({ name: "list_items", arguments: {} })).total, 0);
    assert.equal(data(await reader.callTool({ name: "list_items", arguments: { location: "archive" } })).total, 1);
    await writer.callTool({ name: "trash_item", arguments: { id: idea.id } });
    assert.ok((await reader.callTool({ name: "get_item", arguments: { id: idea.id } })).isError);
    await writer.callTool({ name: "restore_item", arguments: { id: idea.id } });
    assert.equal(data(await reader.callTool({ name: "get_item", arguments: { id: idea.id } })).body, "Developed across agents");
    assert.ok((await reader.callTool({ name: "save_item", arguments: { kind: "note", body: "Not allowed" } })).isError);
  } finally { for (const client of clients) await client.close(); if (server) await server.close(); await f.close(); }
});
