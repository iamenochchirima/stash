// Explicit hosted acceptance. Synthetic tasks and labelled Resend test recipients only.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect, type BrowserContext } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

if (process.env.STASH_HOSTED_ACCEPTANCE !== "true") throw Error("Explicit hosted acceptance flag required");
const web = "https://stash.kasitek.co.za", api = "https://api.stash.kasitek.co.za", headers = { origin: web };
const password = randomBytes(24).toString("base64url"), label = randomUUID().slice(0, 12);
const privateEnv = JSON.parse(execFileSync("railway", ["variable", "list", "--service", "stash-api", "--json"], { encoding: "utf8" }));
const browser = await chromium.launch(), contexts: BrowserContext[] = [], accounts: { context: BrowserContext; id: string }[] = [], clients: Client[] = [];
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), fixture: "Synthetic tasks and labelled Resend test recipients", runLabel: label, passed: false };
let stage = "signup";
async function json(response: any, status = 200) { assert.equal(response.status(), status, `HTTP ${response.status()} at ${new URL(response.url()).pathname}; expected ${status}`); return response.json(); }
async function signup(suffix: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
  const email = `delivered+stash-todo-${label}-${suffix}@resend.dev`;
  stage = "signup-create-account";
  const created = await json(await context.request.post(`${web}/api/auth/signup`, { headers, data: { name: "Todo acceptance", email, password } }), 201);
  accounts.push({ context, id: created.user.id });
  stage = "signup-send-verification";
  assert.equal(created.emailSent, true);
  let token: string | undefined;
  for (let attempt = 0; attempt < 15 && !token; attempt++) {
    stage = "signup-find-verification";
    const list = await fetch("https://api.resend.com/emails", { headers: { authorization: `Bearer ${privateEnv.RESEND_API_KEY}` } });
    assert.ok(list.ok);
    const messages = await list.json() as any;
    const match = messages.data?.find((m: any) => m.to?.includes(email) && m.subject === "Verify your Stash email");
    if (match) {
      const response = await fetch(`https://api.resend.com/emails/${match.id}`, { headers: { authorization: `Bearer ${privateEnv.RESEND_API_KEY}` } });
      assert.ok(response.ok);
      const mail = await response.json() as any;
      token = mail.text?.match(/[?&]verify=([A-Za-z0-9_-]+)/)?.[1];
    }
    if (!token) await new Promise(resolve => setTimeout(resolve, 1500));
  }
  stage = "signup-verify";
  assert.ok(token, "verification email was not available");
  await json(await context.request.post(`${web}/api/auth/verify`, { headers, data: { token } }));
  stage = "signup-login";
  await json(await context.request.post(`${web}/api/auth/login`, { headers, data: { email, password } }));
  return context;
}
async function connect(context: BrowserContext, scope: "read" | "write") {
  const key = await json(await context.request.post(`${web}/api/keys`, { headers, data: { name: `Hosted Todo acceptance ${scope}`, scope } }));
  const client = new Client({ name: "stash-todos-hosted-acceptance", version: "1" }); clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`${api}/mcp`), { requestInit: { headers: { authorization: `Bearer ${key.token}` } } }));
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown>) { return client.callTool({ name, arguments: args }); }
async function toolData(client: Client, name: string, args: Record<string, unknown>) {
  const result = await call(client, name, args); assert.notEqual(result.isError, true);
  return JSON.parse((result.content as any)[0].text).data;
}
try {
  const owner = await signup("owner"), other = await signup("other"), page = await owner.newPage();
  stage = "live-ui-desktop";
  await page.goto(`${web}/todos`);
  await expect(page.getByRole("heading", { name: "Todos", exact: true })).toBeVisible();
  await expect(page.getByLabel("New task", { exact: true })).toBeVisible();
  await page.getByLabel("New task", { exact: true }).fill("Hosted personal follow-up");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Hosted personal follow-up", { exact: true })).toBeVisible();
  const personal = (await json(await owner.request.get(`${web}/api/todos?view=all`, { headers }))).items.find((task: any) => task.title === "Hosted personal follow-up");
  assert.ok(personal);
  const project = (await json(await owner.request.post(`${web}/api/projects`, { headers, data: { name: "Hosted Todo acceptance" } }))).project;
  const projectTask = (await json(await owner.request.post(`${web}/api/todos`, { headers, data: { title: "Hosted project follow-up", projectId: project.id, requestId: randomUUID() } }))).todo;
  assert.equal((await json(await owner.request.get(`${web}/api/todos?view=all&projectId=${project.id}`, { headers }))).items.some((task: any) => task.id === projectTask.id), true);
  await page.goto(`${web}/projects/${project.id}?tab=tasks`);
  await expect(page.getByRole("button", { name: "Tasks", exact: true })).toHaveClass(/active/);
  await expect(page.getByText("Hosted project follow-up", { exact: true })).toBeVisible();
  report.personalAndProjectTasks = true;
  await page.setViewportSize({ width: 375, height: 1000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/evidence/todos/hosted-mobile.png" });
  report.mobileLayout = true;

  stage = "account-isolation";
  assert.equal((await json(await other.request.get(`${web}/api/todos?view=all`, { headers }))).items.length, 0);
  assert.equal((await other.request.get(`${web}/api/todos/${personal.id}`, { headers })).status(), 404);
  report.accountIsolation = true;

  stage = "mcp-discovery-and-scopes";
  const writer = await connect(owner, "write"), reader = await connect(owner, "read");
  const writerTools = (await writer.listTools()).tools, readerTools = (await reader.listTools()).tools;
  assert.ok(writerTools.some(tool => tool.name === "create_todo"));
  assert.ok(writerTools.some(tool => tool.name === "schedule_todo_reminder"));
  assert.ok(!readerTools.some(tool => tool.name === "create_todo"));
  const created = await toolData(writer, "create_todo", { title: "Hosted MCP follow-up", requestId: randomUUID() });
  const mcpTask = created.todo || created;
  const retrieved = await toolData(reader, "get_todo", { id: mcpTask.id });
  assert.equal((retrieved.todo || retrieved).title, "Hosted MCP follow-up");
  report.mcpDiscoveryAndScopes = true;
  report.mcpWrites = writerTools.filter(tool => tool.annotations?.readOnlyHint !== true).length;
  report.mcpReads = writerTools.filter(tool => tool.annotations?.readOnlyHint === true).length;

  stage = "native-codex-mcp-refresh";
  const nativeKey = await json(await owner.request.post(`${web}/api/keys`, { headers, data: { name: `Hosted native Codex acceptance ${label}`, scope: "write" } }));
  const nativeTitle = `Hosted Codex native ${label}`, nativeRequestId = randomUUID();
  const codexOutput = execFileSync("codex", [
    "-c", `mcp_servers.stash_acceptance.url="${api}/mcp"`,
    "-c", 'mcp_servers.stash_acceptance.bearer_token_env_var="STASH_TODO_NATIVE_ACCEPTANCE_KEY"',
    "exec", "--json", "--ephemeral", "--approve-for-me", "-m", "gpt-6.2-sol", "--skip-git-repo-check",
    `Use the Stash MCP tool create_todo to add one personal task with title ${JSON.stringify(nativeTitle)}, empty description, null projectId and listId, normal priority, null plannedDate, null deadlineDate, null deadlineAt, no sourceIds, and requestId ${nativeRequestId}. Do not use shell or other tools. After the tool succeeds, reply only with CREATED.`,
  ], { encoding: "utf8", timeout: 180_000, env: { ...process.env, STASH_TODO_NATIVE_ACCEPTANCE_KEY: nativeKey.token } });
  assert.match(codexOutput, /"text":"CREATED"/);
  const nativeTask = (await json(await owner.request.get(`${web}/api/todos?view=all`, { headers }))).items.find((task: any) => task.title === nativeTitle);
  assert.ok(nativeTask, "Codex native MCP tool call did not create the expected task");
  report.nativeCodexMcpRefresh = true;

  stage = "recurrence";
  const recurring = (await json(await owner.request.post(`${web}/api/todos`, { headers, data: { title: "Hosted recurring follow-up", requestId: randomUUID() } }))).todo;
  const today = new Date().toISOString().slice(0, 10);
  await json(await owner.request.put(`${web}/api/todos/${recurring.id}/recurrence`, { headers, data: { revision: recurring.revision, requestId: randomUUID(), rule: { frequency: "daily", interval: 1 }, timezone: "UTC", anchorDate: today, count: 2 } }));
  const current = (await json(await owner.request.get(`${web}/api/todos/${recurring.id}`, { headers }))).todo;
  await json(await owner.request.post(`${web}/api/todos/${recurring.id}/complete`, { headers, data: { revision: current.revision, requestId: randomUUID() } }));
  const recurrenceState=(await json(await owner.request.get(`${web}/api/todos/${recurring.id}/recurrence`, { headers }))).recurrence;
  assert.equal(recurrenceState.completedCount, 1);
  assert.equal(recurrenceState.history.filter((occurrence: any) => occurrence.completedAt !== null).length, 1);
  report.recurrenceCompletion = true;

  stage = "real-in-app-reminder";
  await json(await owner.request.put(`${web}/api/todo-preferences`, { headers, data: { timezone: "UTC", emailReminders: true } }));
  const preferences = await owner.request.get(`${web}/api/todo-preferences`, { headers });
  const pref = (await json(preferences)).preferences;
  assert.equal(pref.remindersEnabled, true, "hosted reminder gate must be deliberately enabled for this acceptance");
  const reminderTask = (await json(await owner.request.post(`${web}/api/todos`, { headers, data: { title: "Hosted reminder follow-up", requestId: randomUUID() } }))).todo;
  const scheduledAt = new Date(Date.now() + 70_000).toISOString();
  const scheduled = await json(await owner.request.post(`${web}/api/todos/${reminderTask.id}/reminders`, { headers, data: { requestId: randomUUID(), scheduledAt, channels: ["in_app", "email"] } }));
  const inAppReminderId = scheduled.reminders.find((reminder: any) => reminder.channel === "in_app").id;
  const emailReminderId = scheduled.reminders.find((reminder: any) => reminder.channel === "email").id;
  let delivered = false;
  for (let attempt = 0; attempt < 90 && !delivered; attempt++) {
    const inbox = await json(await owner.request.get(`${web}/api/todo-reminders?unreadOnly=true`, { headers }));
    delivered = inbox.items.some((item: any) => item.id === inAppReminderId && item.status === "sent");
    if (!delivered) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert.equal(delivered, true, "hosted worker did not persist the in-app reminder");
  report.reminderPersisted = true;
  let emailDelivered = false;
  for (let attempt = 0; attempt < 90 && !emailDelivered; attempt++) {
    const list = await fetch("https://api.resend.com/emails", { headers: { authorization: `Bearer ${privateEnv.RESEND_API_KEY}` } });
    assert.ok(list.ok);
    const messages = await list.json() as any;
    const match = messages.data?.find((message: any) => message.to?.includes(`delivered+stash-todo-${label}-owner@resend.dev`) && message.subject === "A Stash task reminder");
    if (match) {
      const response = await fetch(`https://api.resend.com/emails/${match.id}`, { headers: { authorization: `Bearer ${privateEnv.RESEND_API_KEY}` } });
      assert.ok(response.ok);
      const mail = await response.json() as any;
      emailDelivered = mail.last_event === "delivered";
      if (emailDelivered) report.emailProviderEvent = mail.last_event;
    }
    if (!emailDelivered) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  assert.equal(emailDelivered, true, "Resend did not confirm delivery of the opted-in email reminder");
  report.emailReminderDelivered = true;
  report.reminderChannels = ["in_app", "email"];

  stage = "cleanup";
  report.passed = true;
} catch (error) {
  report.failedAt = stage;
  report.failure = error instanceof Error ? error.message.replace(/delivered\+[^\s@]+@resend\.dev/g, "[test recipient]").replace(/https?:\/\/\S+/g, "[URL]").slice(0, 180) : "Unknown acceptance failure.";
  process.exitCode = 1;
} finally {
  for (const client of clients) await client.close().catch(() => {});
  const deleted: boolean[] = [], cleanupStatuses: number[] = [];
  for (const account of accounts) {
    try { const response=await account.context.request.delete(`${web}/api/me`, { headers, data: { password, confirmation: "DELETE" } });cleanupStatuses.push(response.status());deleted.push(response.status() === 200); }
    catch { cleanupStatuses.push(0);deleted.push(false); }
  }
  report.disposableAccountsDeleted = deleted.length === accounts.length && deleted.every(Boolean);
  report.cleanupStatuses=cleanupStatuses;
  report.disposableAccountCount = accounts.length;
  if (!report.disposableAccountsDeleted) { report.passed = false;report.accountIdsForCleanup=accounts.filter((_,index)=>!deleted[index]).map(account=>account.id);process.exitCode = 1; }
  for (const context of contexts) await context.close();
  await browser.close();
  await mkdir("docs/evidence/todos", { recursive: true });
  await writeFile("docs/evidence/todos/hosted-acceptance.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
