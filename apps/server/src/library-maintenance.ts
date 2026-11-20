import { and, or, eq, inArray, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { resources, itemRequests, type Database } from "@stash/db";
import { markTodoSourcesUnavailable } from "@stash/core";
export async function maintainLibrary(db: Database, now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 86400_000);
  const result = await db.transaction(async tx => {
    const expired = await tx.select({ id: resources.id, userId: resources.userId }).from(resources)
      .where(lt(resources.deletedAt, cutoff)).limit(100).for("update", { skipLocked: true });
    if (expired.length) {
      await markTodoSourcesUnavailable(tx, expired.map(row => ({ userId: row.userId, resourceId: row.id })));
      await tx.delete(resources).where(and(inArray(resources.id, expired.map(r => r.id)), lt(resources.deletedAt, cutoff)));
    }
    const requests = await tx.select({ userId: itemRequests.userId, requestId: itemRequests.requestId }).from(itemRequests).where(lt(itemRequests.expiresAt, now)).limit(100);
    if (requests.length) await tx.delete(itemRequests).where(and(lt(itemRequests.expiresAt, now), or(...requests.map(request => and(eq(itemRequests.userId, request.userId), eq(itemRequests.requestId, request.requestId))))));
    return { purged: expired.length, expiredRequests: requests.length };
  });
  return result;
}
export function registerLibraryMaintenance(app: FastifyInstance, db: Database) {
  let running: Promise<void> | undefined;
  const run = () => {
    if (running) return;
    running = (async () => {
      for (let batch = 0; batch < 10; batch++) {
        const result = await maintainLibrary(db);
        if (result.purged < 100 && result.expiredRequests < 100) break;
      }
    })().catch(() => app.log.warn({ event: "library_maintenance_failed" }, "Library maintenance will retry")).finally(() => { running = undefined; });
  };
  app.addHook("onReady", async () => { run(); await running; });
  const timer = setInterval(run, 60 * 60_000); timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); await running; });
}
