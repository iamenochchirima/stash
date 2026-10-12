import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { normalizeUrl } from "@stash/core";
import { sql } from "drizzle-orm";
test("T07/T10/E04 strict isolation, many-to-many membership, and collection deletion", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(),
      b = await f.signup();
    const ca = (
        await f.request(
          "POST",
          "/api/collections",
          { name: "Research" },
          a.cookie,
        )
      ).json().item,
      cb = (
        await f.request(
          "POST",
          "/api/collections",
          { name: "Research" },
          b.cookie,
        )
      ).json().item;
    const inbox = (
      await f.request("GET", "/api/collections", undefined, a.cookie)
    )
      .json()
      .items.find((c: any) => c.name === "Inbox");
    const r = (
      await f.request(
        "POST",
        "/api/resources",
        {
          url: "https://example.test/shared",
          title: "Memory guide",
          notes: "private notes",
          tags: ["MEMORY"],
          collectionIds: [ca.id, inbox.id],
        },
        a.cookie,
      )
    ).json().item;
    assert.equal(r.collectionIds.length, 2);
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const response = await f.request(
        method,
        `/api/resources/${r.id}`,
        method === "PATCH" ? { title: "stolen" } : undefined,
        b.cookie,
      );
      assert.equal(response.statusCode, 404);
    }
    assert.equal(
      (
        await f.request("GET", "/api/resources?q=memory", undefined, b.cookie)
      ).json().total,
      0,
    );
    assert.equal(
      (
        await f.request(
          "PATCH",
          `/api/resources/${r.id}`,
          { collectionIds: [cb.id] },
          a.cookie,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.request(
          "POST",
          "/api/resources",
          {
            url: "https://example.test/foreign",
            title: "bad",
            collectionIds: [cb.id],
          },
          a.cookie,
        )
      ).statusCode,
      404,
    );
    for (const method of ["PATCH", "DELETE"])
      assert.equal(
        (
          await f.request(
            method,
            `/api/collections/${ca.id}`,
            method === "PATCH" ? { name: "bad" } : undefined,
            b.cookie,
          )
        ).statusCode,
        404,
      );
    assert.equal(
      (
        await f.request(
          "POST",
          "/api/resources",
          { url: r.url, title: "B independent" },
          b.cookie,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.request(
          "PATCH",
          `/api/collections/${ca.id}`,
          { name: "Agent memory" },
          a.cookie,
        )
      ).json().item.name,
      "Agent memory",
    );
    assert.equal(
      (await f.request("DELETE", `/api/collections/${ca.id}`, {}, a.cookie))
        .statusCode,
      200,
    );
    const preserved = (
      await f.request("GET", `/api/resources/${r.id}`, undefined, a.cookie)
    ).json().item;
    assert.deepEqual(preserved.collectionIds, [inbox.id]);
    assert.equal(preserved.notes, "private notes");
    await assert.rejects(
      f.db.execute(
        sql`insert into resource_collections(user_id,resource_id,collection_id) values(${a.user.id},${r.id},${cb.id})`,
      ),
    );
  } finally {
    await f.close();
  }
});
test("T11 normalization preserves meaningful URLs and concurrent duplicates preserve original content", async () => {
  assert.equal(
    normalizeUrl("https://EXAMPLE.test/a?utm_source=x&q=1#section"),
    "https://example.test/a?q=1#section",
  );
  assert.notEqual(
    normalizeUrl("https://example.test/a"),
    normalizeUrl("https://example.test/a/"),
  );
  assert.notEqual(
    normalizeUrl("https://example.test/a#one"),
    normalizeUrl("https://example.test/a#two"),
  );
  assert.notEqual(
    normalizeUrl("https://example.test/?b=2&a=1"),
    normalizeUrl("https://example.test/?a=1&b=2"),
  );
  const f = await fixture();
  try {
    const a = await f.signup();
    await f.request(
      "POST",
      "/api/resources",
      {
        url: "https://example.test/a?utm_source=x",
        title: "Original",
        notes: "keep me",
      },
      a.cookie,
    );
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        f.request(
          "POST",
          "/api/resources",
          {
            url: "https://example.test/a",
            title: "Overwrite",
            notes: "changed",
          },
          a.cookie,
        ),
      ),
    );
    for (const response of responses) {
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().duplicate, true);
      assert.equal(response.json().item.notes, "keep me");
    }
    assert.equal(
      (await f.request("GET", "/api/resources", undefined, a.cookie)).json()
        .total,
      1,
    );
  } finally {
    await f.close();
  }
});
test("T10/T12 search, tags, filters, counts, boundaries, invalid URLs, and reading status", async () => {
  const f = await fixture();
  try {
    const a = await f.signup();
    const collection = (
      await f.request("POST", "/api/collections", { name: "Topics" }, a.cookie)
    ).json().item;
    for (let i = 0; i < 5; i++)
      await f.request(
        "POST",
        "/api/resources",
        {
          url: `https://example.test/${i}`,
          title: `Agent resource ${i}`,
          notes: i === 2 ? "Quantum memory" : "Research",
          tags: ["DeepTag"],
          collectionIds: i < 3 ? [collection.id] : [],
          status: i === 2 ? "done" : "unread",
        },
        a.cookie,
      );
    const result = await f.request(
      "GET",
      `/api/resources?q=quantum&status=done&collectionId=${collection.id}`,
      undefined,
      a.cookie,
    );
    assert.equal(result.json().total, 1);
    assert.equal(result.json().items[0].status, "done");
    assert.equal(
      (
        await f.request("GET", "/api/resources?q=DEEPTAG", undefined, a.cookie)
      ).json().total,
      5,
    );
    assert.equal(
      (
        await f.request("GET", "/api/resources?q=absent", undefined, a.cookie)
      ).json().total,
      0,
    );
    const first = (
        await f.request("GET", "/api/resources?limit=2", undefined, a.cookie)
      ).json(),
      next = (
        await f.request(
          "GET",
          "/api/resources?limit=2&offset=2",
          undefined,
          a.cookie,
        )
      ).json();
    assert.equal(first.total, 5);
    assert.equal(first.items.length, 2);
    assert.notEqual(first.items[0].id, next.items[0].id);
    assert.equal(
      (await f.request("GET", "/api/resources?limit=1000", undefined, a.cookie))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await f.request(
          "POST",
          "/api/resources",
          { url: "javascript:alert(1)", title: "invalid" },
          a.cookie,
        )
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await f.request(
          "PATCH",
          `/api/resources/${first.items[0].id}`,
          { status: "reading" },
          a.cookie,
        )
      ).json().item.status,
      "reading",
    );
  } finally {
    await f.close();
  }
});
