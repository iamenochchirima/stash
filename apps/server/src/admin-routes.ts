import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { users, apiKeys, adminUsers, adminSessions, adminInvites, adminAudit, adminEmailJobs, type Database } from "@stash/db";
import { AppError } from "@stash/core";
import { registerAdminAuth, adminProfile, inviteAdmin, audit, type AdminOptions, type AdminRole } from "./admin-auth.js";
import { revokeCustomerAccess, deleteCustomer, prepareAccountEmail } from "./account-lifecycle.js";
import { maintainAdmin } from "./admin-maintenance.js";
import { deliverAdminEmail, deliverPendingAdminEmails } from "./admin-mail.js";
import type { DeletionJournal } from "./deletions.js";
import { email, adminMutation, adminActionLabels } from "@stash/shared";

const listInput = z.object({ q: z.string().trim().max(100).default(""), limit: z.coerce.number().int().min(1).max(50).default(25), offset: z.coerce.number().int().min(0).max(1000000).default(0) });
const mutation = adminMutation;
const idOf = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
async function rows<T = Record<string, any>>(db: Database, query: SQL) { return (await db.execute(query)).rows as T[]; }
const userColumns = sql`u.id, u.email, u.name, u.email_verified_at AS "emailVerifiedAt", u.suspended_at AS "suspendedAt", u.suspension_reason AS "suspensionReason", u.created_at AS "createdAt", u.last_active_at AS "lastActiveAt", (select count(*)::int from resources r where r.user_id=u.id) AS "resourceCount", (select count(*)::int from api_keys k where k.user_id=u.id) AS "connectionCount"`;
const connectionColumns = sql`k.id, k.name, k.scope, k.created_at AS "createdAt", k.last_used_at AS "lastUsedAt", k.expires_at AS "accessExpiresAt", u.id AS "userId", u.email AS "userEmail", u.name AS "userName", CASE WHEN k.oauth_client_id IS NULL THEN 'key' ELSE 'oauth' END AS authentication, CASE WHEN u.suspended_at IS NOT NULL THEN 'suspended' WHEN k.oauth_client_id IS NULL THEN CASE WHEN k.expires_at IS NULL OR k.expires_at>now() THEN 'active' ELSE 'expired' END ELSE CASE WHEN EXISTS(select 1 from oauth_refresh_tokens t where t.key_id=k.id and t.used_at IS NULL and t.expires_at>now()) THEN 'active' ELSE 'expired' END END AS state`;

