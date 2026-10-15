import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";
import type { FileStore } from "./file-store.js";
import { extractPdf } from "./pdf-process.js";

// One job per pass keeps parsing memory bounded. Leases allow another process to recover after a crash.
export async function processPdfJob(db: Database, store: FileStore) {
  await db.execute(sql`with exhausted as (
    update item_jobs set state='failed',error_code='processing_interrupted',lease_until=null,updated_at=now()
    where kind='extract' and state='running' and lease_until<now() and attempts>=3 returning resource_id
  ) update attachments set state='failed',error_code='processing_interrupted',updated_at=now() where resource_id in(select resource_id from exhausted)`);
  const claimed = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(78134924)`);
    const busy = await tx.execute(sql`select id from item_jobs where kind='extract' and state='running' and lease_until>now() limit 1`);
    if (busy.rows.length) return { rows: [] };
    return tx.execute(sql`with candidate as (
    select j.id from item_jobs j join resources r on r.id=j.resource_id join users u on u.id=j.user_id
    where j.kind='extract' and (j.state='queued' or (j.state='running' and j.lease_until<now()))
      and j.run_after<=now() and j.attempts<3 and r.deleted_at is null and u.suspended_at is null
    order by j.created_at for update of j skip locked limit 1
  ) update item_jobs set state='running',attempts=attempts+1,lease_until=now()+interval '2 minutes',updated_at=now()
    where id in(select id from candidate) returning *`);
  });
  const job = claimed.rows[0]; if (!job) return false;
  const attachment = await db.execute(sql`update attachments set state='processing',updated_at=now() where resource_id=${job.resource_id} returning storage_key`);
  if (!attachment.rows.length) return true;
  let extraction: Awaited<ReturnType<typeof extractPdf>> | undefined, errorCode: string | undefined;
  try { extraction = await extractPdf(await store.get(String(attachment.rows[0].storage_key))); }
  catch (error) {
    const codes = ["password_protected", "too_many_pages", "too_much_text", "no_extractable_text", "invalid_pdf", "processing_timeout", "processing_failed", "processing_memory_limit"];
    errorCode = error instanceof Error && codes.includes(error.message) ? error.message : "storage_unavailable";
  }
  await db.transaction(async tx => {
    const active = await tx.execute(sql`select id from users where id=${job.user_id} and suspended_at is null for update`);
    if (!active.rows.length) {
      await tx.execute(sql`update item_jobs set state='queued',run_after=now()+interval '5 minutes',lease_until=null,attempts=greatest(attempts-1,0) where id=${job.id} and lease_until=${job.lease_until}`);
      return;
    }
    const item = await tx.execute(sql`select deleted_at from resources where id=${job.resource_id} and user_id=${job.user_id} for update`);
    if (!item.rows.length) return;
    const locked = await tx.execute(sql`select id from item_jobs where id=${job.id} and state='running' and lease_until=${job.lease_until} for update`);
    if (!locked.rows.length) return;
    if (item.rows[0].deleted_at) {
      await tx.execute(sql`update item_jobs set state='queued',run_after=now()+interval '5 minutes',lease_until=null,attempts=greatest(attempts-1,0) where id=${job.id}`);
      await tx.execute(sql`update attachments set state='queued',updated_at=now() where resource_id=${job.resource_id}`);
      return;
    }
    if (extraction) {
      await tx.execute(sql`update attachments set state='ready',pages=${JSON.stringify(extraction.pages)}::jsonb,page_count=${extraction.pageCount},parser_version='pdfjs-6.4.299',error_code=null,updated_at=now() where resource_id=${job.resource_id}`);
      await tx.execute(sql`update resources set extracted_text=${extraction.pages.map(p => p.text).join("\n\n")},revision=revision+1,updated_at=now() where id=${job.resource_id}`);
      await tx.execute(sql`update item_jobs set state='succeeded',lease_until=null,error_code=null,updated_at=now() where id=${job.id}`);
    } else {
      const retry = ["storage_unavailable", "processing_timeout", "processing_failed"].includes(errorCode!) && Number(job.attempts) < 3;
      await tx.execute(sql`update item_jobs set state=${retry ? "queued" : "failed"},error_code=${errorCode!},lease_until=null,run_after=now()+interval '1 minute',updated_at=now() where id=${job.id}`);
      await tx.execute(sql`update attachments set state=${retry ? "queued" : "failed"},error_code=${errorCode!},updated_at=now() where resource_id=${job.resource_id}`);
    }
  });
  return true;
}

export async function cleanPdfFiles(db: Database, store: FileStore) {
  await db.execute(sql`delete from file_downloads where expires_at<now()`);
  await db.execute(sql`delete from attachments where resource_id is null and upload_expires_at<now()-interval '5 minutes'`);
  const claimed = await db.execute(sql`with candidate as (
    select id from blob_cleanup where not_before<=now() and (lease_until is null or lease_until<now()) order by created_at for update skip locked limit 1
  ) update blob_cleanup set lease_until=now()+interval '2 minutes',attempts=attempts+1 where id in(select id from candidate) returning *`);
  const entry = claimed.rows[0]; if (!entry) return false;
  try {
    await store.remove(String(entry.storage_key));
    await db.execute(sql`delete from blob_cleanup where id=${entry.id} and lease_until=${entry.lease_until}`);
  } catch {
    await db.execute(sql`update blob_cleanup set lease_until=null,not_before=now()+interval '5 minutes' where id=${entry.id} and lease_until=${entry.lease_until}`);
  }
  return true;
}
export function registerPdfWorker(app: FastifyInstance, db: Database, store: FileStore) {
  let running: Promise<void> | undefined, closing = false;
  const run = () => {
    if (running || closing) return;
    running = (async () => { await cleanPdfFiles(db, store); await processPdfJob(db, store); })()
      .catch(() => app.log.error("PDF maintenance failed; the next pass will retry."))
      .finally(() => { running = undefined; });
  };
  const timer = setInterval(run, 5000); timer.unref();
  app.addHook("onReady", async () => { run(); });
  app.addHook("onClose", async () => { closing = true; clearInterval(timer); await running; });
}
