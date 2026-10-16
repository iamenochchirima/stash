// Explicit release acceptance, restricted to synthetic accounts and research.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { request, type APIRequestContext } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
if (process.env.STASH_HOSTED_ACCEPTANCE !== "true") throw Error("Explicit hosted acceptance flag required");
const api = "https://api.stash.kasitek.co.za", origin = "https://stash.kasitek.co.za";
const password = randomBytes(24).toString("base64url"), label = randomUUID();
const privateEnv = JSON.parse(execFileSync("railway", ["variable", "list", "--service", "stash-api", "--json"], { encoding: "utf8" }));
const accounts: APIRequestContext[] = [], contexts: APIRequestContext[] = [], clients: Client[] = [];
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), passed: false };
let stage = "signup";
async function json(response: any, status = 200) { assert.equal(response.status(), status); return response.json(); }
async function signup(suffix: string) {
  const context = await request.newContext({ baseURL: api, extraHTTPHeaders: { origin } }); contexts.push(context);
  const email = `delivered+stash-mcp-${label}-${suffix}@resend.dev`;
  await json(await context.post("/api/auth/signup", { data: { name: "MCP acceptance", email, password } }), 201);
  accounts.push(context);
  let token: string | undefined;
  for (let attempt = 0; attempt < 15 && !token; attempt++) {
    const messages = await fetch("https://api.resend.com/emails", { headers: { authorization: `Bearer ${privateEnv.RESEND_API_KEY}` } });
    assert.ok(messages.ok);
    const list = await messages.json() as any;
    const match = list.data?.find((m: any) => m.to?.includes(email) && m.subject === "Verify your Stash email");
    if (match) {
      const response = await fetch(`https://api.resend.com/emails/${match.id}`, { headers: { authorization: `Bearer ${privateEnv.RESEND_API_KEY}` } });
      assert.ok(response.ok);
      const mail = await response.json() as any;
      token = mail.text?.match(/[?&]verify=([A-Za-z0-9_-]+)/)?.[1];
    }
    if (!token) await new Promise(r => setTimeout(r, 1500));
  }
  assert.ok(token);
  await json(await context.post("/api/auth/verify", { data: { token } }));
  return context;
}
async function connect(account: APIRequestContext, scope: "read" | "write") {
  const key = await json(await account.post("/api/keys", { data: { name: "Synthetic MCP acceptance", scope } }));
  const client = new Client({ name: "stash-project-acceptance", version: "1" }); clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`${api}/mcp`), { requestInit: { headers: { authorization: `Bearer ${key.token}` } } }));
  return client;
}
async function connectOAuth(account: APIRequestContext, write: boolean) {
  const registered = await json(await account.post("/oauth/register", { data: {
    client_name: "Synthetic MCP discovery acceptance",
    redirect_uris: ["https://client.example/callback"], token_endpoint_auth_method: "none",
  } }), 201);
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({ response_type: "code", client_id: registered.client_id,
    redirect_uri: "https://client.example/callback", resource: `${api}/mcp`,
    scope: write ? "stash:read stash:write" : "stash:read", state: randomUUID(),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  const start = await account.get(`/oauth/authorize?${params}`, { maxRedirects: 0 });
  assert.equal(start.status(), 302);
  const nonce = new URL(start.headers().location).searchParams.get("request");
  assert.ok(nonce);
  await json(await account.get(`/api/oauth/requests/${nonce}`));
  const consent = await json(await account.post(`/api/oauth/requests/${nonce}`, { data: { approve: true, write } }));
  const callback = new URL(consent.redirect);
  assert.equal(callback.searchParams.get("state"), params.get("state"));
  const token = await json(await account.post("/oauth/token", { form: {
    grant_type: "authorization_code", client_id: registered.client_id,
    redirect_uri: "https://client.example/callback", resource: `${api}/mcp`,
    code_verifier: verifier, code: callback.searchParams.get("code")!,
  } }));
  const client = new Client({ name: "stash-oauth-discovery-acceptance", version: "1" }); clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`${api}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token.access_token}` } } }));
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown>) { return client.callTool({ name, arguments: args }); }
async function ok(client: Client, name: string, args: Record<string, unknown>) {
  const result = await call(client, name, args); assert.ok(!result.isError);
  return JSON.parse((result.content as any)[0].text).data;
}
try {
  const account = await signup("owner"), other = await signup("other");
  const writer = await connect(account, "write"), reader = await connect(account, "read"), foreign = await connect(other, "write");
  stage = "discovery-and-scopes";
  const mutations = ["delete_project", "move_project_item", "promote_project_item", "restore_project_document", "purge_item"];
  const advertised = (await writer.listTools()).tools;
  const readOnly = (await reader.listTools()).tools;
  for (const tool of mutations) {
    assert.ok(advertised.some(t => t.name === tool));
    assert.ok(!readOnly.some(t => t.name === tool));
  }
  report.advertisedReads = advertised.filter(t => t.annotations?.readOnlyHint === true).length;
  report.advertisedWrites = advertised.filter(t => t.annotations?.readOnlyHint !== true).length;
  report.advertisedTools = advertised.map(t => t.name);
  report.discoveryAndScopes = true;
  stage = "oauth-discovery";
  const oauthWriter = await connectOAuth(account, true), oauthReader = await connectOAuth(account, false);
  const oauthTools = (await oauthWriter.listTools()).tools;
  const oauthReadTools = (await oauthReader.listTools()).tools;
  assert.deepEqual(oauthTools.map(t => t.name).sort(), advertised.map(t => t.name).sort());
  assert.deepEqual(oauthReadTools.map(t => t.name).sort(), readOnly.map(t => t.name).sort());
  report.oauthAdvertisedReads = oauthTools.filter(t => t.annotations?.readOnlyHint === true).length;
  report.oauthAdvertisedWrites = oauthTools.filter(t => t.annotations?.readOnlyHint !== true).length;
  report.oauthReadOnlyToolCount = oauthReadTools.length;
  report.oauthMatchesAgentKeyDiscovery = true;
  stage = "project-content-management";
  const project = await ok(writer, "create_project", { name: "Synthetic MCP source" });
  const target = await ok(writer, "create_project", { name: "Synthetic MCP destination" });
  const body = "Synthetic research. ".repeat(3500);
  const item = (await ok(writer, "save_item", { projectId: project.id, kind: "note", title: "Synthetic findings", body, requestId: randomUUID() })).item;
  const append = { id: item.id, revision: 1, requestId: randomUUID(), body: "A synthetic later finding." };
  await ok(writer, "append_project_document", append);
  await ok(writer, "append_project_document", append);
  const history = await ok(reader, "project_document_history", { id: item.id, revision: 1, offset: 30000 });
  assert.equal(history.body, body.slice(30000, 60000)); assert.equal(history.nextOffset, 60000);
  assert.ok((await call(foreign, "move_project_item", { id: item.id, revision: 2, projectId: target.id })).isError);
  assert.ok((await call(writer, "restore_project_document", { id: item.id, revision: 1, historicalRevision: 1 })).isError);
  const restored = await ok(writer, "restore_project_document", { id: item.id, revision: 2, historicalRevision: 1 });
  const moved = await ok(writer, "move_project_item", { id: item.id, revision: restored.revision, projectId: target.id });
  assert.equal(moved.projectId, target.id);
  const copy = (await ok(writer, "promote_project_item", { id: item.id, body: "Synthetic library excerpt", requestId: randomUUID() })).item;
  assert.equal(copy.projectSourceId, item.id);
  assert.equal((await ok(reader, "project_document_history", { id: item.id })).items.length, 2);
  report.moveHistoryRestorePromotionAndIsolation = true;
  stage = "guarded-deletion";
  assert.ok((await call(writer, "purge_item", { id: item.id, confirmation: "DELETE" })).isError);
  await ok(writer, "trash_item", { id: item.id });
  await ok(writer, "update_project", { id: target.id, revision: 1, archived: true });
  assert.ok((await call(writer, "delete_project", { id: target.id, revision: 2, confirmation: "DELETE" })).isError);
  await ok(writer, "update_project", { id: target.id, revision: 2, archived: false });
  await ok(writer, "purge_item", { id: item.id, confirmation: "DELETE" });
  assert.equal((await ok(reader, "get_item", { id: copy.id })).projectSourceId, null);
  await ok(writer, "update_project", { id: target.id, revision: 3, archived: true });
  await ok(writer, "delete_project", { id: target.id, revision: 4, confirmation: "DELETE" });
  assert.ok((await call(reader, "get_project", { id: target.id })).isError);
  report.guardedDeletionAndSurvivingLibraryCopy = true;
  report.passed = true;
} catch {
  report.failedStage = stage; process.exitCode = 1;
} finally {
  for (const client of clients) await client.close().catch(() => {});
  const removed = await Promise.all(accounts.map(async context => {
    try { return (await context.delete("/api/me", { data: { password, confirmation: "DELETE" } })).status() === 200; } catch { return false; }
  }));
  report.disposableAccountsDeleted = removed.length === accounts.length && removed.every(Boolean);
  if (!report.disposableAccountsDeleted) { report.passed = false; process.exitCode = 1; }
  for (const context of contexts) await context.dispose();
  await mkdir("docs/evidence/projects", { recursive: true });
  await writeFile("docs/evidence/projects/hosted-mcp-management.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
