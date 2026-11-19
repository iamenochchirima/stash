import { and, eq, desc, sql, inArray, isNull } from "drizzle-orm";
import {
  resources,
  collections,
  resourceCollections,
  users,
  type Database,
} from "@stash/db";
import {
  LIMITS,
  type ResourceInput,
  type ResourceUpdate,
  type ListInput,
} from "@stash/shared";
import { setOrganizationMembership, validateOrganization } from "./topics.js";
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function normalizeUrl(value: string) {
  const url = new URL(value);
  // Preserve fragments: documentation anchors and hash-routed pages can be distinct resources.
  for (const key of [...url.searchParams.keys()])
    if (/^utm_/i.test(key) || ["fbclid", "gclid"].includes(key))
      url.searchParams.delete(key);
  // Preserve query ordering and non-root trailing slashes: applications may assign meaning to both.
  return url.toString();
}
export function library(db: Database, userId: string) {
  const ownResource = (id: string) =>
    and(eq(resources.id, id), eq(resources.userId, userId), eq(resources.kind, "link"), isNull(resources.projectId), isNull(resources.deletedAt));
  const ownCollection = (id: string) =>
    and(eq(collections.id, id), eq(collections.userId, userId), eq(collections.kind,"collection"));
  async function hydrate(rows: (typeof resources.$inferSelect)[]) {
    const memberships = rows.length
      ? await db
          .select({ resourceId: resourceCollections.resourceId, collectionId: resourceCollections.collectionId })
          .from(resourceCollections)
          .innerJoin(collections, and(eq(collections.id,resourceCollections.collectionId),eq(collections.kind,"collection")))
          .where(
            and(
              eq(resourceCollections.userId, userId),
              inArray(
                resourceCollections.resourceId,
                rows.map((r) => r.id),
              ),
            ),
          )
      : [];
    return rows.map(({ userId: _, importOriginId: _origin, extractedText: _extracted, knownSourceHash: _knownHash, ...row }) => ({
      ...row,
      url: row.url!,
      collectionIds: memberships
        .filter((m) => m.resourceId === row.id)
        .map((m) => m.collectionId)
        .sort(),
    }));
  }
  async function get(id: string) {
    const rows = await db.select().from(resources).where(ownResource(id));
    if (!rows.length) throw new AppError(404, "Resource not found.");
    return (await hydrate(rows))[0];
  }
  const memberships = (tx: Database, resourceId: string, ids: string[]) => setOrganizationMembership(tx,userId,resourceId,ids,"collection");
  return {
    get,
    async list(input: ListInput) {
      if(input.collectionId) await validateOrganization(db,userId,[input.collectionId],"collection");
      const filters = [eq(resources.userId, userId), eq(resources.kind, "link"), isNull(resources.projectId), isNull(resources.deletedAt), isNull(resources.archivedAt)];
      if (input.collectionId)
        filters.push(
          sql`exists(select 1 from ${resourceCollections} where ${resourceCollections.resourceId}=${resources.id} and ${resourceCollections.userId}=${userId} and ${resourceCollections.collectionId}=${input.collectionId})`,
        );
      if (input.status) filters.push(eq(resources.status, input.status));
      if (input.q.trim())
        filters.push(
          sql`(search_document @@ plainto_tsquery('english', ${input.q}) OR ${resources.tags} @> ARRAY[${input.q.trim().toLowerCase()}]::text[])`,
        );
      const where = and(...filters);
      const [rows, counts] = await Promise.all([
        db
          .select()
          .from(resources)
          .where(where)
          .orderBy(desc(resources.updatedAt), desc(resources.id))
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(resources)
          .where(where),
      ]);
      return { items: await hydrate(rows), total: counts[0].total };
    },
    async save(
      input: ResourceInput,
      sourceAgent = "web",
      metadata?: {
        title?: string;
        description: string;
        metadataStatus: "manual" | "extracted" | "unavailable";
        createdAt?: Date;
        updatedAt?: Date;
      },
    ) {
      const url = normalizeUrl(input.url);
      const result = await db.transaction(async (tx) => {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .for("update");
        const [existing] = await tx
          .select({ id: resources.id, deletedAt: resources.deletedAt })
          .from(resources)
          .where(and(eq(resources.userId, userId), eq(resources.url, url), isNull(resources.projectId)));
        if (existing?.deletedAt) throw new AppError(409, "This link is in Trash. Restore or permanently delete it first.");
        if (existing) return { id: existing.id, duplicate: true };
        const [count] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(resources)
          .where(eq(resources.userId, userId));
        if (count.total >= LIMITS.resources)
          throw new AppError(409, "Your resource limit has been reached.");
        const { collectionIds, ...fields } = input;
        const [row] = await tx
          .insert(resources)
          .values({
            ...fields,
            url,
            userId,
            sourceAgent,
            title: input.title || metadata?.title || new URL(url).hostname,
            tags: [...new Set(input.tags.map((t) => t.toLowerCase()))],
            description: metadata?.description,
            metadataStatus: metadata?.metadataStatus,
            createdAt: metadata?.createdAt,
            updatedAt: metadata?.updatedAt,
          })
          .returning();
        await memberships(tx, row.id, collectionIds);
        await tx
          .update(users)
          .set({ firstSavedAt: sql`coalesce(${users.firstSavedAt},now())` })
          .where(eq(users.id, userId));
        return { id: row.id, duplicate: false };
      });
      return { item: await get(result.id), duplicate: result.duplicate };
    },
    async update(id: string, input: ResourceUpdate) {
      await db.transaction(async (tx) => {
        const { collectionIds, ...fields } = input;
        const rows = await tx
          .update(resources)
          .set({
            ...fields,
            revision: sql`${resources.revision}+1`,
            tags: input.tags
              ? [...new Set(input.tags.map((t) => t.toLowerCase()))]
              : undefined,
            updatedAt: new Date(),
          })
          .where(ownResource(id))
          .returning({ id: resources.id });
        if (!rows.length) throw new AppError(404, "Resource not found.");
        if (collectionIds) await memberships(tx, id, collectionIds);
      });
      return get(id);
    },
    async remove(id: string) {
      const rows = await db
        .delete(resources)
        .where(ownResource(id))
        .returning({ id: resources.id });
      if (!rows.length) throw new AppError(404, "Resource not found.");
      return { deleted: true };
    },
    async collections() {
      return db
        .select({ id: collections.id, name: collections.name })
        .from(collections)
        .where(and(eq(collections.userId, userId),eq(collections.kind,"collection")))
        .orderBy(collections.name);
    },
    async createCollection(name: string) {
      return db.transaction(async (tx) => {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .for("update");
        const [count] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(collections)
          .where(eq(collections.userId, userId));
        if (count.total >= LIMITS.collections)
          throw new AppError(409, "Your collection limit has been reached.");
        const [row] = await tx
          .insert(collections)
          .values({ userId, name })
          .onConflictDoNothing()
          .returning({ id: collections.id, name: collections.name });
        if (!row)
          throw new AppError(
            409,
            "You already have a collection with this name.",
          );
        return row;
      });
    },
    async renameCollection(id: string, name: string) {
      const [row] = await db
        .update(collections)
        .set({ name })
        .where(ownCollection(id))
        .returning({ id: collections.id, name: collections.name });
      if (!row) throw new AppError(404, "Collection not found.");
      return row;
    },
    async deleteCollection(id: string) {
      const rows = await db
        .delete(collections)
        .where(ownCollection(id))
        .returning({ id: collections.id });
      if (!rows.length) throw new AppError(404, "Collection not found.");
      return { deleted: true };
    },
  };
}

export { items } from "./items.js";

export { readPdfPages } from "./pdf.js";
export { summaryStatus, queueSummary, cancelSummary } from "./summaries.js";
export { projectService } from "./projects.js";

export { topicService, setOrganizationMembership, validateOrganization } from "./topics.js";
