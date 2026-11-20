import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fixture } from "./helpers.js";
import { createBackupExport, createJsonExport } from "../apps/server/src/backup-export.js";
import { openBackup } from "../apps/web/lib/backups/archive.js";
import { importItems, previewItemsImport } from "../packages/core/src/items-portability.js";
import { sql } from "drizzle-orm";

const collect = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const mime = "application/vnd.stash.backup+json";

test("v4 JSON and ZIP backups carry Todo data through their real restore paths", async () => {
  const f = await fixture();
  let archive: Awaited<ReturnType<typeof openBackup>> | undefined;
  try {
    const owner = await f.signup();
    const jsonTarget = await f.signup();
    const zipTarget = await f.signup();
    const project = (await f.request("POST", "/api/projects", { name: "Backup project" }, owner.cookie)).json().project;
    const list = (await f.request("POST", "/api/todo-lists", { name: "Read later", projectId: project.id }, owner.cookie)).json().list;
    const task = (await f.request("POST", "/api/todos", {
      title: "Review backup portability", description: "The task remains private", projectId: project.id,
      listId: list.id, plannedDate: "2026-11-21", timezone: "UTC", requestId: randomUUID(),
    }, owner.cookie)).json().todo;
    await f.request("POST", `/api/todos/${task.id}/subtasks`, { title: "Confirm the restore" }, owner.cookie);
    const due = new Date(Date.now() + 90 * 60_000);
    await f.request("POST", `/api/todos/${task.id}/reminders`, { requestId: randomUUID(), scheduledAt: due.toISOString(), channels: ["in_app"] }, owner.cookie);

    const jsonBytes = await collect((await createJsonExport(f.db, owner.user.id)).stream);
    const json = JSON.parse(jsonBytes.toString("utf8"));
    assert.equal(json.version, 4);
    assert.equal(json.todos.tasks.length, 1);
    assert.equal(json.todos.tasks[0].subtasks.length, 1);
    const preview = await previewItemsImport(f.db, jsonTarget.user.id, { format: "json", content: jsonBytes.toString("utf8") });
    assert.equal(preview.todosToCreate, 1);
    assert.equal(preview.todoListsToCreate, 1);
    assert.equal(preview.todosRemindersPaused, 1);
    const imported = await importItems(f.db, jsonTarget.user.id, { format: "json", content: jsonBytes.toString("utf8") });
    assert.equal(imported.todosSaved, 1);
    assert.equal(imported.todosRemindersPaused, 1);
    const jsonRows = await f.request("GET", "/api/todos?view=all", undefined, jsonTarget.cookie);
    assert.equal(jsonRows.json().items[0].title, task.title);
    const jsonLists = await f.request("GET", "/api/todo-lists", undefined, jsonTarget.cookie);
    assert.equal(jsonLists.json().items[0].name, "Read later");

    archive = await openBackup(new Blob([await collect((await createBackupExport(f.db, owner.user.id, undefined)).stream)]));
    assert.equal(archive.manifest.version, 4);
    assert.equal(archive.manifest.todos?.path, "todos.json");
    assert.equal((await archive.readTodos()).todos.tasks.length, 1);
    const ticket = (await f.request("POST", "/api/backups/restore", { manifestHash: digest(archive.manifestBytes) }, zipTarget.cookie)).json();
    const headers = { authorization: `Bearer ${ticket.token}`, "content-type": mime };
    const manifestResult = await f.request("POST", "/backup-transfers/restore/manifest", Buffer.from(archive.manifestBytes), undefined, headers);
    assert.equal(manifestResult.statusCode, 200, manifestResult.body);
    const data = await archive.readTodos();
    const damaged = Buffer.from(data.bytes); damaged[damaged.length - 1] ^= 1;
    const rejected = await f.request("POST", "/backup-transfers/restore/todos", damaged, undefined, headers);
    assert.equal(rejected.statusCode, 400, rejected.body);
    assert.equal((await f.request("GET", "/api/todos?view=all", undefined, zipTarget.cookie)).json().total, 0);
    const restored = await f.request("POST", "/backup-transfers/restore/todos", Buffer.from(data.bytes), undefined, headers);
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(restored.json().saved, 1);
    assert.equal(restored.json().restoredRemindersPaused, true);
    assert.equal((await f.request("POST", "/backup-transfers/restore/finish", {}, undefined, { authorization: headers.authorization })).statusCode, 200);
    const zipRows = await f.request("GET", "/api/todos?view=all", undefined, zipTarget.cookie);
    assert.equal(zipRows.json().items[0].title, task.title);
    const reminderRows = await f.db.execute(sql`select status from todo_reminders where user_id=${zipTarget.user.id}`);
    assert.equal(reminderRows.rows[0].status, "cancelled");
  } finally {
    await archive?.close();
    await f.close();
  }
});
