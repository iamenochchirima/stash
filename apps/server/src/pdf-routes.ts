import type { FastifyInstance } from "fastify";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { type Database, resources, attachments, itemJobs, users } from "@stash/db";
import { AppError, items, readPdfPages } from "@stash/core";
import { LIMITS } from "@stash/shared";
import { z } from "zod";
import { auth, digest } from "./auth.js";
import { MAX_PDF_BYTES, type FileStore } from "./file-store.js";
const ticketInput = z.object({ filename: z.string().trim().min(1).max(200).refine(n => /\.pdf$/i.test(n) && !/[\x00-\x1f/\\]/.test(n), "Choose a PDF file."), byteSize: z.number().int().min(1).max(MAX_PDF_BYTES) }).strict();
const idInput = z.object({ id: z.string().uuid() });
export function registerPdfRoutes(app: FastifyInstance, db: Database, options: { production?: boolean; enabled?: boolean; store?: FileStore; origin: string; publicApiUrl: string }) {
  const authentication = auth(db, !!options.production);
  const available = () => { if (!options.store || options.enabled === false) throw new AppError(503, "PDF uploads are not available yet."); return options.store; };
  app.get("/api/items/uploads/status", async req => { await authentication.user(req); return { available: !!options.store && options.enabled !== false, maxBytes: MAX_PDF_BYTES }; });
  app.post("/api/items/uploads", async req => {
    available(); const user = await authentication.user(req), input = ticketInput.parse(req.body);
    const token = randomBytes(32).toString("base64url"), id = randomUUID();
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(78134923)`);
      const globalUsage = await tx.execute(sql`select coalesce(sum(byte_size),0)::bigint as bytes from attachments`);
      if (Number(globalUsage.rows[0].bytes) + input.byteSize > 5 * 1024 * 1024 * 1024) throw new AppError(503, "PDF storage is full. Try again later.");
      const active = await tx.execute(sql`select id from users where id=${user.id} and suspended_at is null for update`);
      if (!active.rows.length) throw new AppError(403, "This account is unavailable.");
      const usage = await tx.execute(sql`select coalesce(sum(byte_size),0)::bigint as bytes, count(*) filter(where resource_id is null)::int as pending from attachments where user_id=${user.id}`);
      const used = usage.rows[0] as { bytes: string; pending: number };
      if (Number(used.bytes) + input.byteSize > 500 * 1024 * 1024) throw new AppError(409, "Your PDF storage limit has been reached.");
      if (used.pending >= 3) throw new AppError(429, "Finish your current uploads before adding another.");
      const count = await tx.execute(sql`select count(*)::int as total from resources where user_id=${user.id}`);
      if (Number(count.rows[0].total) + used.pending >= LIMITS.resources) throw new AppError(409, "Your item limit has been reached.");
      await tx.insert(attachments).values({ id, userId: user.id, storageKey: `${user.id}/${id}.pdf`, filename: input.filename, byteSize: input.byteSize, uploadTokenHash: digest(token), uploadExpiresAt: new Date(Date.now() + 5 * 60_000) });
    });
    return { id, token, uploadUrl: `${options.publicApiUrl}/uploads/${id}`, expiresIn: 300 };
  });
  app.addContentTypeParser("application/pdf", { parseAs: "buffer", bodyLimit: MAX_PDF_BYTES }, (_req, body, done) => done(null, body));
  app.post<{ Params: { id: string } }>("/uploads/:id", {
    bodyLimit: MAX_PDF_BYTES,
    onRequest: async req => {
      available(); const { id } = idInput.parse(req.params);
      const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      if (!token) throw new AppError(401, "Upload permission has expired. Choose the file again.");
      // Serialize reservations across instances before accepting a large request body.
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(78134922)`);
        const found = await tx.execute(sql`select user_id from attachments where id=${id} and upload_token_hash=${digest(token)}`);
        if (!found.rows.length) throw new AppError(401, "Upload permission has expired. Choose the file again.");
        const userId = String(found.rows[0].user_id);
        const active = await tx.execute(sql`select id from users where id=${userId} and suspended_at is null for update`);
        if (!active.rows.length) throw new AppError(403, "This account is unavailable.");
        const busy = await tx.execute(sql`select count(*)::int as total, count(*) filter(where user_id=${userId})::int as own from attachments where state='uploading' and upload_expires_at>now()`);
        if (Number(busy.rows[0].total) >= 2 || Number(busy.rows[0].own) >= 1) throw new AppError(429, "Another upload is in progress. Try again shortly.");
        const claimed = await tx.execute(sql`update attachments set state='uploading',updated_at=now() where id=${id} and state='pending' and upload_expires_at>now() returning id`);
        if (!claimed.rows.length) throw new AppError(401, "Upload permission has expired. Choose the file again.");
      });
    },
  }, async req => {
    const store = available(), { id } = idInput.parse(req.params);
    const result = await db.execute(sql`select * from attachments where id=${id} and state='uploading'`);
    const attachment = result.rows[0];
    if (!attachment) throw new AppError(404, "Upload not found.");
    const content = req.body;
    try {
      if (!Buffer.isBuffer(content) || content.length !== Number(attachment.byte_size) || !content.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new AppError(400, "This file is not a valid PDF or its size changed.");
      await store.put(String(attachment.storage_key), content);
      const resourceId = await db.transaction(async tx => {
        const active = await tx.execute(sql`select id from users where id=${attachment.user_id} and suspended_at is null for update`);
        if (!active.rows.length) throw new AppError(403, "This account is unavailable.");
        const claim = await tx.execute(sql`select id from attachments where id=${id} and state='uploading' and upload_expires_at>now() for update`);
        if (!claim.rows.length) throw new AppError(409, "Upload expired. Choose the file again.");
        const count = await tx.execute(sql`select count(*)::int as total from resources where user_id=${attachment.user_id}`);
        if (Number(count.rows[0].total) >= LIMITS.resources) throw new AppError(409, "Your item limit has been reached.");
        const [item] = await tx.insert(resources).values({ userId: String(attachment.user_id), kind: "pdf", title: String(attachment.filename).replace(/\.pdf$/i, ""), url: null, sourceAgent: "web" }).returning();
        await tx.execute(sql`update attachments set resource_id=${item.id},state='queued',upload_token_hash=null,content_hash=${createHash("sha256").update(content).digest("hex")},updated_at=now() where id=${id}`);
        await tx.insert(itemJobs).values({ userId: item.userId, resourceId: item.id, kind: "extract", inputRevision: item.revision });
        await tx.update(users).set({ firstSavedAt: sql`coalesce(first_saved_at,now())` }).where(sql`id=${item.userId}`);
        return item.id;
      });
      return { item: await items(db, String(attachment.user_id)).get(resourceId) };
    } catch (error) {
      await db.execute(sql`delete from attachments where id=${id} and resource_id is null`);
      throw error;
    }
  });
  app.post("/api/items/:id/download", async req => {
    available(); const user = await authentication.user(req), { id } = idInput.parse(req.params);
    await items(db, user.id).get(id);
    const token = randomBytes(32).toString("base64url");
    await db.transaction(async tx => {
      const active = await tx.execute(sql`select id from users where id=${user.id} and suspended_at is null for update`);
      if (!active.rows.length) throw new AppError(403, "This account is unavailable.");
      const pdf = await tx.execute(sql`select a.id from attachments a join resources r on r.id=a.resource_id where r.id=${id} and r.user_id=${user.id} and r.deleted_at is null for update of r`);
      if (!pdf.rows.length) throw new AppError(404, "PDF not found.");
      await tx.execute(sql`delete from file_downloads where expires_at<now()`);
      const pending = await tx.execute(sql`select count(*)::int as total from file_downloads where user_id=${user.id}`);
      if (Number(pending.rows[0].total) >= 10) throw new AppError(429, "Wait a moment before downloading again.");
      await tx.execute(sql`insert into file_downloads(token_hash,user_id,resource_id,expires_at) values(${digest(token)},${user.id},${id},now()+interval '1 minute')`);
    });
    return { downloadUrl: `${options.publicApiUrl}/downloads/${id}`, token, expiresIn: 60 };
  });
  app.get("/downloads/:id", async (req, reply) => {
    const store = available(), { id } = idInput.parse(req.params);
    const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) throw new AppError(401, "Download permission has expired.");
    const file = await db.transaction(async tx => {
      const found = await tx.execute(sql`select user_id from file_downloads where token_hash=${digest(token)} and resource_id=${id} and expires_at>now()`);
      if (!found.rows.length) throw new AppError(401, "Download permission has expired.");
      const userId = String(found.rows[0].user_id);
      const active = await tx.execute(sql`select id from users where id=${userId} and suspended_at is null for update`);
      if (!active.rows.length) throw new AppError(403, "This account is unavailable.");
      const result = await tx.execute(sql`select a.storage_key,a.filename from attachments a join resources r on r.id=a.resource_id where r.id=${id} and r.user_id=${userId} and r.deleted_at is null for update of r`);
      if (!result.rows.length) throw new AppError(404, "PDF not found.");
      const used = await tx.execute(sql`delete from file_downloads where token_hash=${digest(token)} and expires_at>now() returning token_hash`);
      if (!used.rows.length) throw new AppError(401, "Download permission has expired.");
      return { ...result.rows[0], userId };
    });
    const content = await store.get(String(file.storage_key));
    const stillAllowed = await db.execute(sql`select r.id from resources r join users u on u.id=r.user_id where r.id=${id} and r.user_id=${file.userId} and r.deleted_at is null and u.suspended_at is null`);
    if (!stillAllowed.rows.length) throw new AppError(404, "PDF not found.");
    return reply.type("application/pdf").header("Content-Disposition", `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(String(file.filename)).replace(/['()]/g, c => "%"+c.charCodeAt(0).toString(16))}`).send(content);
  });
  app.post("/api/items/:id/extract", async req => {
    available(); const user = await authentication.user(req), { id } = idInput.parse(req.params);
    await db.transaction(async tx => {
      const active = await tx.execute(sql`select id from users where id=${user.id} and suspended_at is null for update`);
      if (!active.rows.length) throw new AppError(403, "This account is unavailable.");
      const item = await tx.execute(sql`select revision from resources where id=${id} and user_id=${user.id} and deleted_at is null for update`);
      if (!item.rows.length) throw new AppError(404, "PDF not found.");
      const file = await tx.execute(sql`select state from attachments where resource_id=${id} and user_id=${user.id} for update`);
      if (!file.rows.length) throw new AppError(404, "PDF not found.");
      if (file.rows[0].state !== "failed") throw new AppError(409, "This PDF does not need another extraction.");
      const previous = await tx.execute(sql`select count(*)::int as total from item_jobs where resource_id=${id} and kind='extract' and created_at>now()-interval '1 hour'`);
      if (Number(previous.rows[0].total) >= 3) throw new AppError(429, "Try this PDF again in an hour.");
      await tx.insert(itemJobs).values({ userId: user.id, resourceId: id, kind: "extract", inputRevision: Number(item.rows[0].revision) });
      await tx.execute(sql`update attachments set state='queued',error_code=null,updated_at=now() where resource_id=${id}`);
    });
    return { state: "queued" };
  });
  app.get("/api/items/:id/pages", async req => {
    const user = await authentication.user(req), { id } = idInput.parse(req.params);
    const { from } = z.object({ from: z.coerce.number().int().min(1).max(100).default(1) }).parse(req.query);
    return readPdfPages(db, user.id, id, from);
  });
}
