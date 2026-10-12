import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { library } from "@stash/core";
import { resourceInput } from "@stash/shared";
test("T20/E06 preview, duplicate retry, rejection reporting, and collection-remapping round trip", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(),
      b = await f.signup();
    const ca = (
      await f.request(
        "POST",
        "/api/collections",
        { name: "Architecture" },
        a.cookie,
      )
    ).json().item;
    await f.request(
      "POST",
      "/api/resources",
      {
        url: "https://example.test/arch",
        title: "System design",
        notes: "Keep these notes",
        tags: ["design"],
        status: "reading",
        collectionIds: [ca.id],
      },
      a.cookie,
    );
    const exported = (
      await f.request("GET", "/api/export", undefined, a.cookie)
    ).json();
    assert.equal(exported.version, 1);
    assert.equal(exported.resources.length, 1);
    assert.ok(!JSON.stringify(exported).includes("passwordHash"));
    assert.ok(!JSON.stringify(exported).includes("stash_session"));
    const input = { format: "json", content: JSON.stringify(exported) };
    const preview = (
      await f.request("POST", "/api/import/preview", input, b.cookie)
    ).json();
    assert.equal(preview.toSave, 1);
    assert.equal(
      (await f.request("GET", "/api/resources", undefined, b.cookie)).json()
        .total,
      0,
    );
    const imported = (
      await f.request("POST", "/api/import", input, b.cookie)
    ).json();
    assert.equal(imported.saved, 1);
    const retry = (
      await f.request("POST", "/api/import", input, b.cookie)
    ).json();
    assert.equal(retry.saved, 0);
    assert.equal(retry.duplicates, 1);
    const restored = (
      await f.request("GET", "/api/export", undefined, b.cookie)
    ).json();
    assert.equal(restored.resources[0].notes, "Keep these notes");
    assert.equal(restored.resources[0].status, "reading");
    assert.deepEqual(restored.resources[0].tags,exported.resources[0].tags);
    assert.equal(restored.resources[0].createdAt,exported.resources[0].createdAt);
    assert.equal(restored.resources[0].updatedAt,exported.resources[0].updatedAt);
    assert.notEqual(restored.resources[0].id, exported.resources[0].id);
    assert.notEqual(restored.resources[0].collectionIds[0], ca.id);
    assert.equal(
      restored.collections.find(
        (c: any) => c.id === restored.resources[0].collectionIds[0],
      ).name,
      "Architecture",
    );
    const html = {
      format: "html",
      content:
        '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>Reading list</H3><DL><DT><A HREF="https://example.test/new">New article</A><DT><A HREF="javascript:alert(1)">Bad</A><DT><A HREF="https://example.test/arch">Duplicate</A></DL></DL>',
    };
    const hp = (
      await f.request("POST", "/api/import/preview", html, b.cookie)
    ).json();
    assert.equal(hp.toSave, 1);
    assert.equal(hp.duplicates, 1);
    assert.equal(hp.rejected.length, 1);
    const hi = (await f.request("POST", "/api/import", html, b.cookie)).json();
    assert.equal(hi.saved, 1);
    assert.equal(hi.rejected.length, 1);
    assert.equal(
      (
        await f.request(
          "POST",
          "/api/import/preview",
          { format: "json", content: "bad json" },
          b.cookie,
        )
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await f.request(
          "POST",
          "/api/import/preview",
          { format: "html", content: "a".repeat(1048577) },
          b.cookie,
        )
      ).statusCode,
      413,
    );
  } finally {
    await f.close();
  }
});
test("T07/T20 complete export beyond one page excludes secrets and ignores malicious ownership fields", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(),
      b = await f.signup(),
      service = library(f.db, a.user.id);
    for (let i = 0; i < 105; i++)
      await service.save(
        resourceInput.parse({
          url: `https://example.test/export/${i}`,
          title: `Resource ${i}`,
        }),
      );
    const data = (
      await f.request("GET", "/api/export", undefined, a.cookie)
    ).json();
    assert.equal(data.resources.length, 105);
    data.resources = [
      { ...data.resources[0], userId: a.user.id, id: a.user.id },
    ];
    const result = await f.request(
      "POST",
      "/api/import",
      { format: "json", content: JSON.stringify(data) },
      b.cookie,
    );
    assert.equal(result.json().saved, 1);
    assert.equal(
      (await f.request("GET", "/api/resources", undefined, a.cookie)).json()
        .total,
      105,
    );
    assert.equal(
      (await f.request("GET", "/api/resources", undefined, b.cookie)).json()
        .total,
      1,
    );
  } finally {
    await f.close();
  }
});
test("T20 empty collections survive an export/import round trip", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(),
      b = await f.signup();
    await f.request(
      "POST",
      "/api/collections",
      { name: "Empty project" },
      a.cookie,
    );
    const data = (
      await f.request("GET", "/api/export", undefined, a.cookie)
    ).json();
    const input = { format: "json", content: JSON.stringify(data) };
    assert.equal(
      (await f.request("POST", "/api/import/preview", input, b.cookie)).json()
        .collectionsToCreate,
      1,
    );
    assert.equal(
      (await f.request("POST", "/api/import", input, b.cookie)).statusCode,
      200,
    );
    assert.ok(
      (await f.request("GET", "/api/collections", undefined, b.cookie))
        .json()
        .items.some((c: any) => c.name === "Empty project"),
    );
  } finally {
    await f.close();
  }
});
test("T20 import reports original file indexes for post-validation failures", async () => {
  const f = await fixture();
  try {
    const a = await f.signup();
    for (let batch = 0; batch < 2; batch++)
      await f.db.execute(
        (await import("drizzle-orm"))
          .sql`insert into collections(user_id,name) select ${a.user.id},'Full ' || generate_series(${batch * 49 + 1}::integer,${batch * 49 + 49}::integer)`,
      );
    await f.request(
      "POST",
      "/api/collections",
      { name: "Final collection" },
      a.cookie,
    );
    const content = JSON.stringify({
      version: 1,
      collections: [{ id: "missing", name: "Beyond limit" }],
      resources: [
        { url: "javascript:invalid" },
        {
          url: "https://example.test/rejected",
          title: "Cannot organize",
          collectionIds: ["missing"],
        },
      ],
    });
    const response = (
      await f.request(
        "POST",
        "/api/import",
        { format: "json", content },
        a.cookie,
      )
    ).json();
    assert.deepEqual(response.rejected.map((r: any) => r.index).sort(), [1, 2]);
    assert.equal(response.saved, 0);
  } finally {
    await f.close();
  }
});
