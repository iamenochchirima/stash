import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { resources } from "@stash/db";
import { fixture } from "./helpers.js";

test("Mixed item capture, legacy link compatibility, retry identity and edit conflicts", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(), b = await f.signup();
    const requestId = randomUUID();
    const input = { kind: "idea", body: "# A better research workflow\nKeep the useful context.", requestId, tags: ["research"] };
    const responses = await Promise.all([f.request("POST", "/api/items", input, a.cookie), f.request("POST", "/api/items", input, a.cookie)]);
    for (const r of responses) assert.equal(r.statusCode, 200, r.body);
    const idea = responses[0].json().item;
    assert.equal(idea.url, null); assert.equal(idea.title, "A better research workflow");
    assert.equal(responses[1].json().item.id, idea.id);
    assert.equal((await f.request("POST", "/api/items", { ...input, body: "Different content" }, a.cookie)).statusCode, 409);
    const link = await f.request("POST", "/api/items", { kind: "link", url: "https://example.test/reading", title: "Reading guide", notes: "Keep my original context" }, a.cookie);
    assert.equal(link.statusCode, 200, link.body);
    const legacy = await f.request("GET", "/api/resources", undefined, a.cookie);
    assert.equal(legacy.json().total, 1);
    assert.equal(legacy.json().items[0].url, "https://example.test/reading");
    assert.equal((await f.request("GET", `/api/resources/${idea.id}`, undefined, a.cookie)).statusCode, 404);
    for (const method of ["GET", "PATCH"]) assert.equal((await f.request(method, `/api/items/${idea.id}`, method === "PATCH" ? { revision: 1, title: "Stolen" } : undefined, b.cookie)).statusCode, 404);
    assert.equal((await f.request("GET", "/api/items?q=context", undefined, b.cookie)).json().total, 0);
    const edits = await Promise.all([f.request("PATCH", `/api/items/${idea.id}`, { revision: 1, title: "First edit" }, a.cookie), f.request("PATCH", `/api/items/${idea.id}`, { revision: 1, title: "Second edit" }, a.cookie)]);
    assert.deepEqual(edits.map(r => r.statusCode).sort(), [200, 409]);
    const current = (await f.request("GET", `/api/items/${idea.id}`, undefined, a.cookie)).json().item;
    assert.equal(current.revision, 2);
    assert.equal((await f.request("PATCH", `/api/items/${idea.id}`, { revision: 2, status: "reading" }, a.cookie)).statusCode, 400);
    const duplicate = await f.request("POST", "/api/resources", { url: "https://example.test/reading", notes: "Overwrite attempt" }, a.cookie);
    assert.equal(duplicate.json().duplicate, true);
    assert.equal(duplicate.json().item.notes, "Keep my original context");
  } finally { await f.close(); }
});

test("Item archive, favourites, trash and restore preserve ownership and state", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(), b = await f.signup();
    const group = (await f.request("POST", "/api/collections", { name: "Ideas" }, a.cookie)).json().item;
    const saved = await f.request("POST", "/api/items", { kind: "note", title: "Full notes", body: "context ".repeat(200), collectionIds: [group.id] }, a.cookie);
    const item = saved.json().item;
    assert.equal((await f.request("GET", "/api/items", undefined, a.cookie)).json().items[0].body.length, 300);
    assert.equal((await f.request("GET", `/api/items/${item.id}`, undefined, a.cookie)).json().item.body.length, item.body.length);
    await f.request("PATCH", `/api/items/${item.id}`, { revision: 1, favourite: true }, a.cookie);
    const action = (type: string, cookie = a.cookie) => f.request("POST", `/api/items/${item.id}/lifecycle`, { action: type }, cookie);
    assert.equal((await action("archive", b.cookie)).statusCode, 404);
    assert.equal((await action("archive")).statusCode, 200);
    assert.equal((await f.request("GET", "/api/items", undefined, a.cookie)).json().total, 0);
    assert.equal((await f.request("GET", "/api/items?location=archive&favourite=true", undefined, a.cookie)).json().total, 1);
    assert.equal((await action("trash")).statusCode, 200);
    assert.equal((await f.request("GET", `/api/items/${item.id}`, undefined, a.cookie)).statusCode, 404);
    assert.equal((await f.request("GET", `/api/items/${item.id}?trash=true`, undefined, b.cookie)).statusCode, 404);
    assert.equal((await action("restore")).statusCode, 200);
    const restored = (await f.request("GET", `/api/items/${item.id}`, undefined, a.cookie)).json().item;
    assert.ok(restored.archivedAt); assert.ok(restored.favourite); assert.deepEqual(restored.collectionIds, [group.id]);
    assert.equal((await action("purge")).statusCode, 409);
    await action("trash");
    await f.db.update(resources).set({ deletedAt: new Date(Date.now() - 31 * 86400_000) }).where(eq(resources.id, item.id));
    assert.equal((await action("restore")).statusCode, 404);
    assert.equal((await f.request("GET", "/api/items?location=trash", undefined, a.cookie)).json().total, 0);
    assert.equal((await action("purge")).statusCode, 200);
    assert.equal((await f.request("GET", `/api/items/${item.id}?trash=true`, undefined, a.cookie)).statusCode, 404);
  } finally { await f.close(); }
});

