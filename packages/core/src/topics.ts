import { and, eq, inArray, sql, asc } from "drizzle-orm";
import { collections, resourceCollections, users, type Database } from "@stash/db";
import { LIMITS, normalizeTopicName, displayTopicName } from "@stash/shared";
import { AppError } from "./index.js";

export async function validateOrganization(tx: Database, userId: string, ids: string[], kind: "collection" | "topic") {
  const unique = [...new Set(ids)];
  if (unique.length) {
    const owned = await tx.select({ id: collections.id }).from(collections).where(and(eq(collections.userId, userId), eq(collections.kind, kind), inArray(collections.id, unique)));
    if (owned.length !== unique.length) throw new AppError(404, kind === "topic" ? "Topic not found." : "Collection not found.");
  }
  return unique;
}
export async function setOrganizationMembership(tx: Database, userId: string, resourceId: string, ids: string[], kind: "collection" | "topic") {
  const unique = await validateOrganization(tx, userId, ids, kind);
  await tx.delete(resourceCollections).where(and(eq(resourceCollections.userId, userId), eq(resourceCollections.resourceId, resourceId), sql`${resourceCollections.collectionId} in (select id from collections where user_id=${userId} and kind=${kind})`));
  if (unique.length) {
    await tx.insert(resourceCollections).values(unique.map(collectionId => ({ userId, resourceId, collectionId })));
    await tx.update(users).set({ firstOrganizedAt: sql`coalesce(${users.firstOrganizedAt},now())` }).where(eq(users.id, userId));
  }
}
export function topicService(db: Database, userId: string) {
  const owner = (id: string) => and(eq(collections.userId, userId), eq(collections.kind, "topic"), eq(collections.id, id));
  const fields = { id: collections.id, name: collections.name, description: collections.description, createdAt: collections.createdAt, updatedAt: collections.updatedAt,
    itemCount: sql<number>`(select count(*)::int from resource_collections m join resources r on r.id=m.resource_id and r.user_id=m.user_id where m.user_id=${userId} and m.collection_id=collections.id and r.project_id is null and r.deleted_at is null and r.archived_at is null)` };
  async function active(tx: Database) {
    const [user] = await tx.select({ id: users.id, suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, userId)).for("update");
    if (!user || user.suspendedAt) throw new AppError(403, "This account is unavailable.");
  }
  async function get(id: string) {
    const [topic] = await db.select(fields).from(collections).where(owner(id));
    if (!topic) throw new AppError(404, "Topic not found.");
    return topic;
  }
  return {
    get,
    async list(input: { q?: string; limit?: number; offset?: number } = {}) {
      const filters = [eq(collections.userId, userId), eq(collections.kind, "topic")];
      if (input.q?.trim()) filters.push(sql`position(${normalizeTopicName(input.q)} in ${collections.normalizedName}) > 0`);
      return db.select(fields).from(collections).where(and(...filters)).orderBy(asc(collections.name), asc(collections.id)).limit(input.limit ?? 100).offset(input.offset ?? 0);
    },
    async ensure(input: { name: string; description?: string }) {
      const result = await db.transaction(async tx => {
        await active(tx);
        const normalizedName = normalizeTopicName(input.name), name = displayTopicName(input.name);
        const [existing] = await tx.select({ id: collections.id }).from(collections).where(and(eq(collections.userId, userId), eq(collections.kind, "topic"), eq(collections.normalizedName, normalizedName)));
        if (existing) return { id: existing.id, created: false };
        const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(collections).where(eq(collections.userId, userId));
        if (count.total >= LIMITS.collections) throw new AppError(409, "Your combined collection and topic limit has been reached.");
        const [topic] = await tx.insert(collections).values({ userId, kind: "topic", name, normalizedName, description: input.description || "" }).onConflictDoNothing().returning({ id: collections.id });
        if (!topic) throw new AppError(409, "An existing collection already uses this name. Choose another topic name.");
        return { id: topic.id, created: true };
      });
      return { topic: await get(result.id), created: result.created };
    },
    async update(id: string, input: { name?: string; description?: string }) {
      await db.transaction(async tx => {
        await active(tx);
        const [existing] = await tx.select({ id: collections.id }).from(collections).where(owner(id));
        if (!existing) throw new AppError(404, "Topic not found.");
        if (input.name !== undefined) {
          const name = displayTopicName(input.name), key = normalizeTopicName(name);
          const conflicts = await tx.select({ id: collections.id }).from(collections).where(and(eq(collections.userId, userId), sql`(${collections.name}=${name} OR (${collections.kind}='topic' AND ${collections.normalizedName}=${key}))`, sql`${collections.id}<>${id}`));
          if (conflicts.length) throw new AppError(409, "You already have a topic or collection with this name.");
        }
        await tx.update(collections).set({ ...input, ...(input.name !== undefined ? { name: displayTopicName(input.name), normalizedName: normalizeTopicName(input.name) } : {}), updatedAt: new Date() }).where(owner(id));
      });
      return get(id);
    },
    async delete(id: string) {
      await db.transaction(async tx => { await active(tx); await tx.delete(collections).where(owner(id)); });
      return { deleted: true };
    },
  };
}
