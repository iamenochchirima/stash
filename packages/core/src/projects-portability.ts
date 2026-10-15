import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";
import { projectInput } from "@stash/shared";
import { z } from "zod";
import { AppError } from "./index.js";
export const portableProject = projectInput.extend({
  id: z.string().uuid(),
  archivedAt: z.string().datetime().nullable().default(null),
});
export async function exportProjects(db: Database, userId: string) {
  return (
    await db.execute(
      sql`select coalesce(import_origin_id,id) as id,name,description,repository_url as "repositoryUrl",archived_at as "archivedAt" from projects where user_id=${userId} order by created_at,id`,
    )
  ).rows.map((p: Record<string, unknown>) => ({
    ...p,
    archivedAt: p.archivedAt
      ? new Date(String(p.archivedAt)).toISOString()
      : null,
  }));
}
export async function restoreProjects(
  db: Database,
  userId: string,
  raw: unknown[],
) {
  const input = z.array(portableProject).max(100).parse(raw);
  return db.transaction(async (tx) => {
    const u = await tx.execute(
      sql`select id from users where id=${userId} and suspended_at is null for update`,
    );
    if (!u.rows.length) throw new AppError(403, "This account is unavailable.");
    const created: string[] = [];
    for (const p of input) {
      const known = await tx.execute(
        sql`select id from projects where user_id=${userId} and (id=${p.id} or import_origin_id=${p.id})`,
      );
      if (known.rows.length) continue;
      const count = await tx.execute(
        sql`select count(*)::int as n from projects where user_id=${userId}`,
      );
      if (Number(count.rows[0].n) >= 100)
        throw new AppError(409, "Your project limit has been reached.");
      await tx.execute(
        sql`insert into projects(user_id,import_origin_id,name,description,repository_url) values(${userId},${p.id},${p.name},${p.description},${p.repositoryUrl || null})`,
      );
      created.push(p.id);
    }
    return created;
  });
}
export async function resolveImportedProject(
  db: Database,
  userId: string,
  id: string | null | undefined,
) {
  if (!id) return null;
  const r = await db.execute(
    sql`select id from projects where user_id=${userId} and (id=${id} or import_origin_id=${id})`,
  );
  if (!r.rows.length)
    throw new AppError(
      400,
      "This item references a project missing from the import.",
    );
  return String(r.rows[0].id);
}
export async function finishProjectRestore(
  db: Database,
  userId: string,
  raw: unknown[],
  created: string[],
) {
  const input = z.array(portableProject).max(100).parse(raw);
  for (const p of input)
    if (p.archivedAt && created.includes(p.id))
      await db.execute(
        sql`update projects set archived_at=${new Date(p.archivedAt)} where user_id=${userId} and import_origin_id=${p.id} and revision=1 and archived_at is null`,
      );
}
