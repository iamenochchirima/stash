import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { fixture } from "./helpers.js";

test("Project and item lists follow edits, appends, moves and Trash activity without changing project revisions", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(), b = await f.signup();
    const create = async (name: string, cookie=a.cookie) => (await f.request("POST","/api/projects",{name},cookie)).json().project;
    const old = await create("Older project"), newer = await create("Newer project"), foreign = await create("Other account",b.cookie);
    const save = async (title: string, projectId?: string) => (await f.request("POST","/api/items",{kind:"note",title,body:"Initial research",projectId},a.cookie)).json().item;
    const first = await save("Older item",old.id), second = await save("Newer item",old.id);
    const mainFirst = await save("Older library item"), mainSecond = await save("Newer library item");
    await f.db.execute(sql`update resources set updated_at=now()-interval '5 days' where user_id=${a.user.id}`);
    await f.db.execute(sql`update projects set updated_at=case when id=${old.id} then now()-interval '10 days' else now()-interval '1 day' end where user_id=${a.user.id}`);
    assert.equal((await f.request("GET","/api/projects",undefined,a.cookie)).json().items[0].id,newer.id);
    const beforeForeign = (await f.request("GET",`/api/projects/${foreign.id}`,undefined,b.cookie)).json().project.updatedAt;
    const patch = await f.request("PATCH",`/api/items/${first.id}`,{revision:1,body:"Edited older research"},a.cookie);
    assert.equal(patch.statusCode,200,patch.body);
    const projects = (await f.request("GET","/api/projects",undefined,a.cookie)).json().items;
    assert.equal(projects[0].id,old.id);
    assert.equal(projects[0].revision,1);
    assert.equal((await f.request("GET",`/api/items?projectId=${old.id}`,undefined,a.cookie)).json().items[0].id,first.id);
    await f.request("PATCH",`/api/items/${mainFirst.id}`,{revision:1,body:"Updated library note"},a.cookie);
    assert.equal((await f.request("GET","/api/items",undefined,a.cookie)).json().items[0].id,mainFirst.id);
    await f.db.execute(sql`update projects set updated_at=now()-interval '10 days' where id=${old.id}`);
    const append = await f.request("POST",`/api/items/${second.id}/append`,{revision:1,requestId:crypto.randomUUID(),body:"Agent finding"},a.cookie);
    assert.equal(append.statusCode,200,append.body);
    assert.equal((await f.request("GET","/api/projects",undefined,a.cookie)).json().items[0].id,old.id);
    const move = await f.request("POST",`/api/items/${second.id}/move-project`,{revision:2,projectId:newer.id},a.cookie);
    assert.equal(move.statusCode,200,move.body);
    const movedProjects = (await f.request("GET","/api/projects",undefined,a.cookie)).json().items;
    assert.equal(movedProjects[0].id,newer.id);
    assert.ok(movedProjects.every((p:any)=>p.revision===1));
    await f.request("POST",`/api/items/${first.id}/lifecycle`,{action:"trash"},a.cookie);
    assert.equal((await f.request("GET","/api/projects",undefined,a.cookie)).json().items[0].id,old.id);
    const activity = (await f.request("GET",`/api/projects/${old.id}`,undefined,a.cookie)).json().project.updatedAt;
    await f.request("POST",`/api/items/${first.id}/lifecycle`,{action:"purge"},a.cookie);
    const afterPurge = (await f.request("GET",`/api/projects/${old.id}`,undefined,a.cookie)).json().project;
    assert.ok(new Date(afterPurge.updatedAt)>=new Date(activity));
    assert.equal(afterPurge.itemCount,0);
    assert.equal((await f.request("GET",`/api/projects/${foreign.id}`,undefined,b.cookie)).json().project.updatedAt,beforeForeign);
    assert.ok(mainSecond.id);
  } finally { await f.close(); }
});

test("Activity migration backfills existing research without resetting creation dates or project revisions", async () => {
  const f = await fixture();
  try {
    const a = await f.signup();
    const project=(await f.request("POST","/api/projects",{name:"Existing project"},a.cookie)).json().project;
    await f.request("POST","/api/items",{kind:"note",body:"Existing research",projectId:project.id},a.cookie);
    // Recreate the preceding schema state only inside this disposable fixture.
    await f.db.execute(sql`drop trigger resource_project_activity on resources`);
    await f.db.execute(sql`drop function record_project_activity()`);
    await f.db.execute(sql`drop index resource_owner_updated`);
    await f.db.execute(sql`drop index project_owner_updated`);
    await f.db.execute(sql`delete from stash_migrations where name='0024_project_activity.sql'`);
    await f.db.execute(sql`update projects set updated_at='2026-10-01T00:00:00Z' where id=${project.id}`);
    await f.db.execute(sql`update resources set updated_at='2026-10-10T00:00:00Z' where project_id=${project.id}`);
    await f.migrate();
    const result=(await f.request("GET",`/api/projects/${project.id}`,undefined,a.cookie)).json().project;
    assert.equal(new Date(result.updatedAt).toISOString(),"2026-10-10T00:00:00.000Z");
    assert.equal(result.createdAt,project.createdAt);
    assert.equal(result.revision,1);
  } finally { await f.close(); }
});

test("Todo changes update owning project activity and task moves touch both projects without revision bumps", async () => {
  const f = await fixture();
  try {
    const account = await f.signup();
    const first = (await f.request("POST", "/api/projects", { name: "First task project" }, account.cookie)).json().project;
    const second = (await f.request("POST", "/api/projects", { name: "Second task project" }, account.cookie)).json().project;
    const task = (await f.request("POST", "/api/todos", { title: "Project task", projectId: first.id, requestId: crypto.randomUUID() }, account.cookie)).json().todo;
    await f.db.execute(sql`update projects set updated_at=now()-interval '2 days' where user_id=${account.user.id}`);
    const baseline = (await f.request("GET", `/api/projects/${first.id}`, undefined, account.cookie)).json().project.updatedAt;
    const edited = await f.request("PATCH", `/api/todos/${task.id}`, { revision: task.revision, title: "Updated project task" }, account.cookie);
    assert.equal(edited.statusCode, 200, edited.body);
    const afterEdit = (await f.request("GET", `/api/projects/${first.id}`, undefined, account.cookie)).json().project;
    assert.ok(new Date(afterEdit.updatedAt) > new Date(baseline));
    assert.equal(afterEdit.revision, first.revision);

    await f.db.execute(sql`update projects set updated_at=now()-interval '2 days' where user_id=${account.user.id}`);
    const beforeFirst = (await f.request("GET", `/api/projects/${first.id}`, undefined, account.cookie)).json().project.updatedAt;
    const beforeSecond = (await f.request("GET", `/api/projects/${second.id}`, undefined, account.cookie)).json().project.updatedAt;
    const moved = await f.request("POST", `/api/todos/${task.id}/move`, { revision: edited.json().todo.revision, projectId: second.id, listId: null }, account.cookie);
    assert.equal(moved.statusCode, 200, moved.body);
    const afterFirst = (await f.request("GET", `/api/projects/${first.id}`, undefined, account.cookie)).json().project;
    const afterSecond = (await f.request("GET", `/api/projects/${second.id}`, undefined, account.cookie)).json().project;
    assert.ok(new Date(afterFirst.updatedAt) > new Date(beforeFirst));
    assert.ok(new Date(afterSecond.updatedAt) > new Date(beforeSecond));
    assert.equal(afterFirst.revision, first.revision);
    assert.equal(afterSecond.revision, second.revision);
  } finally { await f.close(); }
});
