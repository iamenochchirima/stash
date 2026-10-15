import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";
import type { SummarySnapshot } from "@stash/shared";
import { summarySource } from "./summary-source.js";
import { SummaryProviderError, type SummaryProvider, type SummaryCompletion } from "./summary-provider.js";
async function permitted(db: Database, job: Record<string, unknown>, checkRevision = true) {
  const result = await db.execute(sql`select j.id from item_jobs j join users u on u.id=j.user_id join resources r on r.id=j.resource_id
    where j.id=${job.id} and j.state='running' and j.lease_until=${job.lease_until} and u.suspended_at is null and r.deleted_at is null and (${!checkRevision} or r.source_revision=j.source_revision)
    and (j.key_id is null or exists(select 1 from api_keys k where k.id=j.key_id and k.user_id=j.user_id and k.scope='write' and (k.expires_at is null or k.expires_at>now())))`);
  return !!result.rows.length;
}
export async function processSummaryJob(db: Database, provider: SummaryProvider, source = summarySource) {
  await db.execute(sql`delete from summary_usage where created_at<now()-interval '90 days'`);
  await db.execute(sql`with expired as (
    update item_jobs set state=case when dispatched_at is null then 'failed' else 'unknown' end,error_code=case when dispatched_at is null then 'processing_interrupted' else 'provider_outcome_unknown' end,
      lease_until=null,source_snapshot=null,updated_at=now() where kind='summary' and state='running' and lease_until<now() returning id,dispatched_at
  ) update summary_usage set outcome=case when e.dispatched_at is null then 'interrupted' else 'unknown' end,reserved_tokens=case when e.dispatched_at is null then 0 else reserved_tokens end from expired e where job_id=e.id`);
  await db.execute(sql`with stopped as (
    update item_jobs j set state='cancelled',error_code='access_revoked',lease_until=null,source_snapshot=null,updated_at=now()
    where j.kind='summary' and j.state in ('queued','running') and (
      exists(select 1 from users u where u.id=j.user_id and u.suspended_at is not null)
      or exists(select 1 from resources r where r.id=j.resource_id and r.deleted_at is not null)
      or (j.key_id is not null and not exists(select 1 from api_keys k where k.id=j.key_id and k.user_id=j.user_id and k.scope='write' and (k.expires_at is null or k.expires_at>now())))
    ) returning id,dispatched_at
  ) update summary_usage set outcome='access_revoked',reserved_tokens=case when s.dispatched_at is null then 0 else reserved_tokens end from stopped s where job_id=s.id`);
  const claimed = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(78134926)`);
    const busy = await tx.execute(sql`select id from item_jobs where kind='summary' and state='running' and lease_until>now() limit 1`);
    if (busy.rows.length) return { rows: [] };
    return tx.execute(sql`with candidate as (select id from item_jobs where kind='summary' and state='queued' and run_after<=now() order by created_at,id for update skip locked limit 1)
      update item_jobs set state='running',attempts=attempts+1,lease_until=now()+interval '3 minutes',updated_at=now() where id in(select id from candidate) returning *`);
  });
  const job = claimed.rows[0]; if (!job) return false;
  const controller = new AbortController(); let polling = false;
  const timer = setInterval(() => {
    if (polling) return; polling = true;
    void permitted(db,job).then(allowed=>{if(!allowed)controller.abort();}).catch(()=>controller.abort()).finally(()=>{polling=false;});
  },500); timer.unref();
  let completion: SummaryCompletion | undefined, snapshot: SummarySnapshot | undefined, hash: string | undefined;
  let failure: SummaryProviderError | undefined, dispatched = false;
  try {
    if (!await permitted(db,job)) throw new SummaryProviderError("access_revoked");
    const material = await source(db,String(job.user_id),String(job.resource_id),Number(job.source_revision));
    snapshot = material.snapshot; hash = material.hash;
    if (snapshot.kind === "link") {
      const revision = await db.transaction(async tx => {
        const active = await tx.execute(sql`select id from users where id=${job.user_id} and suspended_at is null for update`);
        if (!active.rows.length) throw new SummaryProviderError("access_revoked");
        const current = await tx.execute(sql`select source_revision,known_source_hash from resources where id=${job.resource_id} and user_id=${job.user_id} and deleted_at is null for update`);
        if (!current.rows.length || !await permitted(tx,job)) throw new SummaryProviderError("source_changed");
        const previous = current.rows[0], next = Number(previous.source_revision) + (previous.known_source_hash && previous.known_source_hash !== hash ? 1 : 0);
        await tx.execute(sql`update resources set known_source_hash=${hash!},source_revision=${next} where id=${job.resource_id}`);
        await tx.execute(sql`update item_jobs set source_revision=${next},source_hash=${hash!},updated_at=now() where id=${job.id} and state='running' and lease_until=${job.lease_until}`);
        return next;
      });
      job.source_revision = revision;
    }
    await provider.preflight(controller.signal);
    await db.transaction(async tx => {
      const active = await tx.execute(sql`select id from users where id=${job.user_id} and suspended_at is null for update`);
      if (!active.rows.length) throw new SummaryProviderError("access_revoked");
      const item = await tx.execute(sql`select id from resources where id=${job.resource_id} and user_id=${job.user_id} and deleted_at is null and source_revision=${job.source_revision} for update`);
      if (!item.rows.length || !await permitted(tx,job) || controller.signal.aborted) throw new SummaryProviderError("source_changed");
      const budget = await tx.execute(sql`select coalesce(sum(cost_usd),0) as cost,count(*) filter(where outcome='budget_violation')::int as violations from summary_usage where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'`);
      if (Number(budget.rows[0].cost) > 0 || Number(budget.rows[0].violations) > 0) throw new SummaryProviderError("provider_budget_locked");
      const updated = await tx.execute(sql`update item_jobs set dispatched_at=now(),source_hash=${hash!},source_snapshot=${JSON.stringify(snapshot)},updated_at=now() where id=${job.id} and state='running' and lease_until=${job.lease_until} returning id`);
      if (!updated.rows.length) throw new SummaryProviderError("generation_cancelled");
    });
    dispatched = true;
    completion = await provider.generate(snapshot,controller.signal);
  } catch (e) {
    failure = e instanceof SummaryProviderError ? e : new SummaryProviderError(e instanceof Error && ["source_changed", "source_unavailable"].includes(e.message) ? e.message : dispatched ? "provider_outcome_unknown" : "source_unavailable", dispatched);
  } finally { clearInterval(timer); }
  const usage = completion || failure?.usage;
  // Usage metadata survives deletion; no content is retained here.
  await db.execute(sql`update summary_usage set actual_tokens=${usage?.tokens ?? null},cost_usd=${usage?.cost ?? 0},
    reserved_tokens=${usage?.tokens ?? (dispatched ? 60000 : 0)},outcome=${completion ? "completed" : failure?.code === "provider_budget_violation" ? "budget_violation" : failure?.ambiguous ? "unknown" : "failed"} where job_id=${job.id}`);
  await db.transaction(async tx => {
    const active = await tx.execute(sql`select id from users where id=${job.user_id} and suspended_at is null for update`);
    const item = active.rows.length ? await tx.execute(sql`select source_revision,deleted_at from resources where id=${job.resource_id} and user_id=${job.user_id} for update`) : { rows: [] };
    const current = await tx.execute(sql`select state from item_jobs where id=${job.id} and state='running' and lease_until=${job.lease_until} for update`);
    if (!current.rows.length) return;
    if (!active.rows.length || !item.rows.length || item.rows[0].deleted_at || !await permitted(tx,job,false)) {
      await tx.execute(sql`update item_jobs set state='cancelled',error_code='access_revoked',source_snapshot=null,lease_until=null,updated_at=now() where id=${job.id}`); return;
    }
    if (Number(item.rows[0].source_revision) !== Number(job.source_revision)) failure = new SummaryProviderError("source_changed");
    if (completion && !failure) {
      await tx.execute(sql`insert into item_summaries(resource_id,user_id,source_revision,source_hash,source_snapshot,result,model,prompt_version)
        values(${job.resource_id},${job.user_id},${job.source_revision},${hash!},${JSON.stringify(snapshot)}::jsonb,${JSON.stringify(completion.result)}::jsonb,${completion.model},'stash-summary-v3')
        on conflict(resource_id) do update set source_revision=excluded.source_revision,source_hash=excluded.source_hash,source_snapshot=excluded.source_snapshot,result=excluded.result,model=excluded.model,prompt_version=excluded.prompt_version,imported_at=null,created_at=now()`);
      await tx.execute(sql`update item_jobs set state='succeeded',source_snapshot=null,lease_until=null,updated_at=now() where id=${job.id}`);
    } else {
      await tx.execute(sql`update item_jobs set state=${failure?.ambiguous ? "unknown" : "failed"},error_code=${failure?.code || "generation_failed"},source_snapshot=null,lease_until=null,updated_at=now() where id=${job.id}`);
    }
  });
  return true;
}
export function registerSummaryWorker(app: FastifyInstance, db: Database, provider: SummaryProvider) {
  let running: Promise<unknown> | undefined, closing = false;
  const run = () => {
    if (closing || running) return;
    running = processSummaryJob(db,provider).catch(()=>app.log.error("Summary maintenance failed; pending jobs will recover.")).finally(()=>{running=undefined;});
  };
  const timer = setInterval(run,5000); timer.unref();
  app.addHook("onReady",async()=>{run();});
  app.addHook("onClose",async()=>{closing=true;clearInterval(timer);await running;});
}
