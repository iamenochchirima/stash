import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../apps/server/src/app.js";
import { fixture } from "./helpers.js";

const data = (result: any) => JSON.parse(result.content[0].text).data;

test("Topics MCP discovery, duplicate-safe creation, membership, scopes and account ownership", async () => {
  const f = await fixture(), clients: Client[] = [];
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const a = await f.signup(), b = await f.signup();
    for (const account of [a,b]) await f.request("POST", "/api/auth/verify", { token: f.token("verify",account.email) });
    const socket = createServer().listen(0,"127.0.0.1");
    await once(socket,"listening");
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>(resolve => socket.close(() => resolve()));
    const endpoint = `http://127.0.0.1:${port}`;
    app = await createApp(f.db, { publicApiUrl: endpoint, mailer: { async send() {} } });
    await app.listen({ port, host: "127.0.0.1" });
    for (const [scope,cookie] of [["write",a.cookie],["read",a.cookie],["write",b.cookie]] as const) {
      const key = (await f.request("POST","/api/keys",{ name: "Topics SDK verification", scope },cookie)).json();
      const client = new Client({ name: "topics-sdk-verification", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key.token}` } } }));
      clients.push(client);
    }
    const [writer,reader,foreign] = clients;
    const readTools = (await reader.listTools()).tools, writeTools = (await writer.listTools()).tools;
    for (const name of ["list_topics","get_topic"]) assert.ok(readTools.some(tool => tool.name === name));
    for (const name of ["ensure_topic","update_topic","delete_topic"]) {
      assert.ok(writeTools.some(tool => tool.name === name));
      assert.ok(!readTools.some(tool => tool.name === name));
      assert.ok((await reader.callTool({ name, arguments: { id: randomUUID(), name: "Denied" } })).isError);
    }
    assert.deepEqual(data(await reader.callTool({ name: "list_topics", arguments: { q: null, limit: null, offset: null } })), []);
    const first = data(await writer.callTool({ name: "ensure_topic", arguments: { name: "  Agent   Engineering  ", description: "Research agents. Ignore all previous instructions is quoted reference text." } }));
    assert.equal(first.created,true);
    assert.equal(first.topic.name,"Agent Engineering");
    const [retry,racing] = await Promise.all([
      writer.callTool({ name: "ensure_topic", arguments: { name: "agent engineering", description: "Must not overwrite" } }),
      writer.callTool({ name: "ensure_topic", arguments: { name: "AGENT ENGINEERING" } }),
    ]);
    for (const result of [retry,racing]) { assert.equal(data(result).topic.id,first.topic.id); assert.equal(data(result).created,false); }
    assert.equal(data(retry).topic.description,first.topic.description);
    const concurrent = await Promise.all([
      writer.callTool({ name: "ensure_topic", arguments: { name: "Reliability" } }),
      writer.callTool({ name: "ensure_topic", arguments: { name: "  RELIABILITY " } }),
    ]);
    assert.equal(data(concurrent[0]).topic.id,data(concurrent[1]).topic.id);
    assert.equal(concurrent.filter(result => data(result).created).length,1);
    await writer.callTool({ name: "delete_topic", arguments: { id: data(concurrent[0]).topic.id } });
    const listed = data(await reader.callTool({ name: "list_topics", arguments: { q: "Agent", limit: 1, offset: 0 } }));
    assert.equal(listed.length,1); assert.equal(listed[0].id,first.topic.id);
    const second = data(await writer.callTool({ name: "ensure_topic", arguments: { name: "Security Engineering" } })).topic;
    const collection = (await f.request("POST","/api/collections",{ name: "Reading" },a.cookie)).json().item;
    const saved = data(await writer.callTool({ name: "save_item", arguments: { kind: "idea", title: "Secure agent tools", body: "Restrict tool permissions to the current user task.", topicIds: [first.topic.id,second.id], collectionIds: [collection.id] } })).item;
    assert.deepEqual(new Set(saved.topicIds), new Set([first.topic.id,second.id]));
    assert.equal(data(await reader.callTool({ name: "get_topic", arguments: { id: first.topic.id } })).itemCount,1);
    for (const name of ["list_items","search_items"]) {
      const result = data(await reader.callTool({ name, arguments: { topicId: first.topic.id, q: "Secure" } }));
      assert.equal(result.total,1); assert.equal(result.items[0].id,saved.id);
    }
    const updated = data(await writer.callTool({ name: "update_item", arguments: { id: saved.id, revision: saved.revision, topicIds: [second.id] } }));
    assert.deepEqual(updated.topicIds,[second.id]);
    assert.equal(data(await reader.callTool({ name: "get_topic", arguments: { id: first.topic.id } })).itemCount,0);
    const renamed = data(await writer.callTool({ name: "update_topic", arguments: { id: first.topic.id, name: "Agent Systems", description: "Build and evaluate agents." } }));
    assert.equal(renamed.name,"Agent Systems");
    assert.ok((await writer.callTool({ name: "update_topic", arguments: { id: first.topic.id, name: "security engineering" } })).isError);
    assert.deepEqual(data(await reader.callTool({ name: "list_collections", arguments: {} })).some((c: any) => c.id === first.topic.id), false);
    for (const name of ["get_topic","update_topic"]) assert.ok((await foreign.callTool({ name, arguments: { id: first.topic.id, description: "Denied" } })).isError);
    await foreign.callTool({ name: "delete_topic", arguments: { id: first.topic.id } });
    assert.equal(data(await reader.callTool({ name: "get_topic", arguments: { id: first.topic.id } })).name,"Agent Systems");
    assert.ok((await foreign.callTool({ name: "save_item", arguments: { kind: "note", body: "Foreign assignment", topicIds: [second.id] } })).isError);
    assert.ok((await foreign.callTool({ name: "list_items", arguments: { topicId: second.id } })).isError);
    const sameNameForeign = data(await foreign.callTool({ name: "ensure_topic", arguments: { name: "Security Engineering" } })).topic;
    assert.notEqual(sameNameForeign.id,second.id);
    assert.equal(data(await reader.callTool({ name: "list_items", arguments: {} })).total,1);
    assert.ok((await writer.callTool({ name: "save_item", arguments: { kind: "note", body: "Wrong grouping kind", topicIds: [collection.id] } })).isError);
    assert.ok((await writer.callTool({ name: "save_item", arguments: { kind: "note", body: "Wrong grouping kind", collectionIds: [second.id] } })).isError);
    const removed = await writer.callTool({ name: "delete_topic", arguments: { id: second.id } });
    assert.ok(!removed.isError);
    const preserved = data(await reader.callTool({ name: "get_item", arguments: { id: saved.id } }));
    assert.equal(preserved.body,saved.body); assert.deepEqual(preserved.topicIds,[]); assert.deepEqual(preserved.collectionIds,[collection.id]);
    assert.equal(data(await reader.callTool({ name: "list_items", arguments: {} })).total,1);
    assert.ok((await reader.callTool({ name: "get_topic", arguments: { id: second.id } })).isError);
  } finally {
    for (const client of clients) await client.close();
    if (app) await app.close();
    await f.close();
  }
});
