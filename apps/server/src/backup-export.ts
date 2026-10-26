import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { ZipFile } from "yazl";
import { and,eq,sql } from "drizzle-orm";
import { resources,users,collections,resourceCollections,attachments,itemSummaries,type Database } from "@stash/db";
import { AppError } from "@stash/core";
import { exportItemRecord } from "@stash/core/items-portability";
import { LIMITS,BACKUP_LIMITS,backupManifest,type BackupManifest } from "@stash/shared";
import { exportProjects } from "@stash/core/projects-portability";
import type { FileStore } from "./file-store.js";
const stamp=(value:Date|null|undefined)=>value?.toISOString()||null;
export async function createBackupExport(db:Database,userId:string,store:FileStore|undefined,checkPermission?:()=>Promise<void>,format:"zip"|"json"="zip"){
 const snapshot=await db.transaction(async tx=>{
  const[profile]=await tx.select({name:users.name,email:users.email,bio:users.bio,interests:users.interests,suspendedAt:users.suspendedAt}).from(users).where(eq(users.id,userId));
  if(!profile||profile.suspendedAt)throw new AppError(403,"This account is unavailable.");
  const groups=await tx.select({id:collections.id,name:collections.name,kind:collections.kind,description:collections.description}).from(collections).where(eq(collections.userId,userId));
  const refs=await tx.select({id:resources.id,portableId:sql<string>`coalesce(${resources.importOriginId},${resources.id})`,revision:resources.revision,sourceRevision:resources.sourceRevision,projectId:resources.projectId,projectSourceId:resources.projectSourceId}).from(resources).where(and(eq(resources.userId,userId),sql`(${resources.deletedAt} is null or ${resources.deletedAt}>now()-interval '30 days')`)).orderBy(resources.createdAt,resources.id);
  if(refs.length>10000||new Set(refs.map(r=>r.portableId)).size!==refs.length)throw new AppError(409,"This library has conflicting backup identities.");
  const memberships=await tx.select({resourceId:resourceCollections.resourceId,collectionId:resourceCollections.collectionId}).from(resourceCollections).where(eq(resourceCollections.userId,userId));
  const files=await tx.select({resourceId:attachments.resourceId,storageKey:attachments.storageKey,contentHash:attachments.contentHash,byteSize:attachments.byteSize,state:attachments.state,updatedAt:attachments.updatedAt}).from(attachments).where(eq(attachments.userId,userId));
  const summaries=await tx.select({resourceId:itemSummaries.resourceId,createdAt:itemSummaries.createdAt,sourceHash:itemSummaries.sourceHash}).from(itemSummaries).where(eq(itemSummaries.userId,userId));
  const{suspendedAt:_,...safeProfile}=profile;
  return{profile:safeProfile,groups,refs,memberships,files,summaries,projects:await exportProjects(tx,userId),exportedAt:new Date().toISOString()};
 },{isolationLevel:"repeatable read",accessMode:"read only"});
 if(format==="zip"&&!store&&snapshot.files.some(f=>f.storageKey))throw new AppError(503,"Original-file storage is not connected. Use a data-only export for now.");
 const names=new Map(snapshot.groups.filter(g=>g.kind==="collection").map(g=>[g.id,g.name])),topicNames=new Map(snapshot.groups.filter(g=>g.kind==="topic").map(g=>[g.id,g.name])),members=new Map<string,string[]>();
 for(const m of snapshot.memberships){const row=members.get(m.resourceId)||[];row.push(m.collectionId);members.set(m.resourceId,row);}
 const fileMap=new Map(snapshot.files.map(f=>[f.resourceId,f])),summaryMap=new Map(snapshot.summaries.map(s=>[s.resourceId,s]));
 const manifest:BackupManifest={format:"stash-backup",version:3,exportedAt:snapshot.exportedAt,profile:snapshot.profile,collections:snapshot.groups.filter(g=>g.kind==="collection").map(g=>({name:g.name})),topics:snapshot.groups.filter(g=>g.kind==="topic").map(g=>({name:g.name,description:g.description})),projects:snapshot.projects as BackupManifest["projects"],items:[]};
 let stream:Readable;
 const active=async()=>{if(stream.destroyed)throw new AppError(409,"Backup was cancelled.");await checkPermission?.();const result=await db.execute(sql`select id from users where id=${userId} and suspended_at is null`);if(!result.rows.length)throw new AppError(403,"This account is unavailable.");};
 async function readRecord(ref:(typeof snapshot.refs)[number]){
  const file=fileMap.get(ref.id),savedSummary=summaryMap.get(ref.id);
   await active();
   const row=await db.transaction(async tx=>{
    const[current]=await tx.select({revision:resources.revision,sourceRevision:resources.sourceRevision,projectId:resources.projectId,projectSourceId:resources.projectSourceId}).from(resources).where(and(eq(resources.userId,userId),eq(resources.id,ref.id)));
    const[currentFile]=await tx.select({storageKey:attachments.storageKey,contentHash:attachments.contentHash,state:attachments.state,updatedAt:attachments.updatedAt}).from(attachments).where(and(eq(attachments.userId,userId),eq(attachments.resourceId,ref.id)));
    const[currentSummary]=await tx.select({createdAt:itemSummaries.createdAt,sourceHash:itemSummaries.sourceHash}).from(itemSummaries).where(and(eq(itemSummaries.userId,userId),eq(itemSummaries.resourceId,ref.id)));
    if(!current||current.revision!==ref.revision||current.sourceRevision!==ref.sourceRevision||current.projectId!==ref.projectId||current.projectSourceId!==ref.projectSourceId||currentFile?.storageKey!==file?.storageKey||currentFile?.contentHash!==file?.contentHash||currentFile?.state!==file?.state||stamp(currentFile?.updatedAt)!==stamp(file?.updatedAt)||stamp(currentSummary?.createdAt)!==stamp(savedSummary?.createdAt)||currentSummary?.sourceHash!==savedSummary?.sourceHash)throw new AppError(409,"Your library changed during backup. Try again.");
    return exportItemRecord(tx,userId,ref.id,names,members.get(ref.id)||[],topicNames);
   },{isolationLevel:"repeatable read",accessMode:"read only"});
   const bytes=Buffer.from(JSON.stringify(row));if(bytes.length>BACKUP_LIMITS.itemBytes)throw new AppError(413,"An item exceeds the backup entry limit.");
   return bytes;
 }
 if(format==="json"){
  const header=Buffer.from(JSON.stringify({version:3,exportedAt:snapshot.exportedAt,profile:snapshot.profile,projects:snapshot.projects,collections:manifest.collections,topics:manifest.topics,excludesOriginalFiles:true}).slice(0,-1)+',"items":[');
  stream=Readable.from((async function*(){let size=header.length+2;await active();yield header;for(const[index,ref]of snapshot.refs.entries()){const bytes=await readRecord(ref);size+=bytes.length+(index?1:0);if(size>LIMITS.importBytes)throw new AppError(413,"This JSON export exceeds 128 MiB. Use a full backup instead.");if(index)yield Buffer.from(",");yield bytes;}await active();yield Buffer.from("]}");})());
  const timeout=setTimeout(()=>stream.destroy(new Error("Export timed out. Try again.")),15*60_000);timeout.unref();stream.once("close",()=>clearTimeout(timeout));
  return{stream,count:snapshot.refs.length,missingOriginals:snapshot.files.filter(f=>!f.storageKey).length};
 }
 const zip=new ZipFile();stream=zip.outputStream as Readable;
 const add=(path:string,read:()=>Promise<Buffer>)=>zip.addReadStreamLazy(path,{mode:0o100600,compressionLevel:6},callback=>{void read().then(content=>callback(null,Readable.from([content]))).catch(error=>callback(error as Error,null as unknown as Readable));});
 for(const ref of snapshot.refs){
  const file=fileMap.get(ref.id),record:BackupManifest["items"][number]={id:ref.portableId,path:`items/${ref.portableId}.json`,sha256:"",original:null};manifest.items.push(record);
  add(record.path,async()=>{const bytes=await readRecord(ref);record.sha256=createHash("sha256").update(bytes).digest("hex");return bytes;});
  if(file?.storageKey){
   const path=`originals/${ref.portableId}.pdf`;
   add(path,async()=>{
    await active();const bytes=await store!.get(file.storageKey!),hash=createHash("sha256").update(bytes).digest("hex");
    if(bytes.length!==file.byteSize||file.contentHash&&hash!==file.contentHash)throw new AppError(409,"A PDF original could not be verified. The backup was interrupted.");
    await active();record.original={path,sha256:hash,byteSize:bytes.length};return bytes;
   });
  }
 }
 add("manifest.json",async()=>{await active();const validated=backupManifest.parse(manifest),bytes=Buffer.from(JSON.stringify(validated));if(bytes.length>BACKUP_LIMITS.manifestBytes)throw new AppError(413,"Backup index exceeds the supported size.");return bytes;});
 zip.on("error",()=>stream.destroy(new Error("Backup interrupted. Try again.")));
 const timeout=setTimeout(()=>stream.destroy(new Error("Backup timed out. Try again.")),15*60_000);timeout.unref();stream.once("close",()=>clearTimeout(timeout));
 zip.end();return{stream,count:snapshot.refs.length,missingOriginals:snapshot.files.filter(f=>!f.storageKey).length};
}

export async function createJsonExport(db:Database,userId:string,checkPermission?:()=>Promise<void>){return createBackupExport(db,userId,undefined,checkPermission,"json");}
