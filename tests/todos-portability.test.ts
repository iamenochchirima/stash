import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers.js";
import { exportTodos, importTodos } from "../packages/core/src/todo-portability.js";
import { exportProjects, restoreProjects } from "../packages/core/src/projects-portability.js";
import { exportItemRecord, importPortableItem } from "../packages/core/src/items-portability.js";

test("Todo backups preserve relationships, pause reminders and import idempotently", async () => {
  const f = await fixture();
  try {
    const sourceAccount = await f.signup();
    const destination = await f.signup();
    const project = (await f.request("POST", "/api/projects", { name: "Reading project" }, sourceAccount.cookie)).json().project;
    const source = (await f.request("POST", "/api/items", { kind: "link", url: "https://example.test/portable-reading", title: "Portable source" }, sourceAccount.cookie)).json().item;
    const list = (await f.request("POST", "/api/todo-lists", { name: "Read next", projectId: project.id }, sourceAccount.cookie)).json().list;
    const task = (await f.request("POST", "/api/todos", {
      title: "Review the saved source", description: "Keep the useful context", projectId: project.id,
      listId: list.id, sourceIds: [source.id], plannedDate: "2026-11-21", timezone: "Africa/Johannesburg", requestId: randomUUID(),
    }, sourceAccount.cookie)).json().todo;
    await f.request("POST", `/api/todos/${task.id}/subtasks`, { title: "Check the references" }, sourceAccount.cookie);
    const current = (await f.request("GET", `/api/todos/${task.id}`, undefined, sourceAccount.cookie)).json().todo;
    const recurrence = await f.request("PUT", `/api/todos/${task.id}/recurrence`, {
      revision: current.revision, requestId: randomUUID(), rule: { frequency: "daily", interval: 2 },
      timezone: "Africa/Johannesburg", anchorDate: "2026-11-21", count: 3,
    }, sourceAccount.cookie);
    assert.equal(recurrence.statusCode, 200, recurrence.body);
    const completed = await f.request("POST", `/api/todos/${task.id}/complete`, {
      revision: recurrence.json().todo.revision, requestId: randomUUID(), subtasks: "parent_only",
    }, sourceAccount.cookie);
    assert.equal(completed.statusCode, 200, completed.body);
    const nextTask = (await f.request("GET", "/api/todos?view=all", undefined, sourceAccount.cookie)).json().items.find((row: any) => row.id !== task.id);
    const due = new Date(Date.now() + 60 * 60_000);
    const reminder = await f.request("POST", `/api/todos/${nextTask.id}/reminders`, {
      requestId: randomUUID(), scheduledAt: due.toISOString(), channels: ["in_app"],
    }, sourceAccount.cookie);
    assert.equal(reminder.statusCode, 200, reminder.body);

    const projects = await exportProjects(f.db, sourceAccount.user.id);
    await restoreProjects(f.db, destination.user.id, projects);
    const portableSource = await exportItemRecord(f.db, sourceAccount.user.id, source.id);
    await importPortableItem(f.db, destination.user.id, portableSource);
    const backup = await exportTodos(f.db, sourceAccount.user.id);
    assert.equal(backup.tasks.length, 2, "the current task and generated next occurrence are included");
    assert.equal(backup.recurrences[0].history.length, 2);
    assert.ok(backup.tasks.some((row) => row.sources.includes(source.id)));

    const first = await importTodos(f.db, destination.user.id, backup);
    assert.equal(first.saved, 2);
    assert.equal(first.restoredRemindersPaused, true);
    assert.equal(first.remindersRestored, 1);
    const restored = await f.request("GET", "/api/todos?view=all", undefined, destination.cookie);
    assert.equal(restored.json().total, 1, "only the open next occurrence appears in the all view");
    const next = restored.json().items[0];
    const detail = (await f.request("GET", `/api/todos/${next.id}`, undefined, destination.cookie)).json().todo;
    assert.equal(detail.title, "Review the saved source");
    assert.equal(detail.projectId !== project.id, true, "restored project gets a local identity");
    assert.equal(detail.sources.length, 1);
    assert.equal(detail.subtasks.length, 1);
    const reminderRows = await f.db.execute((await import("drizzle-orm")).sql`select status from todo_reminders where user_id=${destination.user.id}`);
    assert.equal(reminderRows.rows[0].status, "cancelled", "restored pending reminders cannot send old notifications");
    const preference = await f.request("GET", "/api/todo-preferences", undefined, destination.cookie);
    assert.equal(preference.json().preferences.emailReminders, false);

    const edited = await f.request("PATCH", `/api/todos/${next.id}`, { revision: detail.revision, title: "Keep my local wording" }, destination.cookie);
    assert.equal(edited.statusCode, 200, edited.body);
    const second = await importTodos(f.db, destination.user.id, backup);
    assert.equal(second.saved, 0);
    assert.equal(second.duplicates, 2);
    assert.equal((await f.request("GET", `/api/todos/${next.id}`, undefined, destination.cookie)).json().todo.title, "Keep my local wording");
  } finally {
    await f.close();
  }
});

test("Todo bundle validation rejects missing list and recurrence references", async () => {
  const { portableTodoBundle } = await import("../packages/shared/src/todo-portability.js");
  const id = () => randomUUID();
  const taskId = id(), listId = id(), recurrenceId = id();
  const validTask = {
    id: taskId, projectId: null, listId, recurrenceId, title: "Follow up", description: "", state: "open", priority: "normal",
    plannedDate: null, deadlineDate: null, deadlineAt: null, timezone: "UTC", completedAt: null, trashedAt: null,
    position: 0, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sources: [], subtasks: [],
  };
  const invalid = portableTodoBundle.safeParse({ timezone: "UTC", inAppReminders: true, lists: [], recurrences: [], tasks: [validTask], reminders: [] });
  assert.equal(invalid.success, false);
});
