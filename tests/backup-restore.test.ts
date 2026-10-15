import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { fixture } from "./helpers.js";
import { pdf } from "./pdf-fixture.js";
import { localFileStore } from "../apps/server/src/file-store.js";
import { processPdfJob,cleanPdfFiles } from "../apps/server/src/pdf-worker.js";
import { createBackupExport } from "../apps/server/src/backup-export.js";
import { finishBackupRestore } from "../apps/server/src/backup-restore-routes.js";
import { openBackup,type OpenBackup } from "../apps/web/app/backup-archive.js";
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex"),mime="application/vnd.stash.backup+json";
async function collect(stream:NodeJS.ReadableStream){const chunks:Buffer[]=[];for await(const chunk of stream as AsyncIterable<Buffer>)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
async function start(f:Awaited<ReturnType<typeof fixture>>,cookie:string,backup:OpenBackup){
 const response=await f.request("POST","/api/backups/restore",{manifestHash:hash(backup.manifestBytes)},cookie);assert.equal(response.statusCode,200,response.body);const ticket=response.json(),headers={authorization:`Bearer ${ticket.token}`,"content-type":mime};
 const manifest=await f.request("POST","/backup-transfers/restore/manifest",Buffer.from(backup.manifestBytes),undefined,headers);assert.equal(manifest.statusCode,200,manifest.body);return{ticket,headers};
}

test("ZIP restore preserves project history, copied sources, Trash state and original bytes without overwriting edits",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"stash-restore-")),store=localFileStore(dir),f=await fixture({fileStore:store});let backup:OpenBackup|undefined;
 try{
  const a=await f.signup(),b=await f.signup(),project=(await f.request("POST","/api/projects",{name:"Research"},a.cookie)).json().project;
  const research=(await f.request("POST","/api/items",{kind:"idea",title:"Project idea",body:"Original research",projectId:project.id},a.cookie)).json().item;
  const edited=await f.request("PATCH",`/api/items/${research.id}`,{revision:research.revision,body:"Developed research"},a.cookie);assert.equal(edited.statusCode,200,edited.body);
  const promoted=await f.request("POST",`/api/items/${research.id}/promote`,{requestId:randomUUID(),body:"Useful excerpt"},a.cookie);assert.equal(promoted.statusCode,200,promoted.body);
  const bytes=pdf(),ticket=(await f.request("POST","/api/items/uploads",{filename:"Original.pdf",byteSize:bytes.length,title:"Research PDF"},a.cookie)).json();
  const uploaded=await f.request("POST",`/uploads/${ticket.id}`,bytes,undefined,{authorization:`Bearer ${ticket.token}`,"content-type":"application/pdf"});assert.equal(uploaded.statusCode,200,uploaded.body);const source=uploaded.json().item;await processPdfJob(f.db,store);
  await f.request("POST",`/api/items/${source.id}/lifecycle`,{action:"trash"},a.cookie);
  await f.request("POST","/api/collections",{name:"Empty collection"},a.cookie);
  await f.request("PATCH",`/api/projects/${project.id}`,{revision:project.revision,archived:true},a.cookie);
  const exported=await createBackupExport(f.db,a.user.id,store);backup=await openBackup(new Blob([await collect(exported.stream)]));
  let transfer=await start(f,b.cookie,backup);
  for(const ref of backup.manifest.items){const{bytes:metadata}=await backup.readItem(ref.id),result=await f.request("POST",`/backup-transfers/restore/items/${ref.id}`,Buffer.from(metadata),undefined,transfer.headers);assert.equal(result.statusCode,200,result.body);if(ref.original){const permission=await f.request("POST",`/backup-transfers/restore/originals/${ref.id}`,{},undefined,{authorization:transfer.headers.authorization});assert.equal(permission.statusCode,200,permission.body);const grant=permission.json(),sent=await f.request("POST",new URL(grant.uploadUrl).pathname,Buffer.from(await backup.readOriginal(ref.id)),undefined,{authorization:`Bearer ${grant.token}`,"content-type":"application/pdf"});assert.equal(sent.statusCode,200,sent.body);}}
  const firstHash=transfer.headers.authorization;
  // A new browser selection rotates the transient permission and keeps durable progress.
  transfer=await start(f,b.cookie,backup);
  assert.equal((await f.request("POST","/backup-transfers/restore/finish",{},undefined,{authorization:firstHash})).statusCode,401);
  assert.equal((await f.request("POST","/backup-transfers/restore/finish",{},undefined,{authorization:transfer.headers.authorization})).statusCode,200);
  const restored=await f.db.execute(sql`select r.id,r.kind,r.project_id,r.project_source_id,r.body,r.deleted_at from resources r where r.user_id=${b.user.id}`);assert.equal(restored.rows.length,3);
  const restoredIdea=restored.rows.find(r=>r.project_id),copy=restored.rows.find(r=>r.project_source_id),restoredPdf=restored.rows.find(r=>r.kind==="pdf");assert.equal(restoredIdea?.body,"Developed research");assert.equal(copy?.project_source_id,restoredIdea?.id);assert.ok(restoredPdf?.deleted_at);
  assert.equal((await f.db.execute(sql`select revision from project_item_history where user_id=${b.user.id}`)).rows.length,1);
  assert.ok((await f.db.execute(sql`select archived_at from projects where user_id=${b.user.id}`)).rows[0].archived_at);
  const file=(await f.db.execute(sql`select storage_key from attachments where resource_id=${restoredPdf!.id}`)).rows[0];assert.ok((await store.get(String(file.storage_key))).equals(bytes));assert.equal((await f.db.execute(sql`select * from blob_cleanup where storage_key=${file.storage_key}`)).rows.length,0);
  await f.request("POST",`/api/items/${restoredPdf!.id}/lifecycle`,{action:"restore"},b.cookie);await processPdfJob(f.db,store);
  const item=(await f.request("GET",`/api/items/${restoredPdf!.id}`,undefined,b.cookie)).json().item;
  await f.request("PATCH",`/api/items/${item.id}`,{revision:item.revision,notes:"Edited after restore"},b.cookie);
  const again=await start(f,b.cookie,backup);
  const ref=backup.manifest.items.find(r=>r.original)!;const metadata=await backup.readItem(ref.id);
  const duplicate=await f.request("POST",`/backup-transfers/restore/items/${ref.id}`,Buffer.from(metadata.bytes),undefined,again.headers);assert.equal(duplicate.statusCode,200,duplicate.body);assert.equal(duplicate.json().duplicate,true);
  const skipped=await f.request("POST",`/backup-transfers/restore/originals/${ref.id}`,{},undefined,{authorization:again.headers.authorization});assert.equal(skipped.json().skipped,true,skipped.body);
  assert.equal((await f.request("GET",`/api/items/${item.id}`,undefined,b.cookie)).json().item.notes,"Edited after restore");
  await f.request("POST","/backup-transfers/restore/finish",{},undefined,{authorization:again.headers.authorization});
 }finally{await backup?.close();await f.close();await rm(dir,{recursive:true,force:true});}
});