test("Expired trash is really purged and restore cannot resurrect a purged item", async () => {
  const { maintainLibrary } = await import("../apps/server/src/library-maintenance.js");
  const f = await fixture();
  try {
    const a = await f.signup();
    const item = (await f.request("POST", "/api/items", { kind: "idea", body: "A recoverable idea" }, a.cookie)).json().item;
    await f.request("POST", `/api/items/${item.id}/lifecycle`, { action: "trash" }, a.cookie);
    const inside=(await f.request("POST","/api/items",{kind:"note",body:"Still inside the recovery window"},a.cookie)).json().item;
    await f.request("POST",`/api/items/${inside.id}/lifecycle`,{action:"trash"},a.cookie);
    await f.db.update(resources).set({deletedAt:new Date(Date.now()-30*86400_000+60000)}).where(eq(resources.id,inside.id));
    await f.db.update(resources).set({ deletedAt: new Date(Date.now() - 30 * 86400_000 - 60000) }).where(eq(resources.id, item.id));
    assert.equal((await maintainLibrary(f.db)).purged, 1);
    assert.equal((await maintainLibrary(f.db)).purged, 0);
    assert.equal((await f.request("POST", `/api/items/${item.id}/lifecycle`, { action: "restore" }, a.cookie)).statusCode, 404);
    assert.equal((await f.request("POST",`/api/items/${inside.id}/lifecycle`,{action:"restore"},a.cookie)).statusCode,200);
  } finally { await f.close(); }
});

test("Mixed item validation and feature gating preserve existing links", async () => {
  const { createApp } = await import("../apps/server/src/app.js");
  const f = await fixture(); let disabled: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    const user = await f.signup();
    for (const value of [{ kind: "idea", body: " " }, { kind: "note", body: "x".repeat(50001) }, { kind: "link", url: "javascript:bad" }, { kind: "link", url: "https://user:password@example.test" }])
      assert.equal((await f.request("POST", "/api/items", value, user.cookie)).statusCode, 400);
    disabled = await createApp(f.db, { itemsEnabled: false, mailer: { async send() {} } });
    const request = (method: "POST" | "GET", url: string, payload?: object) => disabled!.inject({ method, url, headers: { cookie: user.cookie, origin: "http://127.0.0.1:3000" }, ...(payload && { payload }) });
    assert.equal((await request("POST", "/api/items", { kind: "idea", body: "Not yet enabled" })).statusCode, 503);
    assert.equal((await request("POST", "/api/items", { kind: "link", url: "https://example.test/compatible", title: "Compatible link" })).statusCode, 200);
    assert.equal((await request("GET", "/api/items")).json().total, 1);
    assert.equal((await request("GET", "/api/resources")).json().items[0].url, "https://example.test/compatible");
  } finally { await disabled?.close(); await f.close(); }
});