export function registerAdminRoutes(app: FastifyInstance, db: Database, options: AdminOptions & { journal: DeletionJournal; consumerOrigin: string; storageConfigured?: boolean; summariesConfigured?: boolean }) {
  const authentication = registerAdminAuth(app, db, options), consumerOrigin = options.consumerOrigin;
  let deliveryPromise: Promise<void> | undefined;
  const deliveryTimer = setInterval(() => {
    if (deliveryPromise) return;
    deliveryPromise = deliverPendingAdminEmails(db,options)
      .catch(() => { app.log.warn({event:"admin_email_worker_failed"},"Admin email delivery will retry"); })
      .finally(() => { deliveryPromise=undefined; });
  },30_000);
  deliveryTimer.unref();
  let maintenancePromise: Promise<void> | undefined;
  const maintenance = () => {
    if (maintenancePromise) return;
    maintenancePromise=maintainAdmin(db).catch(()=>{app.log.warn({event:"admin_retention_failed"},"Admin retention maintenance will retry");}).finally(()=>{maintenancePromise=undefined;});
  };
  const maintenanceTimer=setInterval(maintenance,24*60*60_000);maintenanceTimer.unref();
  app.addHook("onReady",async()=>{maintenance();await maintenancePromise;});
  app.addHook("onClose",async()=>{clearInterval(deliveryTimer);clearInterval(maintenanceTimer);await deliveryPromise;await maintenancePromise;});
  async function change(request: FastifyRequest, minimum: AdminRole, action: string, targetId: string, input: z.infer<typeof mutation>, work: (tx: Database, actor: typeof adminUsers.$inferSelect) => Promise<Record<string, unknown>>) {
    let actorId: string | undefined;
    try {
      return await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(61320491)`);
        const actor = (await authentication.authorize(request, minimum, true, tx, true)).user; actorId = actor.id;
        const [previous] = await tx.select().from(adminAudit).where(and(eq(adminAudit.actorId,actor.id),eq(adminAudit.operationId,input.operationId)));
        if (previous) {
          if (previous.action!==action || previous.targetId!==targetId || previous.reason!==input.reason) throw new AppError(409,"This operation identifier was already used for a different action.");
          return { ok:true, repeated:true, changes:previous.changes };
        }
        const changes = await work(tx,actor);
        await audit(tx,{ actorId:actor.id,action,targetId,reason:input.reason,outcome:"success",operationId:input.operationId,changes });
        return { ok:true, changes };
      });
    } catch (error) {
      if (actorId) {
        try { await audit(db,{ actorId,action,targetId,reason:"Administrative action was rejected or failed",outcome:"failed" }); } catch { /* An unavailable audit store still prevents the mutation. */ }
      }
      throw error;
    }
  }
  app.get("/admin-api/overview",async request=>{
    await authentication.authorize(request);
    const days=z.object({days:z.coerce.number().pipe(z.union([z.literal(7),z.literal(30)])).default(7)}).parse(request.query).days;
    const [metrics]=await rows(db,sql`select (select count(*)::int from users) AS users, (select count(*)::int from users where created_at>now()-${days}*interval '1 day') AS "newUsers", (select count(*)::int from users where last_active_at>now()-${days}*interval '1 day') AS "activeUsers", (select count(*)::int from users where suspended_at IS NOT NULL) AS "suspendedUsers", (select count(*)::int from resources) AS resources, (select count(distinct k.user_id)::int from api_keys k join users u on u.id=k.user_id where u.suspended_at IS NULL and ((k.oauth_client_id IS NULL and (k.expires_at IS NULL or k.expires_at>now())) or (k.oauth_client_id IS NOT NULL and exists(select 1 from oauth_refresh_tokens t where t.key_id=k.id and t.used_at IS NULL and t.expires_at>now())))) AS "connectedAccounts"`);
    const [counts] = await rows(db,sql`select count(*) filter(where kind='link')::int as links,count(*) filter(where kind='note')::int as notes,count(*) filter(where kind='idea')::int as ideas,count(*) filter(where kind='pdf')::int as pdfs,
      count(*) filter(where deleted_at is null and archived_at is null)::int as active,count(*) filter(where deleted_at is null and archived_at is not null)::int as archived,count(*) filter(where deleted_at is not null)::int as trash from resources`);
    const [files] = await rows(db,sql`select coalesce(sum(byte_size),0)::bigint as "storedBytes",count(*) filter(where state in ('queued','processing','uploading','pending'))::int as "pdfPending",count(*) filter(where state='failed')::int as "pdfFailed" from attachments`);
    const [jobs] = await rows(db,sql`select count(*) filter(where state in ('queued','running'))::int as "summaryPending",count(*) filter(where state in ('failed','unknown') and updated_at>now()-interval '1 day')::int as "summaryFailed" from item_jobs where kind='summary'`);
    const [usage] = await rows(db,sql`select count(*) filter(where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')::int as "summaryRequestsToday",coalesce(sum(coalesce(actual_tokens,reserved_tokens)) filter(where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0)::bigint as "summaryTokensToday",coalesce(sum(cost_usd),0) as "summaryCostMonth" from summary_usage where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'`);
    const library = { ...counts, ...files, ...jobs, ...usage, storedBytes: Number(files.storedBytes), summaryTokensToday: Number(usage.summaryTokensToday), summaryCostMonth: Number(usage.summaryCostMonth) };
    return { metrics, days, library, health:{storage:options.storageConfigured?"configured":"unconfigured",summaries:options.summariesConfigured?"configured":"unconfigured",api:"ready",database:"ready",email:options.emailDisabled?"disabled":"configured",backups:"unconfigured",alerts:"unconfigured",checkedAt:new Date()} };
  });
  app.get("/admin-api/users",async request=>{
    await authentication.authorize(request);
    const input=listInput.extend({state:z.enum(["all","active","suspended"]).default("all"),verified:z.enum(["all","yes","no"]).default("all")}).parse(request.query);
    const q=`%${input.q}%`, where=sql`(u.name ILIKE ${q} OR u.email ILIKE ${q}) AND (${input.state}='all' OR (${input.state}='suspended' AND u.suspended_at IS NOT NULL) OR (${input.state}='active' AND u.suspended_at IS NULL)) AND (${input.verified}='all' OR (${input.verified}='yes' AND u.email_verified_at IS NOT NULL) OR (${input.verified}='no' AND u.email_verified_at IS NULL))`;
    const [count]=await rows(db,sql`select count(*)::int AS total from users u where ${where}`);
    return {items:await rows(db,sql`select ${userColumns} from users u where ${where} order by u.created_at desc,u.id desc limit ${input.limit} offset ${input.offset}`),total:count.total};
  });
  app.get("/admin-api/users/:id",async request=>{
    await authentication.authorize(request);const id=idOf(request.params);
    const [user]=await rows(db,sql`select ${userColumns} from users u where u.id=${id}`);
    if(!user)throw new AppError(404,"Account not found.");
    return {user};
  });
  app.get("/admin-api/connections",async request=>{
    await authentication.authorize(request);
    const input=listInput.extend({userId:z.string().uuid().optional(),authentication:z.enum(["all","key","oauth"]).default("all")}).parse(request.query);
    const q=`%${input.q}%`, where=sql`(k.name ILIKE ${q} OR u.email ILIKE ${q}) AND (${input.userId||null}::uuid IS NULL OR k.user_id=${input.userId||null}::uuid) AND (${input.authentication}='all' OR (${input.authentication}='key' AND k.oauth_client_id IS NULL) OR (${input.authentication}='oauth' AND k.oauth_client_id IS NOT NULL))`;
    const [count]=await rows(db,sql`select count(*)::int AS total from api_keys k join users u on u.id=k.user_id where ${where}`);
    return {items:await rows(db,sql`select ${connectionColumns} from api_keys k join users u on u.id=k.user_id where ${where} order by k.created_at desc,k.id desc limit ${input.limit} offset ${input.offset}`),total:count.total};
  });
  app.get("/admin-api/activity",async request=>{
    await authentication.authorize(request);
    const input=listInput.extend({targetId:z.string().max(100).optional(),outcome:z.enum(["all","success","failed"]).default("all")}).parse(request.query);
    const matchedActions=Object.entries(adminActionLabels).filter(([,label])=>label.toLowerCase().includes(input.q.toLowerCase())).map(([action])=>action);
    const aliases=matchedActions.length?sql`a.action IN (${sql.join(matchedActions.map(action=>sql`${action}`),sql`,`)})`:sql`false`;
    const joins=sql`from admin_audit a left join admin_users i on i.id=a.actor_id left join users u on u.id::text=CASE WHEN a.action='connection.revoke' THEN a.changes->>'userId' ELSE a.target_id END left join admin_users t on t.id::text=a.target_id left join admin_invites v on v.id::text=a.target_id`;
    const q=`%${input.q}%`,where=sql`(a.action ILIKE ${q} OR a.reason ILIKE ${q} OR i.name ILIKE ${q} OR u.name ILIKE ${q} OR u.email ILIKE ${q} OR t.name ILIKE ${q} OR v.name ILIKE ${q} OR ${aliases}) AND (${input.targetId||null}::text IS NULL OR (a.target_id=${input.targetId||null} OR (a.action='connection.revoke' AND a.changes->>'userId'=${input.targetId||null}))) AND (${input.outcome}='all' OR a.outcome=${input.outcome})`;
    const [count]=await rows(db,sql`select count(*)::int AS total ${joins} where ${where}`);
    return {items:await rows(db,sql`select a.id,a.action,a.reason,a.outcome,a.changes,a.target_id AS "targetId",a.created_at AS "createdAt",coalesce(i.name,'System') AS actor,coalesce(u.name,t.name,v.name,CASE WHEN a.action LIKE 'user.%' OR a.action='connection.revoke' THEN 'Deleted or unavailable account' ELSE 'Unavailable target' END) AS "targetName",CASE WHEN u.id IS NOT NULL THEN 'user' WHEN t.id IS NOT NULL THEN 'admin' ELSE 'unavailable' END AS "targetKind" ${joins} where ${where} order by a.created_at desc,a.id desc limit ${input.limit} offset ${input.offset}`),total:count.total};
  });

  app.post("/admin-api/users/:id/actions",async request=>{
    const id=idOf(request.params),input=mutation.extend({action:z.enum(["suspend","restore","signout","disconnect","delete"])}).parse(request.body);
    if (input.action === "delete") {
      // Commit an authorised deletion intent before writing the durable journal.
      // A later transaction failure must not leave an unaudited journal intent.
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(61320491)`);
        const actor = (await authentication.authorize(request,"owner",true,tx,true)).user;
        const [done] = await tx.select({ id:adminAudit.id }).from(adminAudit).where(and(eq(adminAudit.actorId,actor.id),eq(adminAudit.operationId,input.operationId)));
        if (done) return;
        const [user] = await tx.select().from(users).where(eq(users.id,id)).for("update");
        if (!user) throw new AppError(404,"Account not found.");
        if (input.confirmation !== user.email) throw new AppError(400,"Enter the account's email to confirm.");
        const [intent] = await tx.select({ id:adminAudit.id }).from(adminAudit).where(and(eq(adminAudit.actorId,actor.id),eq(adminAudit.action,"user.delete.requested"),sql`${adminAudit.changes}->>'operationId'=${input.operationId}`));
        if (!intent) await audit(tx,{ actorId:actor.id,targetId:id,action:"user.delete.requested",reason:input.reason,outcome:"success",changes:{operationId:input.operationId} });
      });
    }
    return change(request,input.action==="delete"?"owner":"operator",`user.${input.action}`,id,input,async(tx)=>{
      const [user]=await tx.select().from(users).where(eq(users.id,id)).for("update");
      if(!user)throw new AppError(404,"Account not found.");
      if(input.confirmation!==user.email)throw new AppError(400,"Enter the account's email to confirm.");
      if(input.action==="suspend") {await tx.update(users).set({suspendedAt:new Date(),suspensionReason:input.reason}).where(eq(users.id,id));await revokeCustomerAccess(tx,id);}
      if(input.action==="restore") await tx.update(users).set({suspendedAt:null,suspensionReason:null}).where(eq(users.id,id));
      if(input.action==="signout") await revokeCustomerAccess(tx,id,"sessions");
      if(input.action==="disconnect") await revokeCustomerAccess(tx,id,"agents");
      if(input.action==="delete") await deleteCustomer(tx,id,options.journal);
      return {state:input.action==="suspend"?"suspended":input.action==="restore"?"active":input.action};
    });
  });
  app.post("/admin-api/users/:id/email",async request=>{
    const id=idOf(request.params),input=mutation.extend({purpose:z.enum(["verify","reset"])}).parse(request.body);
    const result=await change(request,"operator",`user.email.${input.purpose}.requested`,id,input,async(tx,actor)=>{
      const [user]=await tx.select().from(users).where(eq(users.id,id)).for("update");
      if(!user)throw new AppError(404,"Account not found.");
      if(input.confirmation!==user.email)throw new AppError(400,"Enter the account's email to confirm.");
      if(input.purpose==="verify"&&user.emailVerifiedAt)throw new AppError(409,"This account is already verified.");
      const [recent]=await rows(tx,sql`select id from admin_email_jobs where user_id=${id} and purpose=${input.purpose} and status IN ('pending','sent') and created_at>now()-interval '5 minutes' limit 1`);
      if(recent)throw new AppError(429,"Wait five minutes before sending another email of this type.");
      const prepared=await prepareAccountEmail(tx,user,input.purpose,{origin:consumerOrigin,emailDisabled:options.emailDisabled});
      const [job]=await tx.insert(adminEmailJobs).values({actorId:actor.id,userId:id,purpose:input.purpose,payload:authentication.cipher.encrypt(JSON.stringify(prepared))}).returning({id:adminEmailJobs.id});
      return {jobId:job.id};
    });
    const status=await deliverAdminEmail(db,options,result.changes.jobId as string);
    if(status!=="sent")throw new AppError(503,status==="pending"?"Email delivery failed. A bounded retry is pending; you can retry this request.":"Email could not be sent. Please close this action and try again later.");
    return {ok:true};
  });
  app.post("/admin-api/connections/:id/revoke",async request=>{
    const id=idOf(request.params),input=mutation.parse(request.body);
    return change(request,"operator","connection.revoke",id,input,async(tx)=>{
      const [candidate]=await tx.select({userId:apiKeys.userId}).from(apiKeys).where(eq(apiKeys.id,id));
      if(!candidate)throw new AppError(404,"Connection not found.");
      await tx.select({id:users.id}).from(users).where(eq(users.id,candidate.userId)).for("update");
      const [key]=await tx.select().from(apiKeys).where(eq(apiKeys.id,id)).for("update");
      if(!key)throw new AppError(404,"Connection not found.");
      if(input.confirmation!==key.name)throw new AppError(400,"Enter the connection name to confirm.");
      await tx.delete(apiKeys).where(eq(apiKeys.id,id));return {userId:key.userId};
    });
  });
  app.get("/admin-api/admins",async request=>{
    await authentication.authorize(request,"owner");
    const input=listInput.extend({inviteOffset:z.coerce.number().int().min(0).max(1000000).default(0)}).parse(request.query),q=`%${input.q}%`;
    const where=sql`${adminUsers.name} ILIKE ${q} OR ${adminUsers.email} ILIKE ${q}`;
    const [count]=await db.select({total:sql<number>`count(*)::int`}).from(adminUsers).where(where);
    const inviteWhere=sql`expires_at>now() AND (email ILIKE ${q} OR name ILIKE ${q})`;
    const [inviteCount]=await rows(db,sql`select count(*)::int AS total from admin_invites where ${inviteWhere}`);
    return {items:(await db.select().from(adminUsers).where(where).orderBy(adminUsers.createdAt,adminUsers.id).limit(input.limit).offset(input.offset)).map(adminProfile),total:count.total,
      invites:await rows(db,sql`select email,name,role,expires_at AS "expiresAt" from admin_invites where ${inviteWhere} order by created_at desc,id desc limit ${input.limit} offset ${input.inviteOffset}`),inviteTotal:inviteCount.total};
  });
  app.post("/admin-api/admins/invite",{bodyLimit:8192,config:{rateLimit:{max:10,timeWindow:"1 hour"}}},async request=>{
    const actor=(await authentication.authorize(request,"owner",true)).user;
    const input=z.object({email,name:z.string().trim().min(1).max(100),role:z.enum(["operator","viewer"]),reason:z.string().trim().min(5).max(300)}).parse(request.body);
    return inviteAdmin(db,options,{...input,invitedBy:actor.id});
  });
  app.post("/admin-api/admins/:id/actions",async request=>{
    const id=idOf(request.params),input=mutation.extend({action:z.enum(["role","disable","sessions"]),role:z.enum(["viewer","operator","owner"]).optional(),disabled:z.boolean().optional()}).parse(request.body);
    return change(request,"owner",`admin.${input.action}`,id,input,async(tx)=>{
      const [user]=await tx.select().from(adminUsers).where(eq(adminUsers.id,id)).for("update");
      if(!user)throw new AppError(404,"Administrator not found.");
      if(input.confirmation!==user.email)throw new AppError(400,"Enter the administrator's email to confirm.");
      if(user.role==="owner"&&!user.disabledAt&&!user.recoveryPendingAt&&((input.action==="disable"&&input.disabled!==false)||(input.action==="role"&&input.role!=="owner"))) {
        const [count]=await rows(tx,sql`select count(*)::int AS total from admin_users where role='owner' AND disabled_at IS NULL AND recovery_pending_at IS NULL`);
        if(count.total<=1)throw new AppError(409,"The final active owner cannot be removed.");
      }
      if(input.action==="role") {
        if(!input.role)throw new AppError(400,"Select a role.");
        await tx.update(adminUsers).set({role:input.role}).where(eq(adminUsers.id,id));
      }
      if(input.action==="disable")await tx.update(adminUsers).set({disabledAt:input.disabled===false?null:new Date()}).where(eq(adminUsers.id,id));
      await tx.delete(adminSessions).where(eq(adminSessions.adminId,id));
      if(input.action!=="sessions")await tx.delete(adminInvites).where(eq(adminInvites.invitedBy,id));
      return input.action==="role"?{role:input.role}:input.action==="disable"?{disabled:input.disabled!==false}:{sessionsRevoked:true};
    });
  });
  return authentication;
}