test("Restore validates permissions/checksums before writes, rejects foreign origins and finalises expired partial projects",async()=>{
 const f=await fixture();let backup:OpenBackup|undefined;try{
  const a=await f.signup(),b=await f.signup(),project=(await f.request("POST","/api/projects",{name:"Archived research"},a.cookie)).json().project;
  await f.request("POST","/api/items",{kind:"note",body:"Private project body",projectId:project.id},a.cookie);await f.request("PATCH",`/api/projects/${project.id}`,{revision:project.revision,archived:true},a.cookie);
  const exported=await createBackupExport(f.db,a.user.id,undefined);backup=await openBackup(new Blob([await collect(exported.stream)]));const transfer=await start(f,b.cookie,backup),ref=backup.manifest.items[0],item=await backup.readItem(ref.id);
  assert.equal((await f.request("POST",`/backup-transfers/restore/items/${ref.id}`,Buffer.from(item.bytes),undefined,{...transfer.headers,origin:"https://foreign.example"})).statusCode,403);
  assert.equal((await f.request("POST",`/backup-transfers/restore/items/${ref.id}`,Buffer.from("{}"),undefined,transfer.headers)).statusCode,400);
  assert.equal((await f.db.execute(sql`select * from resources where user_id=${b.user.id}`)).rows.length,0);
  assert.equal((await f.request("POST",`/backup-transfers/restore/items/${ref.id}`,Buffer.from(item.bytes),undefined,transfer.headers)).statusCode,200);
  const stored=(await f.db.execute(sql`select token_hash from backup_restores where user_id=${b.user.id}`)).rows[0];await f.db.execute(sql`update backup_restores set expires_at=now()-interval '1 second' where user_id=${b.user.id}`);
  assert.equal((await f.request("POST","/backup-transfers/restore/finish",{},undefined,{authorization:transfer.headers.authorization})).statusCode,401);
  await finishBackupRestore(f.db,String(stored.token_hash));assert.ok((await f.db.execute(sql`select archived_at from projects where user_id=${b.user.id}`)).rows[0].archived_at);
 }finally{await backup?.close();await f.close();}
});


