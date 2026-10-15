import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { openDatabase } from "@stash/db";
import { library, items } from "@stash/core";
import { BASE } from "./helpers.js";
test("Library migration preserves populated pre-upgrade links and memberships", async () => {
  assert.ok(new URL(BASE).pathname.endsWith("_test"));
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: BASE });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(BASE); url.searchParams.set("options", `-csearch_path=${schema}`);
  const before = new pg.Pool({ connectionString: url.toString() });
  let migrated: Awaited<ReturnType<typeof openDatabase>> | undefined;
  try {
    await before.query("CREATE TABLE stash_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const directory = new URL("../packages/db/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter(n => n.endsWith(".sql") && n < "0007").sort()) {
      const content = await readFile(new URL(name, directory), "utf8");
      await before.query(content);
      await before.query("INSERT INTO stash_migrations(name,checksum) VALUES($1,$2)", [name, createHash("sha256").update(content).digest("hex")]);
    }
    const userId = randomUUID(), collectionId = randomUUID(), secondCollectionId = randomUUID(), itemId = randomUUID();
    await before.query("INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,$3,$4)", [userId, `${randomUUID()}@example.test`, "unusable-fixture-hash", "Migration fixture"]);
    await before.query("INSERT INTO collections(id,user_id,name) VALUES($1,$2,'Existing research')", [collectionId, userId]);
    await before.query("INSERT INTO resources(id,user_id,url,title,notes,tags,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)", [itemId, userId, "https://example.test/original#source", "Original research", "Existing private context", ["research"], new Date("2026-10-01T12:00:00Z")]);
    await before.query("INSERT INTO resource_collections(user_id,resource_id,collection_id) VALUES($1,$2,$3)", [userId, itemId, collectionId]);
    await before.query("INSERT INTO collections(id,user_id,name) VALUES($1,$2,'Second collection')", [secondCollectionId,userId]);
    await before.query(`INSERT INTO resources(id,user_id,url,title,notes,tags,status,created_at,updated_at)
      SELECT gen_random_uuid(),$1,'https://example.test/migration/'||n,'Legacy item '||n,'Searchable context '||n,ARRAY['legacy','batch'],
      (ARRAY['unread','reading','done'])[1+n%3], '2026-10-01T12:00:00Z'::timestamptz,'2026-10-02T12:00:00Z'::timestamptz FROM generate_series(1,10000) n`,[userId]);
    await before.query("INSERT INTO resource_collections(user_id,resource_id,collection_id) SELECT user_id,id,$2 FROM resources WHERE user_id=$1 AND url LIKE 'https://example.test/migration/%'",[userId,collectionId]);
    await before.query("INSERT INTO resource_collections(user_id,resource_id,collection_id) SELECT user_id,id,$2 FROM resources WHERE user_id=$1 AND url LIKE 'https://example.test/migration/%'",[userId,secondCollectionId]);
    await before.query("CREATE TEMP TABLE migration_expected AS SELECT * FROM resources WHERE user_id=$1",[userId]);
    const expected = (await before.query("SELECT id,url,title,notes,tags,status,created_at,updated_at FROM migration_expected ORDER BY id")).rows;
    migrated = await openDatabase({ url: url.toString(), migrate: true });
    const item = await items(migrated.db, userId).get(itemId);
    assert.equal(item.kind, "link"); assert.equal(item.revision, 1); assert.equal(item.body, "");
    assert.equal(item.url, "https://example.test/original#source"); assert.equal(item.notes, "Existing private context");
    assert.equal(item.createdAt.toISOString(), "2026-10-01T12:00:00.000Z"); assert.deepEqual(item.collectionIds, [collectionId]);
    assert.equal((await library(migrated.db, userId).get(itemId)).url, item.url);
    const actual = (await before.query("SELECT id,url,title,notes,tags,status,created_at,updated_at FROM resources WHERE user_id=$1 ORDER BY id",[userId])).rows;
    assert.deepEqual(actual, expected);
    assert.equal(Number((await before.query("SELECT count(*) FROM resource_collections WHERE user_id=$1",[userId])).rows[0].count),20001);
    assert.equal(Number((await before.query("SELECT count(*) FROM resources WHERE user_id=$1 AND kind='link' AND revision=1 AND body=''",[userId])).rows[0].count),10001);
    await migrated.migrate();
    assert.equal((await items(migrated.db, userId).get(itemId)).id, itemId);
  } finally { await migrated?.close(); await before.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
