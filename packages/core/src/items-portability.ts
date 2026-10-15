import { z } from "zod";
import { and, eq, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { resources, collections, resourceCollections, users, type Database } from "@stash/db";
import { itemInput, LIMITS } from "@stash/shared";
import { AppError, library, normalizeUrl } from "./index.js";
import { items } from "./items.js";
import { previewImport, importLibrary } from "./portability.js";
const rawInput = z.object({ format: z.enum(["json", "html"]), content: z.string() });
const portable = z.object({
  id: z.string().uuid().optional(), kind: z.enum(["link", "note", "idea", "pdf"]),
  title: z.string().max(200).default(""), url: z.string().nullable().optional(), body: z.string().max(50000).default(""),
  notes: z.string().max(10000).default(""), tags: z.array(z.string()).max(20).default([]),
  collections: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  status: z.enum(["unread", "reading", "done"]).default("unread"), favourite: z.boolean().default(false),
  archivedAt: z.string().datetime().nullable().default(null), deletedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime().optional(), updatedAt: z.string().datetime().optional(),
  sourceAgent: z.string().max(80).default("import"),
  description: z.string().max(1000).default(""),
  metadataStatus: z.enum(["manual", "extracted", "unavailable"]).default("manual"),
});
function parsedInput(value: unknown) {
  const input = rawInput.parse(value);
  if (Buffer.byteLength(input.content) > (input.format === "json" ? LIMITS.importBytes : 1048576)) throw new AppError(413, "Import file is too large.");
  if (input.format === "html") return null;
  let document;
  try { document = JSON.parse(input.content); } catch { throw new AppError(400, "This file is not valid JSON."); }
  if (document?.version !== 2) return null;
  return { ...z.object({ version: z.literal(2), collections: z.array(z.object({ name: z.string().trim().min(1).max(80) })).max(LIMITS.collections).default([]), items: z.array(z.unknown()).max(LIMITS.importItems) }).parse(document), fingerprint: createHash("sha256").update(input.content).digest("hex") };
}
export async function exportItems(db: Database, userId: string) {
  return db.transaction(async tx => {
    const [profile] = await tx.select({ name: users.name, email: users.email, bio: users.bio, interests: users.interests }).from(users).where(eq(users.id, userId));
    if (!profile) throw new AppError(404, "Account not found.");
    const [size] = await tx.select({ bytes: sql<number>`coalesce(sum(octet_length(${resources.body})+octet_length(${resources.notes})+octet_length(${resources.title})+4096),0)::bigint` }).from(resources).where(eq(resources.userId, userId));
    if (Number(size.bytes) > LIMITS.importBytes - 65536) throw new AppError(413, "This export exceeds 128 MiB. Export smaller collections first.");
    const rows = await tx.select().from(resources).where(eq(resources.userId, userId));
    const groups = await tx.select({ id: collections.id, name: collections.name }).from(collections).where(eq(collections.userId, userId));
    const membership = await tx.select().from(resourceCollections).where(eq(resourceCollections.userId, userId));
    const output = { version: 2, exportedAt: new Date().toISOString(), profile, collections: groups,
      excludesOriginalFiles: true,
      items: rows.map(row => ({ id: row.id, kind: row.kind, url: row.url, title: row.title, body: row.body, notes: row.notes, tags: row.tags,
        description: row.description, metadataStatus: row.metadataStatus, status: row.status, favourite: row.favourite, archivedAt: row.archivedAt, deletedAt: row.deletedAt,
        sourceAgent: row.sourceAgent, createdAt: row.createdAt, updatedAt: row.updatedAt,
        collections: membership.filter(m => m.resourceId === row.id).map(m => groups.find(c => c.id === m.collectionId)!.name),
      })),
    };
    if (Buffer.byteLength(JSON.stringify(output)) > LIMITS.importBytes) throw new AppError(413, "This export exceeds 128 MiB.");
    return output;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
async function existing(db: Database, userId: string, row: z.infer<typeof portable>) {
  const condition = row.kind === "link" && row.url ? eq(resources.url, normalizeUrl(row.url)) : row.id ? or(eq(resources.id, row.id), eq(resources.importOriginId, row.id)) : undefined;
  if (!condition) return undefined;
  return (await db.select({ id: resources.id, deletedAt: resources.deletedAt }).from(resources).where(and(eq(resources.userId, userId), condition)))[0];
}
export async function previewItemsImport(db: Database, userId: string, value: unknown) {
  const parsed = parsedInput(value);
  if (!parsed) return previewImport(db, userId, value);
  const groups = await library(db, userId).collections();
  const names = new Set(parsed.collections.map(c => c.name));
  let valid = 0, duplicates = 0;
  const rejected: { index: number; error: string }[] = [];
  for (const [index, entry] of parsed.items.entries()) {
    try {
      const row = portable.parse(entry);
      if (row.kind === "pdf") throw new AppError(400, "Original PDF files require a full backup ZIP.");
      itemInput.parse(row); valid++;
      row.collections.forEach(name => names.add(name));
      if (await existing(db, userId, row)) duplicates++;
    } catch (e) { rejected.push({ index, error: e instanceof AppError ? e.message : "Invalid item." }); }
  }
  return { total: parsed.items.length, valid, duplicates, toSave: valid - duplicates, rejected, collectionsToCreate: [...names].filter(name => !groups.some(c => c.name === name)).length };
}
export async function importItems(db: Database, userId: string, value: unknown) {
  const parsed = parsedInput(value);
  if (!parsed) return importLibrary(db, userId, value);
  const service = items(db, userId), groups = library(db, userId);
  const known = new Map((await groups.collections()).map(c => [c.name, c.id]));
  const collectionErrors: { name: string; error: string }[] = [], rejected: { index: number; error: string }[] = [];
  async function group(name: string) {
    if (!known.has(name)) { try { known.set(name, (await groups.createCollection(name)).id); } catch (e) { const found = (await groups.collections()).find(c => c.name === name); if (found) known.set(name, found.id); else throw e; } }
    return known.get(name)!;
  }
  for (const c of parsed.collections) try { await group(c.name); } catch { collectionErrors.push({ name: c.name, error: "Could not import collection." }); }
  let saved = 0, duplicates = 0;
  for (const [index, entry] of parsed.items.entries()) {
    try {
      const row = portable.parse(entry);
      if (row.kind === "pdf") throw new AppError(400, "Original PDF files require a full backup ZIP.");
      itemInput.parse(row);
      const found = await existing(db, userId, row);
      if (found) { duplicates++; continue; }
      const collectionIds = await Promise.all(row.collections.map(group));
      const origin = row.id || (() => { const hex = createHash("sha256").update(`${parsed.fingerprint}:${index}`).digest("hex"); return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`; })();
      const result = await service.save(itemInput.parse({ ...row, collectionIds, requestId: origin }), row.sourceAgent);
      if (result.duplicate) { duplicates++; continue; }
      const deletedAt = row.deletedAt ? new Date(Math.min(Date.now(), new Date(row.deletedAt).getTime())) : null;
      if (deletedAt && deletedAt.getTime() < Date.now() - 30 * 86400_000) { await db.delete(resources).where(and(eq(resources.userId, userId), eq(resources.id, result.item.id))); rejected.push({ index, error: "Expired Trash item was not restored." }); continue; }
      await db.update(resources).set({ importOriginId: origin, description: row.description, metadataStatus: row.metadataStatus, favourite: row.favourite, archivedAt: row.archivedAt ? new Date(row.archivedAt) : null, deletedAt,
        createdAt: row.createdAt ? new Date(row.createdAt) : undefined, updatedAt: row.updatedAt ? new Date(row.updatedAt) : undefined,
      }).where(and(eq(resources.userId, userId), eq(resources.id, result.item.id)));
      saved++;
    } catch (e) { rejected.push({ index, error: e instanceof AppError ? e.message : "Could not import this item." }); }
  }
  return { saved, duplicates, rejected, collectionErrors, total: parsed.items.length };
}