test("Full restore repairs a data-only original and preserves imported summary provenance and later notes",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"stash-repair-")),store=localFileStore(dir),f=await fixture({fileStore:store});let backup:OpenBackup|undefined;
 try{
  const a=await f.signup(),b=await f.signup(),bytes=pdf(),ticket=(await f.request("POST","/api/items/uploads",{filename:"Repair.pdf",byteSize:bytes.length},a.cookie)).json();
  const upload=await f.request("POST",`/uploads/${ticket.id}`,bytes,undefined,{authorization:`Bearer ${ticket.token}`,"content-type":"application/pdf"});assert.equal(upload.statusCode,200,upload.body);const id=upload.json().item.id;await processPdfJob(f.db,store);
  const{queueSummary}=await import("@stash/core"),{processSummaryJob}=await import("../apps/server/src/summary-worker.js");
  const source=(await f.request("GET",`/api/items/${id}`,undefined,a.cookie)).json().item;
  await queueSummary(f.db,a.user.id,id,{revision:source.revision,requestId:randomUUID()},true);
  const text="Research survives the conversation";
  await processSummaryJob(f.db,{model:"verification/provider:free",async preflight(){},async generate(){return{model:"verification/provider:free",tokens:100,cost:0,result:{overview:{text,sourceIds:["s1"],quote:text},points:[{text,sourceIds:["s1"],quote:text}]}};}});
  const data=(await f.request("GET","/api/items/export",undefined,a.cookie)).json(),imported=await f.request("POST","/api/items/import",{format:"json",content:JSON.stringify(data)},b.cookie);assert.equal(imported.statusCode,200,imported.body);
  const target=(await f.request("GET","/api/items",undefined,b.cookie)).json().items[0];assert.equal(target.pdf.hasOriginal,false);
  const edit=await f.request("PATCH",`/api/items/${target.id}`,{revision:target.revision,notes:"Keep this edit"},b.cookie);assert.equal(edit.statusCode,200,edit.body);
  const exported=await createBackupExport(f.db,a.user.id,store);backup=await openBackup(new Blob([await collect(exported.stream)]));let transfer=await start(f,b.cookie,backup);const ref=backup.manifest.items[0],metadata=await backup.readItem(ref.id);
  assert.equal((await f.request("POST",`/backup-transfers/restore/items/${ref.id}`,Buffer.from(metadata.bytes),undefined,transfer.headers)).json().duplicate,true);
  let permission=(await f.request("POST",`/backup-transfers/restore/originals/${ref.id}`,{},undefined,{authorization:transfer.headers.authorization})).json();
  const changed=Buffer.from(bytes);changed[changed.length-1]^=1;
  const invalid=await f.request("POST",new URL(permission.uploadUrl).pathname,changed,undefined,{authorization:`Bearer ${permission.token}`,"content-type":"application/pdf"});assert.equal(invalid.statusCode,400,invalid.body);
  assert.equal((await f.request("GET",`/api/items/${target.id}`,undefined,b.cookie)).json().item.pdf.hasOriginal,false);
  permission=(await f.request("POST",`/backup-transfers/restore/originals/${ref.id}`,{},undefined,{authorization:transfer.headers.authorization})).json();
  const oldPermission=permission;transfer=await start(f,b.cookie,backup);
  assert.equal((await f.request("POST",new URL(oldPermission.uploadUrl).pathname,bytes,undefined,{authorization:`Bearer ${oldPermission.token}`,"content-type":"application/pdf"})).statusCode,401);
  permission=(await f.request("POST",`/backup-transfers/restore/originals/${ref.id}`,{},undefined,{authorization:transfer.headers.authorization})).json();
  const repaired=await f.request("POST",new URL(permission.uploadUrl).pathname,bytes,undefined,{authorization:`Bearer ${permission.token}`,"content-type":"application/pdf"});assert.equal(repaired.statusCode,200,repaired.body);await processPdfJob(f.db,store);
  const restored=(await f.request("GET",`/api/items/${target.id}`,undefined,b.cookie)).json().item;assert.equal(restored.notes,"Keep this edit");assert.equal(restored.pdf.hasOriginal,true);assert.equal(restored.pdf.state,"ready");
  const summary=(await f.request("GET",`/api/items/${target.id}/summary`,undefined,b.cookie)).json();assert.equal(summary.saved.imported,true);assert.equal(summary.saved.stale,false);assert.equal(summary.saved.result.overview.text,text);
  assert.equal((await f.db.execute(sql`select * from resources where user_id=${b.user.id}`)).rows.length,1);
  assert.equal((await f.db.execute(sql`select * from item_jobs where user_id=${b.user.id} and kind='summary'`)).rows.length,0);
  await f.request("POST","/backup-transfers/restore/finish",{},undefined,{authorization:transfer.headers.authorization});
 }finally{await backup?.close();await f.close();await rm(dir,{recursive:true,force:true});}
});

