import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";
import { SUMMARY_LIMITS, summaryResult, type SummarySnapshot, type SavedSummary } from "@stash/shared";
import { AppError } from "./index.js";
import { items } from "./items.js";
const limits = SUMMARY_LIMITS;
export async function summaryStatus(db: Database, userId: string, id: string, available: boolean) {
  const item = await items(db, userId).get(id);
  if (!["link", "pdf"].includes(item.kind)) throw new AppError(400, "Summaries are available for articles and PDFs.");
  const saved = await db.execute(sql`select * from item_summaries where resource_id=${id} and user_id=${userId}`);
  const jobs = await db.execute(sql`select id,state,error_code,created_at from item_jobs where resource_id=${id} and user_id=${userId} and kind='summary' order by created_at desc,id desc limit 1`);
  const usage = await db.execute(sql`select count(*)::int as requests,coalesce(sum(reserved_tokens),0)::int as tokens from summary_usage where user_id=${userId} and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`);
  let stored: SavedSummary | null = null;
  if (saved.rows.length) {
    const row = saved.rows[0], snapshot = row.source_snapshot as SummarySnapshot;
    const result = summaryResult.parse(row.result), cited = new Set([result.overview,...result.points].flatMap(c=>c.sourceIds));
    stored = { result, model: String(row.model), createdAt: new Date(String(row.created_at)).toISOString(), sourceRevision: Number(row.source_revision), sourceHash: String(row.source_hash), sources: snapshot.sources.filter(s=>cited.has(s.id)).map(({text,...source})=>({...source,excerpt:text.slice(0,300).trim()})), partial: snapshot.partial, stale: item.sourceRevision !== Number(row.source_revision) };
  }
  const job = jobs.rows[0];
  return { available, saved: stored, job: job ? { id: String(job.id), state: String(job.state), errorCode: job.error_code ? String(job.error_code) : null, createdAt: new Date(String(job.created_at)).toISOString() } : null,
    limits: { dailyRequests: limits.dailyRequests, dailyTokenReservation: limits.dailyTokenReservation, monthlyGlobalRequests: limits.monthlyGlobalRequests, monthlySpendUsd: limits.monthlySpendUsd },
    usage: { requestsToday: Number(usage.rows[0].requests), reservedTokensToday: Number(usage.rows[0].tokens) } };
}
export async function queueSummary(db: Database, userId: string, id: string, input: { revision: number; requestId: string }, available: boolean, keyId?: string) {
  if (!available) throw new AppError(503, "Summaries are not configured yet.");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(78134925)`);
    const active = await tx.execute(sql`select id from users where id=${userId} and suspended_at is null for update`);
    if (!active.rows.length) throw new AppError(403, "This account is unavailable.");
    if (keyId) {
      const key = await tx.execute(sql`select id from api_keys where id=${keyId} and user_id=${userId} and scope='write' and (expires_at is null or expires_at>now())`);
      if (!key.rows.length) throw new AppError(401, "This agent connection is no longer available.");
    }
    const rows = await tx.execute(sql`select kind,revision,source_revision from resources where id=${id} and user_id=${userId} and deleted_at is null for update`);
    const item = rows.rows[0];
    if (!item) throw new AppError(404, "Item not found.");
    if (!["link", "pdf"].includes(String(item.kind))) throw new AppError(400, "Summaries are available for articles and PDFs.");
    const prior = await tx.execute(sql`select j.id,q.resource_id,j.state,q.requested_revision from summary_requests q join item_jobs j on j.id=q.job_id and j.user_id=q.user_id where q.user_id=${userId} and q.request_id=${input.requestId}`);
    if (prior.rows.length) {
      const p = prior.rows[0];
      if (p.resource_id !== id || Number(p.requested_revision) !== input.revision) throw new AppError(409, "This request ID was used for a different summary.");
      return { id: String(p.id), state: String(p.state), repeated: true };
    }
    const running = await tx.execute(sql`select id,state from item_jobs where resource_id=${id} and kind='summary' and state in ('queued','running')`);
    if (running.rows.length) {
      await tx.execute(sql`insert into summary_requests(user_id,request_id,job_id,resource_id,requested_revision) values(${userId},${input.requestId},${running.rows[0].id},${id},${input.revision})`);
      return { id: String(running.rows[0].id), state: String(running.rows[0].state), repeated: true };
    }
    if (Number(item.revision) !== input.revision) throw new AppError(409, "This item changed. Reload it before requesting a summary.");
    if (item.kind === "pdf") {
      const ready = await tx.execute(sql`select id from attachments where resource_id=${id} and user_id=${userId} and state='ready'`);
      if (!ready.rows.length) throw new AppError(409, "Wait for PDF text extraction before requesting a summary.");
    }
    const usage = await tx.execute(sql`select count(*) filter(where user_id=${userId} and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')::int as own,
      coalesce(sum(reserved_tokens) filter(where user_id=${userId} and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0)::int as tokens,
      count(*) filter(where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')::int as daily,
      count(*) filter(where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')::int as monthly,
      coalesce(sum(cost_usd),0) as cost,count(*) filter(where outcome='budget_violation')::int as violations from summary_usage where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'`);
    const used = usage.rows[0];
    if (Number(used.own) >= limits.dailyRequests || Number(used.tokens) + limits.reservationTokens > limits.dailyTokenReservation) throw new AppError(429, "Your daily summary limit has been reached. Try again tomorrow.");
    if (Number(used.monthly) >= limits.monthlyGlobalRequests || Number(used.daily) >= limits.dailyGlobalRequests || Number(used.cost) > 0 || Number(used.violations) > 0) throw new AppError(503, "The summary service has reached its usage limit. Try again later.");
    const job = await tx.execute(sql`insert into item_jobs(user_id,resource_id,key_id,kind,input_revision,request_id,source_revision) values(${userId},${id},${keyId || null},'summary',${input.revision},${input.requestId},${item.source_revision}) returning id,state`);
    await tx.execute(sql`insert into summary_requests(user_id,request_id,job_id,resource_id,requested_revision) values(${userId},${input.requestId},${job.rows[0].id},${id},${input.revision})`);
    await tx.execute(sql`insert into summary_usage(job_id,user_id,reserved_tokens) values(${job.rows[0].id},${userId},${limits.reservationTokens})`);
    return { id: String(job.rows[0].id), state: String(job.rows[0].state), repeated: false };
  });
}
export async function cancelSummary(db: Database, userId: string, id: string) {
  return db.transaction(async tx => {
    const active = await tx.execute(sql`select id from users where id=${userId} and suspended_at is null for update`);
    if (!active.rows.length) throw new AppError(403, "This account is unavailable.");
    const item = await tx.execute(sql`select id from resources where id=${id} and user_id=${userId} and deleted_at is null for update`);
    if (!item.rows.length) throw new AppError(404, "Item not found.");
    const jobs = await tx.execute(sql`update item_jobs set state='cancelled',lease_until=null,source_snapshot=null,updated_at=now() where resource_id=${id} and user_id=${userId} and kind='summary' and state in ('queued','running') returning id,dispatched_at`);
    for (const job of jobs.rows) await tx.execute(sql`update summary_usage set outcome=${job.dispatched_at ? "cancelled_after_dispatch" : "cancelled"},reserved_tokens=case when ${!job.dispatched_at} then 0 else reserved_tokens end where job_id=${job.id}`);
    return { cancelled: jobs.rows.length > 0 };
  });
}
