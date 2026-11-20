import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";
import { todoReminderActionInput, todoReminderScheduleInput } from "@stash/shared";
import { AppError } from "./index.js";

const stamp=(value:unknown)=>value instanceof Date?value.toISOString():value==null?null:String(value);
export function todoReminderService(db:Database,userId:string,options:{emailEnabled:boolean}){
  async function active(tx:Database){const result=await tx.execute(sql`select id from users where id=${userId} and suspended_at is null for update`);if(!result.rows.length)throw new AppError(403,"This account is unavailable.");}
  async function getPreferences(tx:Database=db){const result=await tx.execute(sql`select p.timezone,p.email_reminders as "emailReminders",p.in_app_reminders as "inAppReminders",u.email_verified_at as "emailVerifiedAt" from users u left join todo_preferences p on p.user_id=u.id where u.id=${userId}`);const row=result.rows[0];return{timezone:row?.timezone||"UTC",emailReminders:!!row?.emailReminders,inAppReminders:row?.inAppReminders!==false,emailVerified:!!row?.emailVerifiedAt};}
  return {
    async schedule(todoId:string,raw:unknown){
      const input=todoReminderScheduleInput.parse(raw),scheduledAt=new Date(input.scheduledAt);
      if(scheduledAt.getTime()<=Date.now())throw new AppError(400,"Choose a reminder time in the future.");
      const fingerprint=createHash("sha256").update(JSON.stringify({todoId,scheduledAt:scheduledAt.toISOString(),channels:[...input.channels].sort()})).digest("hex");
      return db.transaction(async tx=>{
        await active(tx);
        const prior=await tx.execute(sql`select fingerprint,result from todo_requests where user_id=${userId} and request_id=${input.requestId}`);
        if(prior.rows.length){if(prior.rows[0].fingerprint!==fingerprint)throw new AppError(409,"This request ID was already used for a different action.");return prior.rows[0].result;}
        const task=await tx.execute(sql`select t.id,t.title,t.project_id as "projectId",t.state,t.trashed_at as "trashedAt",p.archived_at as "archivedAt" from todos t left join projects p on p.id=t.project_id and p.user_id=t.user_id where t.id=${todoId} and t.user_id=${userId} for update of t`),row=task.rows[0];
        if(!row)throw new AppError(404,"Task not found.");if(row.trashedAt||row.state==="done")throw new AppError(409,"Restore or reopen this task before scheduling a reminder.");if(row.archivedAt)throw new AppError(409,"Reopen this project before scheduling reminders.");
        const pending=await tx.execute(sql`select count(*)::int as count from todo_reminders where user_id=${userId} and todo_id=${todoId} and status in ('pending','sending')`);
        if(Number(pending.rows[0].count)+input.channels.length>20)throw new AppError(409,"A task can have up to 20 pending reminders.");
        const prefs=await getPreferences(tx);
        if(input.channels.includes("in_app")&&!prefs.inAppReminders)throw new AppError(409,"In-app reminders are turned off in your Todo settings.");
        if(input.channels.includes("email")){if(!options.emailEnabled)throw new AppError(409,"Email delivery is not configured.");if(!prefs.emailReminders)throw new AppError(409,"Turn on email reminders in your Todo settings first.");if(!prefs.emailVerified)throw new AppError(409,"Verify your email address before scheduling email reminders.");}
        const inserted=[];
        for(const channel of input.channels){
          const key=createHash("sha256").update(`${userId}:${input.requestId}:${channel}`).digest("hex");
          const result=await tx.execute(sql`insert into todo_reminders(user_id,todo_id,channel,status,scheduled_at,idempotency_key) values(${userId},${todoId},${channel},'pending',${scheduledAt},${key}) returning id,channel,status,scheduled_at as "scheduledAt",created_at as "createdAt"`);
          inserted.push({...result.rows[0],scheduledAt:stamp(result.rows[0].scheduledAt),createdAt:stamp(result.rows[0].createdAt)});
        }
        const response={reminders:inserted};
        await tx.execute(sql`insert into todo_requests(user_id,request_id,action,fingerprint,todo_id,result) values(${userId},${input.requestId},'reminder_schedule',${fingerprint},${todoId},${JSON.stringify(response)}::jsonb)`);
        return response;
      });
    },
    async list(options:{unreadOnly?:boolean;limit?:number}={}){
      const limit=Math.min(100,Math.max(1,options.limit??50));
      const result=await db.execute(sql`select r.id,r.todo_id as "todoId",r.channel,r.status,r.scheduled_at as "scheduledAt",r.sent_at as "sentAt",r.read_at as "readAt",r.dismissed_at as "dismissedAt",t.title,t.project_id as "projectId",r.created_at as "createdAt" from todo_reminders r join todos t on t.id=r.todo_id and t.user_id=r.user_id where r.user_id=${userId} and r.channel='in_app' and r.status in ('sent','read','dismissed','missed') and (${options.unreadOnly!==true} or r.status in ('sent','missed')) order by coalesce(r.sent_at,r.scheduled_at) desc,r.id desc limit ${limit}`);
      return result.rows.map((row:Record<string,any>)=>({...row,scheduledAt:stamp(row.scheduledAt),sentAt:stamp(row.sentAt),readAt:stamp(row.readAt),dismissedAt:stamp(row.dismissedAt),createdAt:stamp(row.createdAt)}));
    },
    async act(id:string,raw:unknown){
      const input=todoReminderActionInput.parse(raw),scheduledAt=input.action==="snooze"?new Date(input.scheduledAt):null;
      if(scheduledAt&&scheduledAt.getTime()<=Date.now())throw new AppError(400,"Choose a snooze time in the future.");
      return db.transaction(async tx=>{
        await active(tx);
        const result=await tx.execute(sql`select r.*,t.project_id as "projectId",t.trashed_at as "trashedAt",t.state,p.archived_at as "archivedAt" from todo_reminders r join todos t on t.id=r.todo_id and t.user_id=r.user_id left join projects p on p.id=t.project_id and p.user_id=t.user_id where r.id=${id} and r.user_id=${userId} and r.channel='in_app' for update of r,t`),row=result.rows[0];
        if(!row)throw new AppError(404,"Reminder not found.");
        if(input.action==="snooze"){
          if(row.status!=="sent"&&row.status!=="missed")throw new AppError(409,"Only an unread reminder can be snoozed.");
          if(row.trashedAt||row.state==="done"||row.archivedAt)throw new AppError(409,"This task is no longer eligible for reminders.");
          await tx.execute(sql`update todo_reminders set status='pending',scheduled_at=${scheduledAt},sent_at=null,read_at=null,dismissed_at=null,lease_until=null,last_error=null,updated_at=now() where id=${id} and user_id=${userId}`);
        }else{
          if(row.status!=="sent"&&row.status!=="missed"&&row.status!=="read"&&row.status!=="dismissed")throw new AppError(409,"This reminder is not available in the inbox.");
          await tx.execute(sql`update todo_reminders set status=${input.action==='read'?'read':'dismissed'},read_at=${input.action==='read'?new Date():row.read_at},dismissed_at=${input.action==='dismiss'?new Date():row.dismissed_at},updated_at=now() where id=${id} and user_id=${userId}`);
        }
        return {id,action:input.action,scheduledAt:scheduledAt?.toISOString()??stamp(row.scheduled_at)};
      });
    },
  };
}
