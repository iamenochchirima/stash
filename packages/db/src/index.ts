import { readFile, readdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { drizzle as postgresDrizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema.js";
export * from "./schema.js";
export type Database = PgDatabase<any, typeof schema>;
export async function openDatabase(
  options: { url?: string; migrate?: boolean } = {},
) {
  const pool = new pg.Pool({
    connectionString:
      options.url ||
      process.env.DATABASE_URL ||
      "postgresql://127.0.0.1:55432/stash",
    max: 10,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", () => {
    console.error(
      "PostgreSQL connection interrupted; readiness checks will retry.",
    );
  });
  const db = postgresDrizzle(pool, { schema }) as Database;
  async function migrate() {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(78134921)");
      await client.query(
        "CREATE TABLE IF NOT EXISTS stash_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const applied = await client.query<{ name: string; checksum: string }>(
        "SELECT name, checksum FROM stash_migrations",
      );
      let directory = new URL("../migrations/", import.meta.url);
      try {
        await access(directory);
      } catch {
        directory = new URL("./migrations/", import.meta.url);
      }
      for (const name of (await readdir(directory))
        .filter((n) => n.endsWith(".sql"))
        .sort()) {
        const content = await readFile(new URL(name, directory), "utf8");
        const checksum = createHash("sha256").update(content).digest("hex");
        const previous = applied.rows.find((row) => row.name === name);
        if (previous) {
          if (previous.checksum !== checksum)
            throw new Error(`Applied migration changed: ${name}`);
          continue;
        }
        await client.query(content);
        await client.query(
          "INSERT INTO stash_migrations(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  if (options.migrate) {
    try {
      await migrate();
    } catch (error) {
      await pool.end();
      throw error;
    }
  }
  return { db, migrate, close: () => pool.end() };
}
