import { and, eq, gt, sql } from "drizzle-orm";
import { adminEmailJobs, adminUsers, accountTokens, users, type Database } from "@stash/db";
import { audit, type AdminOptions } from "./admin-auth.js";
import { mfaCipher } from "./admin-crypto.js";
import type { Mail } from "./mail.js";
// Locks follow administrator -> customer -> job. A failed audit insertion precedes external delivery.
export async function deliverAdminEmail(db: Database, options: AdminOptions, jobId: string) {
  const [candidate]=await db.select({userId:adminEmailJobs.userId,actorId:adminEmailJobs.actorId}).from(adminEmailJobs).where(eq(adminEmailJobs.id,jobId));
  if(!candidate)return "failed";
  return db.transaction(async tx=>{
    const [actor]=candidate.actorId?await tx.select({id:adminUsers.id,role:adminUsers.role,disabledAt:adminUsers.disabledAt,recoveryPendingAt:adminUsers.recoveryPendingAt}).from(adminUsers).where(eq(adminUsers.id,candidate.actorId)).for("update"):[];
    const [user]=await tx.select().from(users).where(eq(users.id,candidate.userId)).for("update");
    const [job]=await tx.select().from(adminEmailJobs).where(eq(adminEmailJobs.id,jobId)).for("update");
    if(!job)return "failed";
    if(job.status!=="pending")return job.status;
    const prepared=job.payload?JSON.parse(mfaCipher(options.encryptionKey).decrypt(job.payload)) as {hash:string;mail:Mail}:null;
    const [valid]=prepared?await tx.select({hash:accountTokens.hash}).from(accountTokens).where(and(eq(accountTokens.hash,prepared.hash),eq(accountTokens.userId,job.userId),gt(accountTokens.expiresAt,new Date()))):[];
    if(!user||user.suspendedAt||!actor||actor.disabledAt||actor.recoveryPendingAt||actor.role==="viewer"||!prepared||!valid||prepared.mail.to!==user.email||Date.now()-job.createdAt.getTime()>=24*60*60_000){
      await tx.update(adminEmailJobs).set({status:"failed",payload:null}).where(eq(adminEmailJobs.id,job.id));
      await audit(tx,{actorId:job.actorId,targetId:job.userId,action:`user.email.${job.purpose}.cancelled`,reason:"Account, actor or delivery token is no longer available",outcome:"failed"});
      return "failed";
    }
    await audit(tx,{actorId:job.actorId,targetId:job.userId,action:`user.email.${job.purpose}.attempt`,reason:"Requested support email delivery",outcome:"success",changes:{attempt:job.attempts+1}});
    try{
      await options.mailer.send({...prepared.mail,idempotencyKey:`stash-admin-email-${job.id}`});
      await tx.update(adminEmailJobs).set({status:"sent",payload:null,attempts:job.attempts+1,sentAt:new Date()}).where(eq(adminEmailJobs.id,job.id));
      await audit(tx,{actorId:job.actorId,targetId:job.userId,action:`user.email.${job.purpose}.delivery`,reason:"Email accepted by the configured sender",outcome:"success"});
      return "sent";
    }catch{
      const terminal=job.attempts+1>=3;
      await tx.update(adminEmailJobs).set({attempts:job.attempts+1,status:terminal?"failed":"pending",...(terminal?{payload:null}:{})}).where(eq(adminEmailJobs.id,job.id));
      if(terminal)await tx.delete(accountTokens).where(eq(accountTokens.hash,prepared.hash));
      await audit(tx,{actorId:job.actorId,targetId:job.userId,action:`user.email.${job.purpose}.delivery`,reason:terminal?"Email delivery failed after three attempts":"Email delivery failed; bounded retry pending",outcome:"failed"});
      return terminal?"failed":"pending";
    }
  });
}
export async function deliverPendingAdminEmails(db:Database,options:AdminOptions){
  const jobs=await db.select({id:adminEmailJobs.id}).from(adminEmailJobs).where(eq(adminEmailJobs.status,"pending")).orderBy(adminEmailJobs.createdAt).limit(5);
  for(const job of jobs)await deliverAdminEmail(db,options,job.id);
}