test("Logout revokes a partial restore immediately and retained cleanup restores archive state",async()=>{
 const f=await fixture();let backup:OpenBackup|undefined;try{
  const a=await f.signup(),b=await f.signup(),project=(await f.request("POST","/api/projects",{name:"Archived source"},a.cookie)).json().project;
  await f.request("POST","/api/items",{kind:"idea",body:"Research body",projectId:project.id},a.cookie);await f.request("PATCH",`/api/projects/${project.id}`,{revision:project.revision,archived:true},a.cookie);
  backup=await openBackup(new Blob([await collect((await createBackupExport(f.db,a.user.id,undefined)).stream)]));const transfer=await start(f,b.cookie,backup),ref=backup.manifest.items[0],metadata=await backup.readItem(ref.id);
  await f.request("POST",`/backup-transfers/restore/items/${ref.id}`,Buffer.from(metadata.bytes),undefined,transfer.headers);
  const record=(await f.db.execute(sql`select token_hash from backup_restores where user_id=${b.user.id}`)).rows[0];
  await f.request("POST","/api/auth/logout",{},b.cookie);
  assert.equal((await f.request("POST","/backup-transfers/restore/finish",{},undefined,{authorization:transfer.headers.authorization})).statusCode,401);
  assert.equal((await f.db.execute(sql`select session_hash from backup_restores where user_id=${b.user.id}`)).rows[0].session_hash,null);
  await finishBackupRestore(f.db,String(record.token_hash));assert.ok((await f.db.execute(sql`select archived_at from projects where user_id=${b.user.id}`)).rows[0].archived_at);
 }finally{await backup?.close();await f.close();}
});

test("Deleting an account during original restore denies adoption and keeps a durable cleanup task",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"stash-restore-delete-")),base=localFileStore(dir);let held=false,entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(r=>{entered=r;}),resume=new Promise<void>(r=>{release=r;});
 const store={...base,async put(key:string,content:Buffer){if(held){entered();await resume;}await base.put(key,content);}},f=await fixture({fileStore:store});let backup:OpenBackup|undefined;
 try{
  const a=await f.signup(),b=await f.signup(),bytes=pdf(),ticket=(await f.request("POST","/api/items/uploads",{filename:"Original.pdf",byteSize:bytes.length},a.cookie)).json();
  assert.equal((await f.request("POST",`/uploads/${ticket.id}`,bytes,undefined,{authorization:`Bearer ${ticket.token}`,"content-type":"application/pdf"})).statusCode,200);await processPdfJob(f.db,store);
  backup=await openBackup(new Blob([await collect((await createBackupExport(f.db,a.user.id,store)).stream)]));const transfer=await start(f,b.cookie,backup),ref=backup.manifest.items[0],metadata=await backup.readItem(ref.id);
  await f.request("POST",`/backup-transfers/restore/items/${ref.id}`,Buffer.from(metadata.bytes),undefined,transfer.headers);
  const grant=(await f.request("POST",`/backup-transfers/restore/originals/${ref.id}`,{},undefined,{authorization:transfer.headers.authorization})).json();held=true;
  const upload=f.request("POST",new URL(grant.uploadUrl).pathname,bytes,undefined,{authorization:`Bearer ${grant.token}`,"content-type":"application/pdf"});await waiting;
  const deletion=await f.request("DELETE","/api/me",{password:"correct horse battery staple",confirmation:"DELETE"},b.cookie);assert.equal(deletion.statusCode,200,deletion.body);release();assert.equal((await upload).statusCode,403);
  const cleanup=(await f.db.execute(sql`select storage_key,byte_size from blob_cleanup where user_id=${b.user.id}`)).rows;assert.equal(cleanup.length,1);assert.equal(Number(cleanup[0].byte_size),bytes.length);assert.ok((await base.get(String(cleanup[0].storage_key))).equals(bytes));
  assert.equal((await f.db.execute(sql`select * from backup_restores where user_id=${b.user.id}`)).rows.length,0);
  assert.equal((await f.db.execute(sql`select * from backup_restore_items where resource_id in(select id from resources where user_id=${b.user.id})`)).rows.length,0);
  await f.db.execute(sql`update blob_cleanup set not_before=now() where user_id=${b.user.id}`);await cleanPdfFiles(f.db,base);await assert.rejects(base.get(String(cleanup[0].storage_key)));
  assert.equal((await f.db.execute(sql`select * from blob_cleanup where user_id=${b.user.id}`)).rows.length,0);
 }finally{release();await backup?.close();await f.close();await rm(dir,{recursive:true,force:true});}
});
