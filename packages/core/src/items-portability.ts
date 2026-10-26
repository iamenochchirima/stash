import { portableProject,exportProjects,restoreProjects,resolveImportedProject,finishProjectRestore } from "./projects-portability.js";
import { requireProject, requireProjectTextCapacity } from "./projects.js";
import { z } from "zod";
import { and, eq, or, sql, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { resources, collections, resourceCollections, users, attachments, itemSummaries, type Database } from "@stash/db";
import { portableItem, portableTopic, normalizeTopicName, LIMITS, type PortableItem } from "@stash/shared";
import { AppError, library, normalizeUrl, topicService } from "./index.js";
import { previewImport, importLibrary } from "./portability.js";
const rawInput=z.object({format:z.enum(["json","html"]),content:z.string()});
function parsedInput(value:unknown){
 const input=rawInput.parse(value);if(Buffer.byteLength(input.content)>(input.format==="json"?LIMITS.importBytes:1048576))throw new AppError(413,"Import file is too large.");
 if(input.format==="html")return null;let document;try{document=JSON.parse(input.content);}catch{throw new AppError(400,"This file is not valid JSON.");}
 if(document?.version!==2&&document?.version!==3)return null;
 const envelope=z.object({version:z.union([z.literal(2),z.literal(3)]),exportedAt:z.string().datetime().optional(),profile:z.unknown().optional(),excludesOriginalFiles:z.boolean().optional(),projects:z.array(portableProject).max(100).default([]),collections:z.array(z.object({id:z.string().uuid().optional(),name:z.string().trim().min(1).max(80)})).max(LIMITS.collections).default([]),topics:z.array(portableTopic).max(LIMITS.collections).optional(),items:z.array(z.unknown()).max(LIMITS.importItems)});
 const parsed=(document.version===3?envelope.strict():envelope).parse(document);
 if(parsed.version===2&&(Object.hasOwn(document,"topics")||parsed.items.some(item=>!!item&&typeof item==="object"&&Object.hasOwn(item,"topics"))))throw new AppError(400,"Topics require a version 3 export.");
 if(parsed.version===3&&!parsed.topics)throw new AppError(400,"Version 3 exports must include topics.");
 const topics=parsed.topics||[];
 if(parsed.collections.length+topics.length>LIMITS.collections||new Set(topics.map(t=>normalizeTopicName(t.name))).size!==topics.length)throw new AppError(400,"Export topics are duplicated or exceed the combined organization limit.");
 return{...parsed,topics,fingerprint:createHash("sha256").update(input.content).digest("hex")};
}
function parseEntry(value:unknown,version:2|3){return portableItem.parse(version===2?portableItem.innerType().strip().parse(value):value);}
function originId(row:PortableItem,fingerprint:string,index:number){
 if(row.id)return row.id;const hex=createHash("sha256").update(`${fingerprint}:${index}`).digest("hex");return`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export async function exportItemRecord(db:Database,userId:string,id:string,groupNames?:Map<string,string>,memberships?:string[],topicNames?:Map<string,string>){
 const[row]=await db.select().from(resources).where(and(eq(resources.userId,userId),eq(resources.id,id)));if(!row)throw new AppError(404,"Item not found.");
 let names:string[],topics:string[];
 if(groupNames&&memberships){names=memberships.map(id=>groupNames.get(id)).filter((n):n is string=>!!n);topics=memberships.map(id=>topicNames?.get(id)).filter((n):n is string=>!!n);}
 else {const groups=await db.select({name:collections.name,kind:collections.kind}).from(resourceCollections).innerJoin(collections,and(eq(collections.id,resourceCollections.collectionId),eq(collections.userId,userId))).where(and(eq(resourceCollections.userId,userId),eq(resourceCollections.resourceId,id)));names=groups.filter(c=>c.kind==="collection").map(c=>c.name);topics=groups.filter(c=>c.kind==="topic").map(c=>c.name);}
 const[file]=row.kind==="pdf"?await db.select().from(attachments).where(and(eq(attachments.userId,userId),eq(attachments.resourceId,id))):[];
 const[summary]=await db.select().from(itemSummaries).where(and(eq(itemSummaries.userId,userId),eq(itemSummaries.resourceId,id)));
 const project= row.projectId ? (await db.execute(sql`select coalesce(import_origin_id,id) as id from projects where id=${row.projectId} and user_id=${userId}`)).rows[0] : null;
 const history=row.projectId?(await db.execute(sql`select revision,body,actor,created_at from project_item_history where resource_id=${id} and user_id=${userId} order by revision desc limit 20`)).rows.map((h:Record<string,unknown>)=>({revision:Number(h.revision),body:String(h.body),actor:String(h.actor),createdAt:new Date(String(h.created_at)).toISOString()})):[];
 return portableItem.parse({projectId:project?.id||null,projectSourceId:row.projectSourceId?(await db.execute(sql`select coalesce(import_origin_id,id) as id from resources where id=${row.projectSourceId} and user_id=${userId}`)).rows[0]?.id||null:null,revision:row.revision,history,id:row.importOriginId||row.id,kind:row.kind,url:row.url,title:row.title,body:row.body,notes:row.notes,tags:row.tags,collections:names,topics,
  description:row.description,metadataStatus:row.metadataStatus,status:row.status,favourite:row.favourite,archivedAt:row.archivedAt?.toISOString()||null,deletedAt:row.deletedAt?.toISOString()||null,sourceAgent:row.sourceAgent,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),sourceRevision:row.sourceRevision,
  pdf:file?{filename:file.filename,byteSize:file.byteSize,sha256:file.contentHash,state:file.state,pages:file.pages,pageCount:file.pageCount,parserVersion:file.parserVersion,errorCode:file.errorCode}:null,
  summary:summary?{sourceRevision:summary.sourceRevision,sourceHash:summary.sourceHash,snapshot:summary.sourceSnapshot,result:summary.result,model:summary.model,promptVersion:summary.promptVersion,createdAt:summary.createdAt.toISOString()}:null});
}
export async function exportItems(db:Database,userId:string){
 return db.transaction(async tx=>{
  const[profile]=await tx.select({name:users.name,email:users.email,bio:users.bio,interests:users.interests}).from(users).where(eq(users.id,userId));if(!profile)throw new AppError(404,"Account not found.");
  const groups=await tx.select({id:collections.id,name:collections.name,kind:collections.kind,description:collections.description}).from(collections).where(eq(collections.userId,userId));
  const refs=await tx.select({id:resources.id}).from(resources).where(and(eq(resources.userId,userId),sql`(${resources.deletedAt} is null or ${resources.deletedAt}>now()-interval '30 days')`)).orderBy(resources.createdAt,resources.id);
  const membership=await tx.select().from(resourceCollections).where(eq(resourceCollections.userId,userId)),names=new Map(groups.filter(c=>c.kind==="collection").map(c=>[c.id,c.name])),topicNames=new Map(groups.filter(c=>c.kind==="topic").map(c=>[c.id,c.name]));
  const rows:PortableItem[]=[];let bytes=65536;
  for(const ref of refs){const row=await exportItemRecord(tx,userId,ref.id,names,membership.filter(m=>m.resourceId===ref.id).map(m=>m.collectionId),topicNames);bytes+=Buffer.byteLength(JSON.stringify(row));if(bytes>LIMITS.importBytes)throw new AppError(413,"This JSON export exceeds 128 MiB. Use a full backup instead.");rows.push(row);}
  return{version:3,exportedAt:new Date().toISOString(),profile,projects:await exportProjects(tx,userId),collections:groups.filter(c=>c.kind==="collection").map(({id,name})=>({id,name})),topics:groups.filter(c=>c.kind==="topic").map(({name,description})=>({name,description})),excludesOriginalFiles:true,items:rows};
 },{isolationLevel:"repeatable read",accessMode:"read only"});
}
export async function findImportedItem(db:Database,userId:string,row:PortableItem){
 const identity=row.id?or(eq(resources.id,row.id),eq(resources.importOriginId,row.id)):undefined;
 const targetProjectId=await resolveImportedProject(db,userId,row.projectId);
 const condition=row.kind==="link"&&row.url?or(and(eq(resources.url,normalizeUrl(row.url)),targetProjectId?eq(resources.projectId,targetProjectId):sql`${resources.projectId} is null`),identity):identity;
 if(!condition)return undefined;return(await db.select({id:resources.id,kind:resources.kind,deletedAt:resources.deletedAt}).from(resources).where(and(eq(resources.userId,userId),condition)))[0];
}
function importError(e:unknown){return e instanceof AppError?e.message:e instanceof z.ZodError?e.issues[0]?.message||"Invalid item.":"Could not import this item.";}
function validateRestore(row:PortableItem){
 if(row.deletedAt&&new Date(row.deletedAt).getTime()<=Date.now()-30*86400_000)throw new AppError(400,"Expired Trash item was not restored.");
 if(row.kind==="pdf"&&row.pdf&&row.summary&&row.summary.sourceRevision===row.sourceRevision){const full=row.pdf.pages.map(p=>p.text).join("\n\n");if(row.summary.sourceHash!==createHash("sha256").update(full).digest("hex"))throw new AppError(400,"PDF summary source does not match its extracted text.");}
}
export async function importPortableItem(db:Database,userId:string,value:unknown){
 const row=portableItem.parse(value);validateRestore(row);if(!row.id)throw new AppError(400,"An import identity is required.");
 return db.transaction(async tx=>{
  const[user]=await tx.select({id:users.id,suspendedAt:users.suspendedAt}).from(users).where(eq(users.id,userId)).for("update");if(!user||user.suspendedAt)throw new AppError(403,"This account is unavailable.");
  const targetProjectId=await resolveImportedProject(tx,userId,row.projectId);
  const previous=await findImportedItem(tx,userId,row);if(previous){if(previous.kind!==row.kind)throw new AppError(409,"This import identity belongs to a different item type.");return{id:previous.id,duplicate:true,missingOriginal:false};}
  if(targetProjectId){await requireProject(tx,userId,targetProjectId,true);await requireProjectTextCapacity(tx,userId,row.body+row.history.map(h=>h.body).join(""));}
  const[count]=await tx.select({total:sql<number>`count(*)::int`}).from(resources).where(eq(resources.userId,userId));if(count.total>=LIMITS.resources)throw new AppError(409,"Your item limit has been reached. Trash counts until permanently deleted.");
  const known=await tx.select().from(collections).where(eq(collections.userId,userId));const wanted=[...new Set(row.collections)],missing=wanted.filter(name=>!known.some(c=>c.kind==="collection"&&c.name===name));
  if(known.length+missing.length>LIMITS.collections)throw new AppError(409,"Your collection limit has been reached.");
  if(missing.length)known.push(...await tx.insert(collections).values(missing.map(name=>({userId,name}))).returning());
  const[rowSaved]=await tx.insert(resources).values({userId,projectId:targetProjectId,revision:Math.max(row.revision,...row.history.map(h=>h.revision+1)),importOriginId:row.id,kind:row.kind,url:row.kind==="link"?normalizeUrl(row.url!):null,title:row.title|| (row.kind==="link"?new URL(row.url!).hostname:row.kind==="pdf"?row.pdf!.filename.replace(/\.pdf$/i,""):row.body.split(/\r?\n/).find(s=>s.trim())!.replace(/^#+\s*/,"").slice(0,200)),body:row.body,notes:row.notes,tags:[...new Set(row.tags.map(t=>t.toLowerCase()))],status:row.kind==="note"||row.kind==="idea"?"unread":row.status,favourite:row.favourite,archivedAt:row.archivedAt?new Date(row.archivedAt):null,deletedAt:row.deletedAt?new Date(Math.min(Date.now(),new Date(row.deletedAt).getTime())):null,createdAt:row.createdAt?new Date(row.createdAt):undefined,updatedAt:row.updatedAt?new Date(row.updatedAt):undefined,sourceAgent:row.sourceAgent,description:row.description,metadataStatus:row.metadataStatus,sourceRevision:row.sourceRevision,knownSourceHash:row.kind==="link"&&row.summary?.sourceRevision===row.sourceRevision?row.summary.sourceHash:null,extractedText:row.kind==="pdf"?row.pdf!.pages.map(p=>p.text).join("\n\n"):""}).returning();
  if(targetProjectId)for(const h of row.history)await tx.execute(sql`insert into project_item_history(user_id,resource_id,revision,body,actor,created_at) values(${userId},${rowSaved.id},${h.revision},${h.body},${h.actor},${new Date(h.createdAt)}) on conflict(resource_id,revision) do nothing`);
  const topicIds:string[]=[];for(const name of new Set(row.topics))topicIds.push((await topicService(tx,userId).ensure({name})).topic.id);
  const ids=[...wanted.map(name=>known.find(c=>c.kind==="collection"&&c.name===name)!.id),...topicIds];if(ids.length)await tx.insert(resourceCollections).values(ids.map(collectionId=>({userId,resourceId:rowSaved.id,collectionId})));
  if(row.kind==="pdf")await tx.insert(attachments).values({userId,resourceId:rowSaved.id,storageKey:null,filename:row.pdf!.filename,byteSize:row.pdf!.byteSize,contentHash:row.pdf!.sha256,state:"missing",pages:row.pdf!.pages,pageCount:row.pdf!.pageCount,parserVersion:row.pdf!.parserVersion,errorCode:row.pdf!.errorCode,uploadExpiresAt:new Date()});
  if(row.summary)await tx.insert(itemSummaries).values({userId,resourceId:rowSaved.id,sourceRevision:row.summary.sourceRevision,sourceHash:row.summary.sourceHash,sourceSnapshot:row.summary.snapshot,result:row.summary.result,model:row.summary.model,promptVersion:row.summary.promptVersion,createdAt:new Date(row.summary.createdAt),importedAt:new Date()});
  await tx.update(users).set({firstSavedAt:sql`coalesce(first_saved_at,now())`,...(ids.length?{firstOrganizedAt:sql`coalesce(first_organized_at,now())`}:{})}).where(eq(users.id,userId));
  return{id:rowSaved.id,duplicate:false,missingOriginal:row.kind==="pdf"};
 });
}
export async function previewItemsImport(db:Database,userId:string,value:unknown){
 const parsed=parsedInput(value);if(!parsed)return previewImport(db,userId,value);const groups=await library(db,userId).collections(),knownTopics=await topicService(db,userId).list(),topicNames=new Set(parsed.topics.map(t=>normalizeTopicName(t.name))),names=new Set(parsed.collections.map(c=>c.name));let valid=0,duplicates=0,missingOriginals=0;const rejected:{index:number;error:string}[]=[];
 for(const[index,entry]of parsed.items.entries())try{const row=parseEntry(entry,parsed.version);row.id=originId(row,parsed.fingerprint,index);if(row.topics.some(name=>!parsed.topics.some(topic=>normalizeTopicName(topic.name)===normalizeTopicName(name))))throw new AppError(400,"This item references a topic missing from the export.");if(row.projectId&&!parsed.projects.some(p=>p.id===row.projectId))throw new AppError(400,"This item references a project missing from the export.");validateRestore(row);valid++;row.collections.forEach(name=>names.add(name));row.topics.forEach(name=>topicNames.add(normalizeTopicName(name)));if(await findImportedItem(db,userId,row).catch(e=>{if(row.projectId&&e instanceof AppError&&e.status===400)return undefined;throw e;}))duplicates++;else if(row.kind==="pdf")missingOriginals++;}catch(e){rejected.push({index,error:importError(e)});}
 return{total:parsed.items.length,valid,duplicates,toSave:valid-duplicates,rejected,collectionsToCreate:[...names].filter(n=>!groups.some(c=>c.name===n)).length,missingOriginals,topicsToCreate:[...topicNames].filter(name=>!knownTopics.some(t=>normalizeTopicName(t.name)===name)).length};
}
export async function importItems(db:Database,userId:string,value:unknown){
 const parsed=parsedInput(value);if(!parsed)return importLibrary(db,userId,value);const createdProjects=await restoreProjects(db,userId,parsed.projects);const groups=library(db,userId),collectionErrors:{name:string;error:string}[]=[],rejected:{index:number;error:string}[]=[];
 for(const c of parsed.collections)try{if(!(await groups.collections()).some(g=>g.name===c.name))await groups.createCollection(c.name);}catch{collectionErrors.push({name:c.name,error:"Could not import collection."});}
 const topicErrors:{name:string;error:string}[]=[];for(const topic of parsed.topics)try{await topicService(db,userId).ensure(topic);}catch(e){topicErrors.push({name:topic.name,error:importError(e)});}
 let saved=0,duplicates=0,missingOriginals=0;
 for(const[index,entry]of parsed.items.entries())try{const row=parseEntry(entry,parsed.version);row.id=originId(row,parsed.fingerprint,index);if(row.topics.some(name=>!parsed.topics.some(topic=>normalizeTopicName(topic.name)===normalizeTopicName(name))))throw new AppError(400,"This item references a topic missing from the export.");if(row.projectId&&!parsed.projects.some(p=>p.id===row.projectId))throw new AppError(400,"This item references a project missing from the export.");const result=await importPortableItem(db,userId,row);if(result.duplicate)duplicates++;else{saved++;if(result.missingOriginal)missingOriginals++;}}catch(e){rejected.push({index,error:importError(e)});}
 for(const entry of parsed.items){const parsedRow=portableItem.safeParse(entry);if(!parsedRow.success||!parsedRow.data.id||!parsedRow.data.projectSourceId)continue;const row=parsedRow.data;await db.execute(sql`update resources target set project_source_id=source.id from resources source where target.user_id=${userId} and source.user_id=${userId} and target.project_id is null and source.project_id is not null and (target.id=${row.id} or target.import_origin_id=${row.id}) and (source.id=${row.projectSourceId} or source.import_origin_id=${row.projectSourceId}) and target.project_source_id is null`);}
 await finishProjectRestore(db,userId,parsed.projects,createdProjects);
 return{saved,duplicates,rejected,collectionErrors,topicErrors,total:parsed.items.length,missingOriginals};
}
