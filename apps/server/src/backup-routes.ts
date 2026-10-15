import { Readable } from "node:stream";
import { z } from "zod";
import { exportBookmarks } from "@stash/core/bookmarks";
import type { FastifyInstance } from "fastify";
import type { Database } from "@stash/db";
import { sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { AppError } from "@stash/core";
import { auth,digest } from "./auth.js";
import { createBackupExport,createJsonExport } from "./backup-export.js";
import type { FileStore } from "./file-store.js";
export function registerBackupRoutes(app:FastifyInstance,db:Database,options:{production?:boolean;store?:FileStore;publicApiUrl:string}){
 const authentication=auth(db,!!options.production);
 app.post("/api/backups/export",async req=>{
  const {format}=z.object({format:z.enum(["zip","json","bookmarks"]).default("zip")}).strict().parse(req.body||{});
  const user=await authentication.user(req),sessionHash=digest(req.cookies.stash_session||""),token=randomBytes(32).toString("base64url");
  await db.transaction(async tx=>{
   await tx.execute(sql`select id from users where id=${user.id} for update`);
   await tx.execute(sql`delete from backup_downloads where expires_at<now()`);
   const pending=await tx.execute(sql`select count(*)::int as total from backup_downloads where user_id=${user.id}`);
   if(Number(pending.rows[0].total)>=3)throw new AppError(429,"Wait for your current backup before starting another.");
   await tx.execute(sql`insert into backup_downloads(token_hash,user_id,session_hash,expires_at,format) values(${digest(token)},${user.id},${sessionHash},now()+interval '1 minute',${format})`);
  });
  return{token,downloadUrl:`${options.publicApiUrl}/backup-transfers/export`,expiresIn:60};
 });
 app.get("/backup-transfers/export",async(req,reply)=>{
  const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if(!token)throw new AppError(401,"Backup permission has expired. Start the download again.");
  const hash=digest(token);
  const transfer=await db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(78134927)`);
   const busy=await tx.execute(sql`select count(*)::int as total from backup_downloads where started_at is not null and expires_at>now()`);
   if(Number(busy.rows[0].total)>=2)throw new AppError(429,"Backups are busy. Try again shortly.");
   const result=await tx.execute(sql`update backup_downloads b set started_at=now(),expires_at=now()+interval '15 minutes' from users u,sessions s where b.token_hash=${hash} and b.started_at is null and b.expires_at>now() and u.id=b.user_id and u.suspended_at is null and s.hash=b.session_hash and s.user_id=b.user_id and s.expires_at>now() and not exists(select 1 from backup_downloads active where active.user_id=b.user_id and active.started_at is not null and active.expires_at>now()) returning b.user_id,b.format`);
   if(!result.rows.length)throw new AppError(401,"Backup permission has expired. Start the download again.");
   return {userId:String(result.rows[0].user_id),format:String(result.rows[0].format)};
  });
  try{
   const permission=async()=>{
    const valid=await db.execute(sql`select b.token_hash from backup_downloads b join sessions s on s.hash=b.session_hash join users u on u.id=b.user_id where b.token_hash=${hash} and b.expires_at>now() and s.expires_at>now() and u.suspended_at is null`);
    if(!valid.rows.length)throw new AppError(401,"Download permission has expired.");
   };
   const userId=transfer.userId;
   let stream:Readable,type:string,filename:string;
   if(transfer.format==="zip"){
    stream=(await createBackupExport(db,userId,options.store,permission)).stream;type="application/zip";filename="stash-backup.zip";
   }else if(transfer.format==="json"){
    stream=(await createJsonExport(db,userId,permission)).stream;type="application/json";filename="stash-export.json";
   }else{
    const exported=await exportBookmarks(db,userId);await permission();
    stream=Readable.from((async function*(){for(const part of exported.parts()){await permission();yield Buffer.from(part);}})());
    type="text/html; charset=utf-8";filename="stash-bookmarks.html";
   }
   let cleaned=false;
   const cleanup=()=>{if(cleaned)return;cleaned=true;void db.execute(sql`delete from backup_downloads where token_hash=${hash}`).catch(()=>{});};
   stream.once("close",cleanup);stream.once("end",cleanup);
   reply.raw.once("close",()=>{if(!stream.destroyed)stream.destroy();cleanup();});
   return reply.type(type).header("Content-Disposition",`attachment; filename="${filename}"`).send(stream);
  }catch(error){await db.execute(sql`delete from backup_downloads where token_hash=${hash}`);throw error;}
 });
}
