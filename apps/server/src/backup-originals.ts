import type { Database } from "@stash/db";
import { sql } from "drizzle-orm";
import { randomBytes,randomUUID,createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "@stash/core";
import { requireProject } from "@stash/core/projects";
import { digest } from "./auth.js";
import { requirePdfCapacity } from "./pdf-reservations.js";
import { restoreContext } from "./backup-context.js";
const restoreInput=z.object({targetId:z.string().uuid(),transferHash:z.string().regex(/^[a-f0-9]{64}$/),expectedSha256:z.string().regex(/^[a-f0-9]{64}$/),byteSize:z.number().int().positive().max(20971520)}).strict();
export async function validateRestoreUpload(db:Database,userId:string,capture:unknown,content?:Buffer){
 const value=(capture as {restore?:unknown}|null)?.restore;if(!value)return null;
 const input=restoreInput.parse(value),context=await restoreContext(db,input.transferHash);
 if(context.userId!==userId)throw new AppError(404,"PDF not found.");
 if(content&&(content.length!==input.byteSize||createHash("sha256").update(content).digest("hex")!==input.expectedSha256))throw new AppError(400,"The PDF failed its backup checksum.");
 return input;
}
async function targetFile(tx:Database,userId:string,targetId:string,transferHash:string){
 const result=await tx.execute(sql`select a.id,a.storage_key,a.filename,a.byte_size,a.content_hash,r.revision,r.project_id,r.deleted_at,m.created from attachments a join resources r on r.id=a.resource_id join backup_restore_items m on m.resource_id=r.id and m.transfer_hash=${transferHash} where r.id=${targetId} and r.user_id=${userId} and a.user_id=${userId} for update of r,a`);
 const file=result.rows[0];if(!file)throw new AppError(404,"PDF not found.");
 return file;
}
async function requireOriginalWrite(tx:Database,userId:string,file:Record<string,unknown>){
 if(file.deleted_at&&!file.created)throw new AppError(409,"This PDF is in Trash. Restore it before adding the original.");
 if(file.project_id)await requireProject(tx,userId,String(file.project_id),true);
 }
export async function originalRestoreTicket(db:Database,tokenHash:string,originId:string,publicApiUrl:string){
 const token=randomBytes(32).toString("base64url"),id=randomUUID();
 return db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(78134923)`);
  const context=await restoreContext(tx,tokenHash);
  await tx.execute(sql`select id from users where id=${context.userId} and suspended_at is null for update`);
  const ref=context.manifest?.items.find(i=>i.id===originId);if(!ref?.original)throw new AppError(400,"This backup has no original for that item.");
  const mapping=await tx.execute(sql`select resource_id from backup_restore_items where transfer_hash=${tokenHash} and origin_id=${originId}`);
  const targetId=String(mapping.rows[0]?.resource_id||"");if(!targetId)throw new AppError(409,"Restore the item details before its original.");
  const file=await targetFile(tx,context.userId,targetId,tokenHash);
  if(file.storage_key)return{skipped:true};
  await requireOriginalWrite(tx,context.userId,file);
  if(Number(file.byte_size)!==ref.original.byteSize||file.content_hash&&file.content_hash!==ref.original.sha256)throw new AppError(409,"The backup original does not match the existing PDF.");
  const previous=await tx.execute(sql`select id,state from attachments where user_id=${context.userId} and resource_id is null and capture_input->'restore'->>'transferHash'=${tokenHash} and capture_input->'restore'->>'targetId'=${targetId} for update`);
  if(previous.rows.length){
   if(previous.rows[0].state==="uploading")throw new AppError(409,"This original is still uploading. Try again shortly.");
   await tx.execute(sql`update attachments set state='pending',upload_token_hash=${digest(token)},upload_expires_at=now()+interval '5 minutes',updated_at=now() where id=${previous.rows[0].id}`);
   return{token,uploadUrl:`${publicApiUrl}/uploads/${previous.rows[0].id}`};
  }
  await requirePdfCapacity(tx,context.userId,ref.original.byteSize,false);
  const capture={restore:{targetId,transferHash:tokenHash,expectedSha256:ref.original.sha256,byteSize:ref.original.byteSize}};
  await tx.execute(sql`insert into attachments(id,user_id,storage_key,filename,byte_size,capture_input,upload_token_hash,upload_expires_at) values(${id},${context.userId},${context.userId+"/"+id+".pdf"},${file.filename},${ref.original.byteSize},${JSON.stringify(capture)}::jsonb,${digest(token)},now()+interval '5 minutes')`);
  return{token,uploadUrl:`${publicApiUrl}/uploads/${id}`};
 });
}
export async function commitRestoredOriginal(tx:Database,attachment:Record<string,unknown>,content:Buffer){
 const input=await validateRestoreUpload(tx,String(attachment.user_id),attachment.capture_input,content);if(!input)return null;
 const file=await targetFile(tx,String(attachment.user_id),input.targetId,input.transferHash);
 if(file.storage_key){await tx.execute(sql`delete from attachments where id=${attachment.id}`);return input.targetId;}
 await requireOriginalWrite(tx,String(attachment.user_id),file);
 if(Number(file.byte_size)!==content.length||file.content_hash&&file.content_hash!==input.expectedSha256)throw new AppError(409,"The backup original does not match the existing PDF.");
 // Transfer the key atomically. Deleting the now-empty reservation must not enqueue the adopted original.
 await tx.execute(sql`update attachments set storage_key=null where id=${attachment.id}`);
 await tx.execute(sql`update attachments set storage_key=${attachment.storage_key},content_hash=${input.expectedSha256},state='queued',error_code=null,updated_at=now() where id=${file.id}`);
 await tx.execute(sql`delete from attachments where id=${attachment.id}`);
 await tx.execute(sql`update resources set revision=revision+1,updated_at=now() where id=${input.targetId}`);
 await tx.execute(sql`insert into item_jobs(user_id,resource_id,kind,input_revision) values(${attachment.user_id},${input.targetId},'extract',${Number(file.revision)+1})`);
 return input.targetId;
}
