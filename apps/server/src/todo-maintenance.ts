import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Database } from "@stash/db";

const BATCH_SIZE = 100;
const DAY = 86_400_000;

export async function maintainTodos(db: Database, now = new Date()) {
  const trashCutoff = new Date(now.getTime() - 30 * DAY);
  const terminalCutoff = new Date(now.getTime() - 90 * DAY);
  return db.transaction(async tx => {
    const purged = await tx.execute(sql`
      with candidates as materialized (
        select id, user_id, recurrence_id
        from todos
        where trashed_at < ${trashCutoff}
        order by trashed_at, id
        for update skip locked
        limit ${BATCH_SIZE}
      ), stopped as (
        update todo_recurrences r
        set active = false, current_todo_id = null, updated_at = ${now}
        where r.active and r.current_todo_id in (select id from candidates)
        returning r.id
      )
      delete from todos t using candidates c
      where t.id = c.id and t.user_id = c.user_id
      returning t.id
    `);

    const terminalReminders = await tx.execute(sql`
      with candidates as materialized (
        select id from todo_reminders
        where status in ('sent','failed','missed','cancelled','read','dismissed')
          and updated_at < ${terminalCutoff}
        order by updated_at, id
        for update skip locked
        limit ${BATCH_SIZE}
      )
      delete from todo_reminders r using candidates c where r.id = c.id
      returning r.id
    `);

    const requests = await tx.execute(sql`
      with candidates as materialized (
        select user_id, request_id from todo_requests
        where created_at < ${terminalCutoff}
        order by created_at, request_id
        for update skip locked
        limit ${BATCH_SIZE}
      )
      delete from todo_requests r using candidates c
      where r.user_id = c.user_id and r.request_id = c.request_id
      returning r.request_id
    `);

    const orphanedSeries = await tx.execute(sql`
      with candidates as materialized (
        select r.id from todo_recurrences r
        where not r.active
          and not exists (select 1 from todos t where t.recurrence_id = r.id and t.user_id = r.user_id)
          and not exists (select 1 from todo_occurrences o where o.recurrence_id = r.id and o.user_id = r.user_id)
        order by r.updated_at, r.id
        for update skip locked
        limit ${BATCH_SIZE}
      )
      delete from todo_recurrences r using candidates c where r.id = c.id
      returning r.id
    `);

    return {
      purged: purged.rowCount ?? 0,
      terminalReminders: terminalReminders.rowCount ?? 0,
      requests: requests.rowCount ?? 0,
      orphanedSeries: orphanedSeries.rowCount ?? 0,
    };
  });
}

export function registerTodoMaintenance(app: FastifyInstance, db: Database) {
  let running: Promise<void> | undefined;
  const run = () => {
    if (running) return;
    running = (async () => {
      for (let batch = 0; batch < 10; batch++) {
        const result = await maintainTodos(db);
        if (Object.values(result).every(count => count < BATCH_SIZE)) break;
      }
    })()
      .catch(() => app.log.warn({ event: "todo_maintenance_failed" }, "Todo retention maintenance will retry"))
      .finally(() => { running = undefined; });
  };
  app.addHook("onReady", async () => { run(); await running; });
  const timer = setInterval(run, 60 * 60_000);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); await running; });
}
