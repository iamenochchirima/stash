import { load } from "cheerio";
import { z } from "zod";
import { sql, and, eq } from "drizzle-orm";
import { resources, collections, users, type Database } from "@stash/db";
import { resourceInput, listInput, LIMITS } from "@stash/shared";
import { library, normalizeUrl, AppError } from "./index.js";
const fileInput = z.object({
  format: z.enum(["json", "html"]),
  content: z.string(),
});
const portableResource = resourceInput.omit({ collectionIds: true }).extend({
  collections: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  sourceAgent: z.string().max(80).default("import"),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  description: z.string().max(1000).default(""),
  metadataStatus: z
    .enum(["manual", "extracted", "unavailable"])
    .default("manual"),
});
export type ImportEntry = z.infer<typeof portableResource>;
export function parseImport(body: unknown) {
  const input = fileInput.parse(body);
  const max = input.format === "html" ? 1048576 : LIMITS.importBytes;
  if (Buffer.byteLength(input.content) > max)
    throw new AppError(413, `Import exceeds ${max / 1048576} MiB.`);
  let candidates: unknown[];
  let collectionNames: string[] = [];
  if (input.format === "json") {
    let data: unknown;
    try {
      data = JSON.parse(input.content);
    } catch {
      throw new AppError(400, "This file is not valid JSON.");
    }
    if (data && typeof data === "object") {
      const source = data as { resources?: unknown };
      const hasTopicMembership = Array.isArray(source.resources) && source.resources.some(value => {
        if (!value || typeof value !== "object") return false;
        const row = value as { topicIds?: unknown };
        return Object.hasOwn(row, "topics") || Array.isArray(row.topicIds) && row.topicIds.length > 0;
      });
      if (Object.hasOwn(data, "topics") || hasTopicMembership)
        throw new AppError(400, "Topics require a version 3 Stash export. Import it through the current data-only JSON or backup flow.");
    }
    const document = z
      .object({
        version: z.literal(1),
        collections: z
          .array(
            z.object({
              id: z.string(),
              name: z.string().trim().min(1).max(80),
            }),
          )
          .max(LIMITS.collections),
        resources: z.array(z.unknown()).max(LIMITS.importItems),
      })
      .safeParse(data);
    if (!document.success)
      throw new AppError(
        400,
        "Use a version 1 Stash export with collections and resources.",
      );
    collectionNames = [
      ...new Set(document.data.collections.map((c) => c.name)),
    ];
    const names = new Map(document.data.collections.map((c) => [c.id, c.name]));
    candidates = document.data.resources.map((value) => {
      if (!value || typeof value !== "object") return value;
      const row = value as Record<string, unknown>;
      const ids = z
        .array(z.string())
        .max(20)
        .safeParse(row.collectionIds || []);
      if (!ids.success || ids.data.some((id) => !names.has(id)))
        return { ...row, collections: [null] };
      return { ...row, collections: ids.data.map((id) => names.get(id)) };
    });
  } else {
    const $ = load(input.content);
    candidates = $("a")
      .toArray()
      .map((anchor) => {
        const node = $(anchor),
          folders: string[] = [];
        // Netscape bookmarks encode a folder as H3 followed by a nested DL.
        for (const parent of node.parents("dl").toArray().reverse()) {
          const heading = $(parent).prevAll("h3").first().text().trim();
          if (heading) folders.push(heading);
        }
        return {
          url: node.attr("href"),
          title: node.text(),
          notes: node.parent().next("dd").text(),
          collections: folders.slice(-1),
        };
      });
    if (candidates.length > LIMITS.importItems)
      throw new AppError(413, "Too many bookmarks in this file.");
  }
  const entries: ImportEntry[] = [],
    entryIndices: number[] = [],
    rejected: { index: number; error: string }[] = [];
  candidates.forEach((candidate, index) => {
    const result = portableResource.safeParse(candidate);
    if (result.success) {
      entries.push(result.data);
      entryIndices.push(index + 1);
    } else
      rejected.push({
        index: index + 1,
        error: result.error.issues[0]?.message || "Invalid entry",
      });
  });
  return {
    entries,
    entryIndices,
    rejected,
    total: candidates.length,
    collectionNames,
  };
}
export async function previewImport(
  db: Database,
  userId: string,
  body: unknown,
) {
  const parsed = parseImport(body);
  const rows = await db
    .select({ url: resources.url })
    .from(resources)
    .where(and(eq(resources.userId, userId), sql`${resources.projectId} is null`));
  const seen = new Set(rows.map((r) => r.url));
  let duplicates = 0;
  for (const item of parsed.entries) {
    const url = normalizeUrl(item.url);
    if (seen.has(url)) duplicates++;
    else seen.add(url);
  }
  const existingNames = new Set(
    (await library(db, userId).collections()).map((c) => c.name),
  );
  return {
    collectionsToCreate: parsed.collectionNames.filter(
      (name) => !existingNames.has(name),
    ).length,
    total: parsed.total,
    valid: parsed.entries.length,
    duplicates,
    toSave: parsed.entries.length - duplicates,
    rejected: parsed.rejected,
  };
}
export async function importLibrary(
  db: Database,
  userId: string,
  body: unknown,
) {
  const parsed = parseImport(body),
    service = library(db, userId);
  const known = new Map(
    (await service.collections()).map((c) => [c.name, c.id]),
  );
  let saved = 0,
    duplicates = 0;
  const rejected = [...parsed.rejected],
    collectionErrors: { name: string; error: string }[] = [];
  for (const name of parsed.collectionNames) {
    if (known.has(name)) continue;
    try {
      known.set(name, (await service.createCollection(name)).id);
    } catch (error) {
      const existing = (await service.collections()).find(
        (c) => c.name === name,
      );
      if (existing) known.set(name, existing.id);
      else
        collectionErrors.push({
          name,
          error:
            error instanceof AppError
              ? error.message
              : "Could not import collection.",
        });
    }
  }
  // Valid entries commit separately. A failed entry is reported without undoing earlier successful entries.
  for (const [index, item] of parsed.entries.entries()) {
    try {
      const collectionIds: string[] = [];
      for (const name of item.collections) {
        if (!known.has(name)) {
          try {
            const created = await service.createCollection(name);
            known.set(name, created.id);
          } catch (error) {
            const existing = (await service.collections()).find(
              (c) => c.name === name,
            );
            if (!existing) throw error;
            known.set(name, existing.id);
          }
        }
        collectionIds.push(known.get(name)!);
      }
      const result = await service.save(
        resourceInput.parse({ ...item, collectionIds }),
        item.sourceAgent,
        {
          description: item.description,
          metadataStatus: item.metadataStatus,
          ...(item.createdAt && { createdAt: new Date(item.createdAt) }),
          ...(item.updatedAt && { updatedAt: new Date(item.updatedAt) }),
        },
      );
      if (result.duplicate) duplicates++;
      else saved++;
    } catch (error) {
      rejected.push({
        index: parsed.entryIndices[index],
        error:
          error instanceof AppError
            ? error.message
            : "Could not import this entry.",
      });
    }
  }
  return { saved, duplicates, rejected, collectionErrors, total: parsed.total };
}
export async function exportLibrary(db: Database, userId: string) {
  return db.transaction(
    async (tx) => {
      const topic = await tx.select({id:collections.id}).from(collections).where(and(eq(collections.userId,userId),eq(collections.kind,"topic"))).limit(1);
      if(topic.length)throw new AppError(409,"This legacy export cannot preserve Topics. Use Export data only (JSON version 3) or a full Stash backup.");
      const service = library(tx, userId),
        items = [];
      for (let offset = 0; ; offset += 100) {
        const page = await service.list(
          listInput.parse({ offset, limit: 100 }),
        );
        items.push(...page.items);
        if (items.length >= page.total) break;
      }
      const [profile] = await tx
        .select({
          name: users.name,
          email: users.email,
          bio: users.bio,
          interests: users.interests,
        })
        .from(users)
        .where(eq(users.id, userId));
      if (!profile) throw new AppError(404, "Account not found.");
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        profile,
        collections: await service.collections(),
        resources: items,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
