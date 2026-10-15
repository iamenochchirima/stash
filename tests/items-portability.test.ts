import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
test("JSON v2 preserves full mixed content and states; repeated imports preserve edits", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(), b = await f.signup();
    await f.request("POST", "/api/collections", { name: "Empty collection" }, a.cookie);
    const group = (await f.request("POST", "/api/collections", { name: "Ideas" }, a.cookie)).json().item;
    const idea = (await f.request("POST", "/api/items", { kind: "idea", body: "Complete context ".repeat(80), title: "An idea", collectionIds: [group.id] }, a.cookie)).json().item;
    await f.request("PATCH", `/api/items/${idea.id}`, { revision: 1, favourite: true }, a.cookie);
    await f.request("POST", `/api/items/${idea.id}/lifecycle`, { action: "archive" }, a.cookie);
    await f.request("POST", "/api/items", { kind: "link", url: "https://example.test/export", notes: "Link context" }, a.cookie);
    const exported = (await f.request("GET", "/api/items/export", undefined, a.cookie)).json();
    assert.equal(exported.version, 2); assert.equal(exported.items.length, 2);
    const exportedIdea = exported.items.find((i: any) => i.kind === "idea");
    assert.equal(exportedIdea.body, idea.body); assert.equal(exportedIdea.favourite, true); assert.ok(exportedIdea.archivedAt);
    assert.ok(!JSON.stringify(exported).includes("passwordHash")); assert.ok(!JSON.stringify(exported).includes("importOriginId"));
    exported.items[0].userId = a.user.id;
    const body = { format: "json", content: JSON.stringify(exported) };
    const preview = await f.request("POST", "/api/items/import/preview", body, b.cookie);
    assert.equal(preview.statusCode, 200, preview.body); assert.equal(preview.json().toSave, 2);
    const imported = await f.request("POST", "/api/items/import", body, b.cookie);
    assert.equal(imported.statusCode, 200, imported.body); assert.equal(imported.json().saved, 2);
    const after = (await f.request("GET", "/api/items?location=archive", undefined, b.cookie)).json().items[0];
    const full = (await f.request("GET", `/api/items/${after.id}`, undefined, b.cookie)).json().item;
    assert.equal(full.body, idea.body); assert.equal(full.favourite, true);
    await f.request("PATCH", `/api/items/${after.id}`, { revision: full.revision, body: "My newer imported edit" }, b.cookie);
    const repeated = await f.request("POST", "/api/items/import", body, b.cookie);
    assert.equal(repeated.json().duplicates, 2);
    assert.equal((await f.request("GET", `/api/items/${after.id}`, undefined, b.cookie)).json().item.body, "My newer imported edit");
    assert.ok((await f.request("GET", "/api/collections", undefined, b.cookie)).json().items.some((c: any) => c.name === "Empty collection"));
    assert.equal((await f.request("GET", `/api/items/${idea.id}`, undefined, b.cookie)).statusCode, 404);
  } finally { await f.close(); }
});
