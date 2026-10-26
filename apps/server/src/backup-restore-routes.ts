import type { FastifyInstance,FastifyRequest,FastifyReply } from "fastify";
import type { Database } from "@stash/db";
import { sql } from "drizzle-orm";
import { createHash,randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError,library,topicService } from "@stash/core";
import { importPortableItem } from "@stash/core/items-portability";
import { restoreProjects,finishProjectRestore } from "@stash/core/projects-portability";
import { BACKUP_LIMITS,backupManifest,portableItem,normalizeTopicName } from "@stash/shared";
import { auth,digest } from "./auth.js";
import { restoreContext,type RestoreContext } from "./backup-context.js";
import { originalRestoreTicket } from "./backup-originals.js";
const mime="application/vnd.stash.backup+json";
declare module "fastify" {interface FastifyRequest{backupRestore?:RestoreContext;backupRestoreDeadline?:ReturnType<typeof setTimeout>;}}
function bytes(request:FastifyRequest){if(!Buffer.isBuffer(request.body))throw new AppError(400,"Choose a valid backup file.");return request.body;}
function json(content:Buffer){try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(content));}catch{throw new AppError(400,"The backup contains invalid JSON.");}}
export async function finishBackupRestore(db:Database,hash:string){
 await db.transaction(async tx=>{
  const found=await tx.execute(sql`select user_id from backup_restores where token_hash=${hash}`);if(!found.rows.length)return;
  const userId=String(found.rows[0].user_id);await tx.execute(sql`select id from users where id=${userId} for update`);
  const result=await tx.execute(sql`select manifest,created_projects from backup_restores where token_hash=${hash} for update`);if(!result.rows.length)return;
  await tx.execute(sql`update resources target set project_source_id=source.id from backup_restore_items m,resources source where m.transfer_hash=${hash} and m.created and m.resource_id=target.id and m.source_origin_id is not null and target.user_id=${userId} and source.user_id=${userId} and target.project_id is null and source.project_id is not null and (source.id=m.source_origin_id or source.import_origin_id=m.source_origin_id) and target.project_source_id is null`);
  const manifest=result.rows[0].manifest as RestoreContext["manifest"];
  if(manifest)await finishProjectRestore(tx,userId,manifest.projects,result.rows[0].created_projects as string[]);
  await tx.execute(sql`delete from backup_restores where token_hash=${hash}`);
 });
}
export function registerBackupRestoreRoutes(app:FastifyInstance,db:Database,options:{production?:boolean;enabled:boolean;storageAvailable:boolean;publicApiUrl:string}){
 const authentication=auth(db,!!options.production);
 const available=()=>{if(!options.enabled)throw new AppError(503,"Backup restore is not available yet.");};
 app.post("/api/backups/restore",async req=>{
  available();const user=await authentication.user(req),{manifestHash}=z.object({manifestHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
  const token=randomBytes(32).toString("base64url"),hash=digest(token),session=digest(req.cookies.stash_session||"");
  await db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(78134929)`);
   await tx.execute(sql`select id from users where id=${user.id} and suspended_at is null for update`);
   const old=await tx.execute(sql`select token_hash,manifest_hash,busy_until,expires_at,created_at from backup_restores where user_id=${user.id} for update`),prior=old.rows[0];
   if(prior){
    const uploading=await tx.execute(sql`select id from attachments where user_id=${user.id} and state='uploading' and upload_expires_at>now() and capture_input->'restore'->>'transferHash'=${prior.token_hash} limit 1`);
    if(prior.busy_until&&new Date(String(prior.busy_until))>new Date()||uploading.rows.length)throw new AppError(429,"Your restore is still processing. Try again shortly.");
    if(prior.manifest_hash===manifestHash&&new Date(String(prior.expires_at))>new Date()&&new Date(String(prior.created_at)).getTime()>Date.now()-86400000){
     await tx.execute(sql`update backup_restores set token_hash=${hash},session_hash=${session},expires_at=least(created_at+interval '24 hours',now()+interval '30 minutes') where token_hash=${prior.token_hash}`);
     await tx.execute(sql`update attachments set capture_input=jsonb_set(capture_input,'{restore,transferHash}',to_jsonb(${hash}::text)),upload_token_hash=null,upload_expires_at=now() where user_id=${user.id} and resource_id is null and capture_input->'restore'->>'transferHash'=${prior.token_hash}`);
     return;
    }
    await finishBackupRestore(tx,String(prior.token_hash));
   }
   const total=await tx.execute(sql`select count(*)::int as n from backup_restores`);if(Number(total.rows[0].n)>=20)throw new AppError(429,"Restores are busy. Try again shortly.");
   await tx.execute(sql`insert into backup_restores(token_hash,user_id,session_hash,manifest_hash) values(${hash},${user.id},${session},${manifestHash})`);
  });
  return{token,restoreUrl:`${options.publicApiUrl}/backup-transfers/restore`};
 });
 app.addContentTypeParser(mime,{parseAs:"buffer",bodyLimit:BACKUP_LIMITS.itemBytes},(_req,body,done)=>done(null,body));
 const hooks={
  onRequest:async(req:FastifyRequest)=>{
   available();const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];if(!token)throw new AppError(401,"Restore permission has expired. Choose the backup again.");
   req.backupRestore=await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(78134928)`);
    const context=await restoreContext(tx,digest(token));
    const busy=await tx.execute(sql`select token_hash from backup_restores where busy_until>now() limit 1`);if(busy.rows.length)throw new AppError(429,"Another restore is processing. Try again shortly.");
    await tx.execute(sql`update backup_restores set busy_until=now()+interval '5 minutes',expires_at=least(created_at+interval '24 hours',now()+interval '30 minutes') where token_hash=${context.tokenHash}`);
    return context;
   });
   req.backupRestoreDeadline=setTimeout(()=>req.raw.destroy(),120000);req.backupRestoreDeadline.unref();
   req.raw.once("aborted",()=>clearTimeout(req.backupRestoreDeadline));
  },
  onSend:async(req:FastifyRequest,_reply:FastifyReply,payload:unknown)=>{clearTimeout(req.backupRestoreDeadline);if(req.backupRestore)await db.execute(sql`update backup_restores set busy_until=null where token_hash=${req.backupRestore.tokenHash}`);return payload;},
 };
 app.post("/backup-transfers/restore/manifest",{...hooks,bodyLimit:BACKUP_LIMITS.manifestBytes},async req=>{
  const context=req.backupRestore!,content=bytes(req);
  if(createHash("sha256").update(content).digest("hex")!==context.manifestHash)throw new AppError(400,"The backup index failed its checksum.");
  const manifest=backupManifest.parse(json(content));
  if(manifest.items.some(i=>i.original)&&!options.storageAvailable)throw new AppError(503,"Original-file storage is not connected. Try again later.");
  return db.transaction(async tx=>{
   await tx.execute(sql`select id from users where id=${context.userId} for update`);const fresh=await restoreContext(tx,context.tokenHash);
   if(fresh.manifest)return{ready:true,resumed:true};
   const created=await restoreProjects(tx,context.userId,manifest.projects),groups=library(tx,context.userId);
   for(const group of manifest.collections)if(!(await groups.collections()).some(c=>c.name===group.name))await groups.createCollection(group.name);
   for(const topic of manifest.topics)await topicService(tx,context.userId).ensure(topic);
   const retained={version:manifest.version,items:manifest.items,projects:manifest.projects,collections:manifest.collections,topics:manifest.topics};
   await tx.execute(sql`update backup_restores set manifest=${JSON.stringify(retained)}::jsonb,created_projects=${"{"+created.join(",")+"}"}::uuid[] where token_hash=${context.tokenHash}`);
   return{ready:true,resumed:false};
  });
 });
 app.post("/backup-transfers/restore/items/:id",{...hooks,bodyLimit:BACKUP_LIMITS.itemBytes},async req=>{
  const id=z.object({id:z.string().uuid()}).parse(req.params).id,context=req.backupRestore!,ref=context.manifest?.items.find(i=>i.id===id),content=bytes(req);
  if(!ref)throw new AppError(400,"The item is missing from the backup index.");
  if(createHash("sha256").update(content).digest("hex")!==ref.sha256)throw new AppError(400,"The item failed its backup checksum.");
  const rawItem=json(content);
  if((context.manifest?.version||2)===2&&rawItem&&typeof rawItem==="object"&&Object.hasOwn(rawItem,"topics"))throw new AppError(400,"Topics require a version 3 backup.");
  const item=portableItem.parse((context.manifest?.version||2)===2?portableItem.innerType().strip().parse(rawItem):rawItem);
  if(item.topics.some(name=>!context.manifest?.topics?.some(topic=>normalizeTopicName(topic.name)===normalizeTopicName(name))))throw new AppError(400,"This item references a topic missing from the backup.");
  if(item.id!==id||item.projectId&&!context.manifest?.projects.some(p=>p.id===item.projectId)||ref.original&&(item.kind!=="pdf"||item.pdf?.byteSize!==ref.original.byteSize||item.pdf.sha256&&item.pdf.sha256!==ref.original.sha256))throw new AppError(400,"The item does not match the backup index.");
  return db.transaction(async tx=>{
   await tx.execute(sql`select id from users where id=${context.userId} for update`);await restoreContext(tx,context.tokenHash);
   const result=await importPortableItem(tx,context.userId,item);
   await tx.execute(sql`insert into backup_restore_items(transfer_hash,origin_id,resource_id,source_origin_id,created) values(${context.tokenHash},${id},${result.id},${item.projectSourceId||null},${!result.duplicate}) on conflict(transfer_hash,origin_id) do update set resource_id=excluded.resource_id,created=backup_restore_items.created or excluded.created`);
   return result;
  });
 });
 app.post("/backup-transfers/restore/originals/:id",{...hooks,bodyLimit:1024},async req=>{
  if(!options.storageAvailable)throw new AppError(503,"Original-file storage is not connected.");
  const id=z.object({id:z.string().uuid()}).parse(req.params).id;return originalRestoreTicket(db,req.backupRestore!.tokenHash,id,options.publicApiUrl);
 });
 app.post("/backup-transfers/restore/finish",{...hooks,bodyLimit:1024},async req=>{await finishBackupRestore(db,req.backupRestore!.tokenHash);return{finished:true};});
 let running:Promise<void>|undefined;
 const maintenance=()=>{if(running)return;running=(async()=>{await db.execute(sql`delete from backup_downloads where token_hash in(select token_hash from backup_downloads where expires_at<now() limit 500)`);const expired=await db.execute(sql`select token_hash from backup_restores where (expires_at<now() or session_hash is null) and (busy_until is null or busy_until<now()) limit 20`);for(const row of expired.rows)await finishBackupRestore(db,String(row.token_hash));})().catch(()=>app.log.error("Backup restore cleanup will retry.")).finally(()=>{running=undefined;});};
 const timer=setInterval(maintenance,60000);timer.unref();app.addHook("onClose",async()=>{clearInterval(timer);await running;});
}
