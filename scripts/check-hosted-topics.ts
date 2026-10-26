// Explicit release acceptance using synthetic content and disposable verified accounts.
import { chromium, expect, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openBackup } from "../apps/web/lib/backups/archive.js";

if (process.env.STASH_HOSTED_ACCEPTANCE !== "true") throw Error("Explicit hosted acceptance flag required");
const web = "https://stash.kasitek.co.za", api = "https://api.stash.kasitek.co.za", headers = { origin: web };
const password = randomBytes(24).toString("base64url"), label = randomUUID().slice(0, 12);
const privateEnv = JSON.parse(execFileSync("railway", ["variable", "list", "--service", "stash-api", "--json"], { encoding: "utf8" }));
const browser = await chromium.launch(), contexts: BrowserContext[] = [], accounts: { context: BrowserContext; id: string }[] = [], clients: Client[] = [];
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), fixture: "Synthetic topics and labelled Resend test recipients", passed: false };
let stage = "signup";
async function json(response: any, status = 200) { if(response.status() !== status) { report.httpStatus = response.status(); report.expectedStatus = status; } expect(response.status()).toBe(status); return response.json(); }
async function signup(suffix: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); contexts.push(context);
  const localPart = `delivered+stash-topics-${label}-${suffix}`;
  if(localPart.length > 64) throw new Error("Synthetic recipient local part exceeds the email limit.");
  const email = `${localPart}@resend.dev`;
  stage = "signup-create";
  const created = await json(await context.request.post(`${web}/api/auth/signup`, { headers, data: { name: "Topic acceptance", email, password } }), 201);
  accounts.push({ context, id: created.user.id });
  stage = "signup-email-delivery";
  report.verificationEmailSent = created.emailSent === true;
  if (!created.emailSent) {
    stage = "signup-resend-verification";
    const resent = await context.request.post(`${web}/api/auth/resend`, { headers, data: {} });
    report.verificationResendStatus = resent.status();
    await json(resent);
  }
  let token: string | undefined;
  for (let attempt = 0; attempt < 15 && !token; attempt++) {
    stage = "signup-list-verification-emails";
    const messages = await fetch("https://api.resend.com/emails", { headers: { authorization: `Bearer ${privateEnv.RESEND_API_KEY}` } });
    if (!messages.ok) report.emailReadHttpStatus = messages.status;
    expect(messages.ok).toBe(true);
    const list = await messages.json() as any;
    const match = list.data?.find((m: any) => m.to?.includes(email) && m.subject === "Verify your Stash email");
    if (match) {
      stage = "signup-read-verification-email";
      const response = await fetch(`https://api.resend.com/emails/${match.id}`, { headers: { authorization: `Bearer ${privateEnv.RESEND_API_KEY}` } });
      if (!response.ok) report.emailReadHttpStatus = response.status;
      expect(response.ok).toBe(true);
      const mail = await response.json() as any;
      token = mail.text?.match(/[?&]verify=([A-Za-z0-9_-]+)/)?.[1];
    }
    if (!token) await new Promise(resolve => setTimeout(resolve, 1500));
  }
  stage = "signup-find-verification-token";
  expect(token).toBeTruthy();
  stage = "signup-verify";
  await json(await context.request.post(`${web}/api/auth/verify`, { headers, data: { token } }));
  return context;
}
async function connect(context: BrowserContext, scope: "read" | "write") {
  const key = await json(await context.request.post(`${web}/api/keys`, { headers, data: { name: "Synthetic Topics acceptance", scope } }));
  const client = new Client({ name: "stash-topics-acceptance", version: "1" }); clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`${api}/mcp`), { requestInit: { headers: { authorization: `Bearer ${key.token}` } } }));
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown>) { return client.callTool({ name, arguments: args }); }
async function ok(client: Client, name: string, args: Record<string, unknown>) {
  const result = await call(client, name, args); expect(result.isError).not.toBe(true);
  return JSON.parse((result.content as any)[0].text).data;
}
try {
  const owner = await signup("owner"), page = await owner.newPage();
  await mkdir("docs/evidence/topics", { recursive: true });
  stage = "empty-user-created-topics";
  expect((await json(await owner.request.get(`${web}/api/topics`))).items).toEqual([]);
  await page.goto(`${web}/topics`);
  await expect(page.getByRole("heading", { name: "No topics yet" })).toBeVisible();
  await page.getByRole("button", { name: "New topic", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Topic name", { exact: true }).fill("Field research");
  await dialog.getByLabel("Description", { exact: true }).fill("Observations and ideas from practical work.");
  await dialog.getByRole("button", { name: "Create topic", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Field research", exact: true })).toBeVisible();
  const topicId = new URL(page.url()).pathname.split("/").at(-1)!;
  stage = "picker-and-multiple-memberships";
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Type", { exact: true }).selectOption("idea");
  await dialog.getByLabel("Title", { exact: true }).fill("Investigate secure agents");
  await dialog.getByLabel("Content", { exact: true }).fill("Compare permissions needed by research tools.");
  await expect(dialog.getByRole("checkbox", { name: "Field research", exact: false })).toBeChecked();
  await dialog.getByLabel("Find topics").fill("Security research");
  await dialog.getByRole("button", { name: "Create topic “Security research”", exact: true }).click();
  await dialog.getByLabel("Topic description", { exact: true }).fill("Application and agent security.");
  await dialog.getByRole("button", { name: "Create and select topic", exact: true }).click();
  await dialog.getByRole("button", { name: "Save item", exact: true }).click();
  await expect(page.locator(".resource-card")).toHaveCount(1);
  const idea = (await json(await owner.request.get(`${web}/api/items?topicId=${topicId}`))).items[0];
  expect(idea.topicIds).toHaveLength(2);
  await page.getByRole("link", { name: "Investigate secure agents", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Item topics" }).getByRole("link")).toHaveCount(2);
  await page.getByRole("link", { name: "Back to library" }).click();
  await expect(page).toHaveURL(new RegExp(`/topics/${topicId}$`));
  report.userCreatedTopicsAndPicker = true;
  stage = "mcp-scopes-retry-and-save";
  const writer = await connect(owner, "write"), reader = await connect(owner, "read");
  for (const name of ["ensure_topic", "update_topic", "delete_topic"]) {
    expect((await writer.listTools()).tools.some(tool => tool.name === name)).toBe(true);
    expect((await reader.listTools()).tools.some(tool => tool.name === name)).toBe(false);
  }
  expect((await call(reader, "ensure_topic", { name: "Denied" })).isError).toBe(true);
  const existing = await ok(writer, "ensure_topic", { name: " FIELD   RESEARCH ", description: "Do not overwrite" });
  expect(existing.created).toBe(false); expect(existing.topic.id).toBe(topicId);
  expect(existing.topic.description).toBe("Observations and ideas from practical work.");
  const empty = await ok(writer, "ensure_topic", { name: "Future questions", description: "Empty topics survive export." });
  expect(empty.created).toBe(true);
  const collection = (await json(await owner.request.post(`${web}/api/collections`, { headers, data: { name: "Reading queue" } }))).item;
  const note = (await ok(writer, "save_item", { kind: "note", title: "Tool boundaries", body: "Restrict tools to the authorized task.", topicIds: idea.topicIds, collectionIds: [collection.id], requestId: randomUUID() })).item;
  expect((await ok(reader, "search_items", { topicId, q: "Tool boundaries" })).items[0].id).toBe(note.id);
  expect((await call(writer, "update_topic", { id: topicId, name: "security research" })).isError).toBe(true);
  report.mcpDiscoveryScopesRetryAndMemberships = true;
  stage = "desktop-mobile-topic-layout";
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`${web}/topics/${topicId}`);
    await expect(page.getByRole("heading", { name: "Field research", exact: true })).toBeVisible();
    await expect(page.locator(".resource-card")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `docs/evidence/topics/hosted-topic-${width}.png`, fullPage: true });
  }
  report.desktopMobileOverflowAndAccessibility = true;
  stage = "json-v3-roundtrip-and-account-isolation";
  const exported = await json(await owner.request.get(`${web}/api/items/export`));
  expect(exported.version).toBe(3); expect(exported.topics).toHaveLength(3);
  const other = await signup("restore");
  expect((await other.request.get(`${web}/api/topics/${topicId}`)).status()).toBe(404);
  const foreign = await connect(other, "write");
  expect((await call(foreign, "get_topic", { id: topicId })).isError).toBe(true);
  expect((await call(foreign, "save_item", { kind: "idea", body: "Denied foreign assignment", topicIds: [topicId] })).isError).toBe(true);
  const input = { format: "json", content: JSON.stringify(exported) };
  const imported = await json(await other.request.post(`${web}/api/items/import`, { headers, data: input }));
  expect(imported.saved).toBe(2); expect(imported.topicErrors).toEqual([]);
  const roundtrip = await json(await other.request.get(`${web}/api/items/export`));
  expect(roundtrip.topics).toEqual(exported.topics);
  for (const item of exported.items) expect(roundtrip.items.find((restored: any) => restored.title === item.title)?.topics.sort()).toEqual(item.topics.sort());
  report.jsonV3RoundtripEmptyTopicsAndIsolation = true;
  stage = "zip-v3-metadata";
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`${web}/library`);
  await page.getByRole("button", { name: "Import / export", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "Download full backup", exact: true }).click();
  const download = await pending; expect(await download.failure()).toBeNull();
  const archive = await openBackup(new Blob([await readFile((await download.path())!)]));
  try {
    expect(archive.manifest.version).toBe(3); expect(archive.manifest.topics).toEqual(exported.topics);
    expect(archive.manifest.items).toHaveLength(2);
    for (const ref of archive.manifest.items) {
      const record = await archive.readItem(ref.id);
      expect(record.item.topics.sort()).toEqual(exported.items.find((item: any) => item.title === record.item.title).topics.sort());
    }
  } finally { await archive.close(); }
  report.zipV3MetadataAndMemberships = true;
  stage = "topic-removal-preserves-items-and-collections";
  await ok(writer, "delete_topic", { id: topicId });
  const preserved = await ok(reader, "get_item", { id: note.id });
  expect(preserved.body).toBe(note.body); expect(preserved.collectionIds).toEqual([collection.id]);
  expect(preserved.topicIds).not.toContain(topicId); expect(preserved.topicIds).toHaveLength(1);
  expect((await json(await owner.request.get(`${web}/api/items`))).total).toBe(2);
  report.topicRemovalPreservesItemsAndCollections = true;
  report.passed = true;
} catch (error) {
  report.failedStage = stage; report.errorType = (error as Error).name; process.exitCode = 1;
} finally {
  for (const client of clients) await client.close().catch(() => {});
  const removed = await Promise.all(accounts.map(async ({ context }) => {
    try { return (await context.request.delete(`${web}/api/me`, { headers, data: { password, confirmation: "DELETE" } })).status() === 200; } catch { return false; }
  }));
  report.disposableAccountsDeleted = removed.length === accounts.length && removed.every(Boolean);
  report.accountIdsForCleanup = accounts.map(account => account.id);
  if (!report.disposableAccountsDeleted) { report.passed = false; process.exitCode = 1; }
  for (const context of contexts) await context.close();
  await browser.close();
  await mkdir("docs/evidence/topics", { recursive: true });
  await writeFile("docs/evidence/topics/hosted-topics.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
