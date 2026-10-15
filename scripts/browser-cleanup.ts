import { readFile, writeFile, rm } from "node:fs/promises";
import pg from "pg";
import { BASE } from "../tests/helpers.js";
export default async function cleanup() {
  let schema: string;
  try {
    schema = JSON.parse(
      await readFile(".data/browser-schema.json", "utf8"),
    ).schema;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (
    !/^test_[a-f0-9]{32}$/.test(schema) ||
    !new URL(BASE).pathname.endsWith("_test")
  )
    throw new Error(
      "Refusing cleanup without a disposable schema in a test database.",
    );
  const pool = new pg.Pool({ connectionString: BASE });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    const result = await pool.query(
      "SELECT 1 FROM pg_namespace WHERE nspname=$1",
      [schema],
    );
    await writeFile(
      "docs/evidence/browser-cleanup.json",
      JSON.stringify(
        {
          schema,
          dropped: result.rows.length === 0,
          method:
            "Explicit Playwright global teardown; server signals also attempt cleanup",
          passed: result.rows.length === 0,
        },
        null,
        2,
      ),
    );
    if (result.rows.length)
      throw new Error("Browser verification schema was not removed.");
    await rm(`.data/verification-files/${schema}`, { recursive: true, force: true });
    await rm(".data/browser-schema.json", { force: true });
  } finally {
    await pool.end();
  }
}
