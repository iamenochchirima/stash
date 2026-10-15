import { createHash } from "node:crypto";
import { and, eq, desc, sql, inArray, isNull, isNotNull, gt } from "drizzle-orm";
import { resources, attachments, collections, resourceCollections, itemRequests, users, type Database } from "@stash/db";
import { LIMITS, type ItemInput, type ItemUpdate, type ItemListInput } from "@stash/shared";
import { AppError, normalizeUrl } from "./index.js";
import { requireProject, requireProjectTextCapacity, recordProjectRevision } from "./projects.js";
const retention = 30 * 86400_000;
type Row = typeof resources.$inferSelect;
export function items(db: Database, userId: string) {
  const owner = (id: string) => and(eq(resources.userId, userId), eq(resources.id, id));
  async function active(tx: Database) {
    const [user] = await tx.select({ id: users.id, suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, userId)).for("update");
    if (!user || user.suspendedAt) throw new AppError(403, "This account is unavailable.");
  }
  async function present(rows: Row[], preview = false) {
    const membership = rows.length ? await db.select().from(resourceCollections).where(and(eq(resourceCollections.userId, userId), inArray(resourceCollections.resourceId, rows.map(r => r.id)))) : [];
    const pdfs = rows.length ? await db.select({ resourceId: attachments.resourceId, hasOriginal: sql<boolean>`${attachments.storageKey} is not null`, filename: attachments.filename, byteSize: attachments.byteSize, state: attachments.state, pageCount: attachments.pageCount, errorCode: attachments.errorCode }).from(attachments).where(and(eq(attachments.userId, userId), inArray(attachments.resourceId, rows.map(r => r.id)))) : [];
    return rows.map(({ userId: _, importOriginId: _origin, extractedText: _extracted, knownSourceHash: _knownHash, ...row }) => ({ ...row,
      pdf: row.kind === "pdf" ? pdfs.find(p => p.resourceId === row.id) || null : null,
      body: preview ? row.body.slice(0, 300) : row.body,
      notes: preview ? row.notes.slice(0, 300) : row.notes,
      bodyTruncated: preview && row.body.length > 300,
      collectionIds: membership.filter(m => m.resourceId === row.id).map(m => m.collectionId).sort(),
    }));
  }
  async function get(id: string, trash = false) {
    const [row] = await db.select().from(resources).where(and(owner(id), trash ? and(isNotNull(resources.deletedAt), gt(resources.deletedAt, new Date(Date.now() - retention))) : isNull(resources.deletedAt)));
    if (!row) throw new AppError(404, "Item not found.");
    return (await present([row]))[0];
  }
  async function membership(tx: Database, id: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length) {
      const owned = await tx.select({ id: collections.id }).from(collections).where(and(eq(collections.userId, userId), inArray(collections.id, unique)));
      if (owned.length !== unique.length) throw new AppError(404, "Collection not found.");
    }
    await tx.delete(resourceCollections).where(and(eq(resourceCollections.userId, userId), eq(resourceCollections.resourceId, id)));
    if (unique.length) {
      await tx.insert(resourceCollections).values(unique.map(collectionId => ({ userId, resourceId: id, collectionId })));
      await tx.update(users).set({ firstOrganizedAt: sql`coalesce(${users.firstOrganizedAt},now())` }).where(eq(users.id, userId));
    }
  }
  return {
    get,
    async list(input: ItemListInput) {
      if (input.projectId) await requireProject(db,userId,input.projectId);
      const filters = [eq(resources.userId, userId)];
      if (input.projectId) filters.push(eq(resources.projectId,input.projectId));
      else if (input.includeProjects !== "true") filters.push(isNull(resources.projectId));
      if (input.location === "trash") filters.push(isNotNull(resources.deletedAt), gt(resources.deletedAt, new Date(Date.now() - retention)));
      else {
        filters.push(isNull(resources.deletedAt));
        if (input.location === "archive") filters.push(isNotNull(resources.archivedAt));
        else if (input.includeArchived !== "true") filters.push(isNull(resources.archivedAt));
      }
      if (input.kind) filters.push(eq(resources.kind, input.kind));
      if (input.status) filters.push(inArray(resources.kind, ["link", "pdf"]), eq(resources.status, input.status));
      if (input.favourite) filters.push(eq(resources.favourite, input.favourite === "true"));
      if (input.collectionId) filters.push(sql`exists(select 1 from ${resourceCollections} where ${resourceCollections.userId}=${userId} and ${resourceCollections.resourceId}=${resources.id} and ${resourceCollections.collectionId}=${input.collectionId})`);
      if (input.q.trim()) filters.push(sql`(search_document @@ plainto_tsquery('english', ${input.q}) OR ${resources.tags} @> ARRAY[${input.q.trim().toLowerCase()}]::text[])`);
      const where = and(...filters);
      const [rows, [count]] = await Promise.all([
        db.select().from(resources).where(where).orderBy(desc(resources.createdAt), desc(resources.id)).limit(input.limit).offset(input.offset),
        db.select({ total: sql<number>`count(*)::int` }).from(resources).where(where),
      ]);
      return { items: await present(rows, true), total: count.total };
    },
    async save(input: ItemInput, sourceAgent = "web", metadata?: { title?: string; description: string; metadataStatus: "manual" | "extracted" | "unavailable" }) {
      if (input.kind === "pdf") throw new AppError(409, "Upload a PDF before creating this item.");
      const url = input.kind === "link" ? normalizeUrl(input.url) : null;
      const fingerprint = createHash("sha256").update(JSON.stringify({ ...input, ...(url && { url }) })).digest("hex");
      const result = await db.transaction(async tx => {
        await active(tx);
        if (input.projectId) { await requireProject(tx,userId,input.projectId,true); if(input.collectionIds.length)throw new AppError(400,"Collections belong to the main library."); }
        if ("body" in input && input.body.length > (input.projectId ? 500000 : 50000)) throw new AppError(400,"This document exceeds its workspace content limit.");
        if (input.requestId) {
          const [request] = await tx.select().from(itemRequests).where(and(eq(itemRequests.userId, userId), eq(itemRequests.requestId, input.requestId))).for("update");
          if (request && request.expiresAt > new Date()) {
            if (request.fingerprint !== fingerprint) throw new AppError(409, "This request ID was already used for different content.");
            const [row] = await tx.select().from(resources).where(owner(request.itemId));
            if (row?.deletedAt) throw new AppError(409, "This item is in Trash. Restore it first.");
            return { id: request.itemId, duplicate: true };
          }
          if (request) await tx.delete(itemRequests).where(and(eq(itemRequests.userId, userId), eq(itemRequests.requestId, input.requestId)));
        }
        if (url) {
          const [existing] = await tx.select().from(resources).where(and(eq(resources.userId, userId), eq(resources.url, url), input.projectId ? eq(resources.projectId,input.projectId) : isNull(resources.projectId)));
          if (existing?.deletedAt) throw new AppError(409, "This link is in Trash. Restore or permanently delete it first.");
          if (existing) {
            if (input.requestId) await tx.insert(itemRequests).values({ userId, requestId: input.requestId, fingerprint, itemId: existing.id, expiresAt: new Date(Date.now() + 86400_000) });
            return { id: existing.id, duplicate: true };
          }
        }
        const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(resources).where(eq(resources.userId, userId));
        if (count.total >= LIMITS.resources) throw new AppError(409, "Your item limit has been reached. Trash counts until permanently deleted.");
        if(input.projectId && "body" in input)await requireProjectTextCapacity(tx,userId,input.body);
        const body = input.kind === "link" ? "" : input.body;
        const title = input.title || (url ? metadata?.title || new URL(url).hostname : body.split(/\r?\n/).find(line => line.trim())!.replace(/^#+\s*/, "").slice(0, 200));
        const [row] = await tx.insert(resources).values({ userId, projectId: input.projectId || null, kind: input.kind, url, title, body,
          notes: input.notes, tags: [...new Set(input.tags.map(t => t.toLowerCase()))],
          status: input.kind === "link" ? input.status : "unread", sourceAgent,
          description: metadata?.description || "", metadataStatus: metadata?.metadataStatus || "manual",
        }).returning();
        await membership(tx, row.id, input.collectionIds);
        if (input.requestId) await tx.insert(itemRequests).values({ userId, requestId: input.requestId, fingerprint, itemId: row.id, expiresAt: new Date(Date.now() + 86400_000) });
        await tx.update(users).set({ firstSavedAt: sql`coalesce(${users.firstSavedAt},now())` }).where(eq(users.id, userId));
        return { id: row.id, duplicate: false };
      });
      return { item: await get(result.id), duplicate: result.duplicate };
    },
    async update(id: string, input: ItemUpdate) {
      await db.transaction(async tx => {
        await active(tx);
        const [row] = await tx.select().from(resources).where(and(owner(id), isNull(resources.deletedAt))).for("update");
        if (!row) throw new AppError(404, "Item not found.");
        if (row.projectId) { await requireProject(tx,userId,row.projectId,true); if(input.collectionIds?.length)throw new AppError(400,"Collections belong to the main library."); }
        if (input.body && input.body.length > (row.projectId ? 500000 : 50000)) throw new AppError(400,"This document exceeds its workspace content limit.");
        if (row.revision !== input.revision) throw new AppError(409, "This item changed elsewhere. Reload it before saving your changes.");
        if (input.body !== undefined && !["note", "idea"].includes(row.kind)) throw new AppError(400, "This item's source content cannot be edited.");
        if (input.status !== undefined && !["link", "pdf"].includes(row.kind)) throw new AppError(400, "Reading status applies to links and PDFs.");
        if(row.projectId && input.body !== undefined && input.body!==row.body) { await requireProjectTextCapacity(tx,userId,input.body); await recordProjectRevision(tx,userId,row,"web"); }
        const { revision, collectionIds, ...fields } = input;
        await tx.update(resources).set({ ...fields, tags: input.tags?.map(t => t.toLowerCase()).filter((t, i, all) => all.indexOf(t) === i), sourceRevision: input.body !== undefined && input.body !== row.body ? row.sourceRevision + 1 : row.sourceRevision, revision: revision + 1, updatedAt: new Date() }).where(owner(id));
        if (collectionIds) await membership(tx, id, collectionIds);
      });
      return get(id);
    },
    async lifecycle(id: string, action: "archive" | "unarchive" | "trash" | "restore" | "purge") {
      const result = await db.transaction(async tx => {
        await active(tx);
        const [row] = await tx.select().from(resources).where(owner(id)).for("update");
        if (!row) throw new AppError(404, "Item not found.");
        if (row.projectId) await requireProject(tx,userId,row.projectId,true);
        if (row.deletedAt && row.deletedAt.getTime() <= Date.now() - retention && action !== "purge") throw new AppError(404, "Item not found.");
        if (action === "purge") {
          if (!row.deletedAt) throw new AppError(409, "Move this item to Trash before permanently deleting it.");
          await tx.delete(resources).where(owner(id));
          return { deleted: true };
        }
        if (["archive", "unarchive"].includes(action) && row.deletedAt) throw new AppError(409, "Restore this item before changing it.");
        const deletedAt = action === "trash" ? row.deletedAt || new Date() : action === "restore" ? null : row.deletedAt;
        const archivedAt = action === "archive" ? row.archivedAt || new Date() : action === "unarchive" ? null : row.archivedAt;
        if (deletedAt?.getTime() !== row.deletedAt?.getTime() || archivedAt?.getTime() !== row.archivedAt?.getTime())
          await tx.update(resources).set({ deletedAt, archivedAt, revision: row.revision + 1, updatedAt: new Date() }).where(owner(id));
        return { deleted: false };
      });
      return result.deleted ? result : { item: await get(id, action === "trash") };
    },
  };
}
