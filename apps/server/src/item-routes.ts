import type { FastifyInstance } from "fastify";
import type { Database } from "@stash/db";
import { exportItems, previewItemsImport, importItems } from "@stash/core/items-portability";
import { LIMITS } from "@stash/shared";
import { items, AppError } from "@stash/core";
import { itemInput, itemUpdate, itemListInput } from "@stash/shared";
import { z } from "zod";
import { auth } from "./auth.js";
import { fetchMetadata } from "./metadata.js";
export function registerItems(app: FastifyInstance, db: Database, options: { production?: boolean; enabled?: boolean }) {
  const authentication = auth(db, !!options.production);
  const id = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
  app.get("/api/items/export", async req => exportItems(db, (await authentication.user(req)).id));
  app.post("/api/items/import/preview", { bodyLimit: LIMITS.importBytes * 2 + 1024 }, async req => previewItemsImport(db, (await authentication.user(req)).id, req.body));
  app.post("/api/items/import", { bodyLimit: LIMITS.importBytes * 2 + 1024 }, async req => importItems(db, (await authentication.user(req)).id, req.body));
  app.get("/api/items", async req => items(db, (await authentication.user(req)).id).list(itemListInput.parse(req.query)));
  app.get("/api/items/:id", async req => ({ item: await items(db, (await authentication.user(req)).id).get(id(req.params), z.object({ trash: z.enum(["true"]).optional() }).parse(req.query).trash === "true") }));
  app.post("/api/items", async req => {
    const user = await authentication.user(req), input = itemInput.parse(req.body);
    if (input.kind !== "link" && options.enabled === false) throw new AppError(503, "General item capture is not enabled yet.");
    return items(db, user.id).save(input, "web", input.kind === "link" && !input.title ? await fetchMetadata(input.url) : undefined);
  });
  app.patch("/api/items/:id", async req => ({ item: await items(db, (await authentication.user(req)).id).update(id(req.params), itemUpdate.parse(req.body)) }));
  app.post("/api/items/:id/lifecycle", async req => items(db, (await authentication.user(req)).id).lifecycle(id(req.params), z.object({ action: z.enum(["archive", "unarchive", "trash", "restore", "purge"]) }).parse(req.body).action));
}
