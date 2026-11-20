import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";

export async function markTodoSourcesUnavailable(
  tx: Database,
  resources: Array<{ userId: string; resourceId: string }>,
) {
  if (!resources.length) return;
  const deleted = sql.join(
    resources.map(({ userId, resourceId }) => sql`(${userId}::uuid, ${resourceId}::uuid)`),
    sql`,`,
  );
  await tx.execute(sql`
    update todo_sources source
    set resource_id = null
    from (values ${deleted}) as removed(user_id, resource_id)
    where source.user_id = removed.user_id
      and source.resource_id = removed.resource_id
  `);
}
