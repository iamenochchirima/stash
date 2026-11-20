import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";
import type { Mailer } from "./mail.js";

const DAY=24*60*60_000;
export async function processTodoReminder(db:Database,mailer:Mailer,webOrigin:string,options:{emailEnabled:boolean;now?:Date}){
  const now=options.now||new Date(),cutoff=new Date(now.getTime()-DAY),retryAt=new Date(now.getTime()+60_000);
  await db.execute(sql`update todo_reminders r set status='cancelled',lease_until=null,updated_at=now() where r.status in ('pending','sending') and (
    not exists(select 1 from users u where u.id=r.user_id and u.suspended_at is null)
    or not exists(select 1 from todos t where t.id=r.todo_id and t.user_id=r.user_id and t.state<>'done' and t.trashed_at is null and (t.project_id is null or exists(select 1 from projects p where p.id=t.project_id and p.user_id=t.user_id and p.archived_at is null)))
    or (r.channel='in_app' and exists(select 1 from todo_preferences pref where pref.user_id=r.user_id and not pref.in_app_reminders))
    or (r.channel='email' and (not ${options.emailEnabled} or not exists(select 1 from todo_preferences pref where pref.user_id=r.user_id and pref.email_reminders) or not exists(select 1 from users u where u.id=r.user_id and u.email_verified_at is not null)))
  )`);
  await db.execute(sql`update todo_reminders set status=case when attempts>=3 then 'failed' else 'pending' end,scheduled_at=case when attempts>=3 then scheduled_at else ${retryAt} end,lease_until=null,last_error=case when attempts>=3 then 'email_delivery_failed' else null end,updated_at=now() where channel='email' and status='sending' and lease_until<now()`);
  await db.execute(sql`update todo_reminders set status='missed',lease_until=null,last_error=null,updated_at=now() where status='pending' and scheduled_at<${cutoff}`);
  await db.execute(sql`update todo_reminders set status='sent',sent_at=now(),lease_until=null,updated_at=now() where channel='in_app' and status='pending' and scheduled_at<=${now} and scheduled_at>=${cutoff}`);
  const claimed=await db.execute(sql`with candidate as (
    select r.id from todo_reminders r where r.channel='email' and r.scheduled_at<=${now} and r.status='pending' order by r.scheduled_at,r.id for update skip locked limit 1
  ) update todo_reminders r set status='sending',attempts=attempts+1,lease_until=now()+interval '2 minutes',updated_at=now() from candidate c,users u where r.id=c.id and u.id=r.user_id and u.suspended_at is null and u.email_verified_at is not null returning r.id,r.todo_id as "todoId",r.user_id as "userId",r.lease_until as "leaseUntil",r.attempts,u.email`);
  const job=claimed.rows[0];if(!job)return false;
  // Recheck every mutable permission immediately before the external delivery.
  const allowed=await db.execute(sql`select r.id from todo_reminders r join users u on u.id=r.user_id join todos t on t.id=r.todo_id and t.user_id=r.user_id left join todo_preferences pref on pref.user_id=r.user_id left join projects p on p.id=t.project_id and p.user_id=t.user_id where r.id=${job.id} and r.status='sending' and r.lease_until=${job.leaseUntil} and u.suspended_at is null and u.email_verified_at is not null and pref.email_reminders and t.state<>'done' and t.trashed_at is null and (p.id is null or p.archived_at is null)`);
  if(!allowed.rows.length){await db.execute(sql`update todo_reminders set status='cancelled',lease_until=null,updated_at=now() where id=${job.id} and status='sending' and lease_until=${job.leaseUntil}`);return true;}
  try{
    await mailer.send({to:String(job.email),subject:"A Stash task reminder",text:`You asked Stash to remind you about a task. Sign in to view it: ${webOrigin}/todos?taskId=${encodeURIComponent(String(job.todoId))}`,idempotencyKey:`stash-todo-reminder-${job.id}`});
    await db.execute(sql`update todo_reminders set status='sent',sent_at=now(),lease_until=null,last_error=null,updated_at=now() where id=${job.id} and status='sending' and lease_until=${job.leaseUntil}`);
  }catch{
    await db.execute(sql`update todo_reminders set status=case when attempts>=3 then 'failed' else 'pending' end,scheduled_at=case when attempts>=3 then scheduled_at else ${retryAt} end,lease_until=null,last_error='email_delivery_failed',updated_at=now() where id=${job.id} and status='sending' and lease_until=${job.leaseUntil}`);
  }
  return true;
}

export function registerTodoReminderWorker(app:FastifyInstance,db:Database,mailer:Mailer,options:{webOrigin:string;emailEnabled:boolean}){
  let running:Promise<unknown>|undefined,closing=false;
  const run=()=>{if(closing||running)return;running=processTodoReminder(db,mailer,options.webOrigin,options).catch(()=>app.log.error("Todo reminder maintenance failed; due reminders will recover." )).finally(()=>{running=undefined;});};
  const timer=setInterval(run,30_000);timer.unref();app.addHook("onReady",async()=>run());app.addHook("onClose",async()=>{closing=true;clearInterval(timer);await running;});
}
