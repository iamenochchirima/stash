// Restore only a disposable test schema. This drill never restarts PostgreSQL or touches live data.
import { createStorageJournal,journaledFileStore } from "../apps/server/src/storage-journal.js";
import { fixture,BASE } from "../tests/helpers.js";
import { createApp } from "../apps/server/src/app.js";
import { createDeletionJournal } from "../apps/server/src/deletions.js";
import { localFileStore } from "../apps/server/src/file-store.js";
import { processPdfJob,cleanPdfFiles } from "../apps/server/src/pdf-worker.js";
import { pdf } from "../tests/pdf-fixture.js";
import { queueSummary } from "@stash/core";
import { processSummaryJob } from "../apps/server/src/summary-worker.js";
import { execFileSync } from "node:child_process";
import { mkdtemp,rm,chmod,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
const directory=await mkdtemp(join(tmpdir(),"stash-file-recovery-")),base=localFileStore(join(directory,"originals")),journal=createDeletionJournal(join(directory,"journal")),storageJournal=createStorageJournal(join(directory,"journal"));
const f=await fixture({deletionJournalDir:join(directory,"journal")}),store=journaledFileStore(base,f.db,storageJournal);
const live=await createApp(f.db,{fileStore:store,journal,mailer:{async send(){}}});await live.ready();
f.request=(method,path,body,cookie,headers={})=>live.inject({method,url:path,headers:{origin:"http://127.0.0.1:3000",...(cookie?{cookie}:{}),...headers},...(body!==undefined?{payload:body as object}:{})});
const report:Record<string,unknown>={checkedAt:new Date().toISOString(),fixture:"Synthetic PDF, summary, mixed items, pending original and disposable PostgreSQL schema",postgresRestarted:false};
let app:Awaited<ReturnType<typeof createApp>>|undefined;
function requireResult(ok:unknown){if(!ok)throw new Error("FileRecoveryCheckFailed");}
function command(binary:string,args:string[]){try{return execFileSync(binary,args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]});}catch{throw new Error("DisposableDatabaseBackupFailed");}}
try{
 const a=await f.signup(),bytes=pdf(),permission=(await f.request("POST","/api/items/uploads",{filename:"Recovery.pdf",byteSize:bytes.length},a.cookie)).json();
 const uploaded=await f.request("POST",`/uploads/${permission.id}`,bytes,undefined,{authorization:`Bearer ${permission.token}`,"content-type":"application/pdf"});requireResult(uploaded.statusCode===200);const item=uploaded.json().item;await processPdfJob(f.db,store);
 const ready=(await f.request("GET",`/api/items/${item.id}`,undefined,a.cookie)).json().item,text="Research survives the conversation";
 await queueSummary(f.db,a.user.id,item.id,{revision:ready.revision,requestId:crypto.randomUUID()},true);
 await processSummaryJob(f.db,{model:"verification/provider:free",async preflight(){},async generate(){return{model:"verification/provider:free",tokens:100,cost:0,result:{overview:{text,sourceIds:["s1"],quote:text},points:[{text,sourceIds:["s1"],quote:text}]}};}});
 const archived=(await f.request("POST","/api/items",{kind:"note",body:"Synthetic retained research"},a.cookie)).json().item;await f.request("POST",`/api/items/${archived.id}/lifecycle`,{action:"archive"},a.cookie);const idea=(await f.request("POST","/api/items",{kind:"idea",body:"Synthetic trashed idea"},a.cookie)).json().item;await f.request("POST",`/api/items/${idea.id}/lifecycle`,{action:"trash"},a.cookie);
 const pending=(await f.request("POST","/api/items/uploads",{filename:"Late.pdf",byteSize:bytes.length},a.cookie)).json(),download=(await f.request("POST",`/api/items/${item.id}/download`,{},a.cookie)).json();
 const keys=(await f.db.execute(sql`select storage_key from attachments where user_id=${a.user.id}`)).rows.map(row=>String(row.storage_key));requireResult(keys.length===2);
 const bin=command("pg_config",["--bindir"]).trim(),dump=join(directory,"private-backup.dump");
 command(join(bin,"pg_dump"),["--dbname",BASE,"--schema",f.schema,"--format=custom","--file",dump]);await chmod(dump,0o600);report.backupTaken=true;
 const afterSnapshot=(await f.request("POST","/api/items/uploads",{filename:"After snapshot.pdf",byteSize:bytes.length},a.cookie)).json();
 const extra=await f.request("POST",`/uploads/${afterSnapshot.id}`,bytes,undefined,{authorization:`Bearer ${afterSnapshot.token}`,"content-type":"application/pdf"});requireResult(extra.statusCode===200);keys.push(`${a.user.id}/${afterSnapshot.id}.pdf`);report.postSnapshotOriginalWritten=true;
 const deleted=await f.request("DELETE","/api/me",{password:"correct horse battery staple",confirmation:"DELETE"},a.cookie);requireResult(deleted.statusCode===200);report.accountDeleted=true;
 // Simulate an object written after deletion. The journal must recreate its cleanup instruction after DB restore.
 const lateKey=keys.find(key=>key.endsWith(`/${pending.id}.pdf`))!;await store.put(lateKey,bytes);
 await live.close();await f.app.close();await f.admin.query(`DROP SCHEMA ${f.schema} CASCADE`);command(join(bin,"pg_restore"),["--dbname",BASE,"--no-owner","--no-acl",dump]);report.disposableSchemaRestored=true;
 requireResult((await f.db.execute(sql`select count(*)::int as n from users`)).rows[0].n===1);requireResult((await f.db.execute(sql`select count(*)::int as n from item_summaries`)).rows[0].n===1);report.backupContainedDeletedAccountAndSummary=true;
 requireResult(await journal.apply(f.db)===1);requireResult(await journal.apply(f.db)===0);report.journalReplayIdempotent=true;
 const replay=await storageJournal.replay(f.db);report.storageJournalReplayed=replay.events>0;requireResult((await storageJournal.replay(f.db)).queued===0);
 app=await createApp(f.db,{fileStore:store,journal,mailer:{async send(){}}});await app.ready();
 const oldSession=await app.inject({method:"GET",url:"/api/me",headers:{cookie:a.cookie}});requireResult(oldSession.statusCode===401);
 const oldDownload=await app.inject({method:"GET",url:`/downloads/${item.id}`,headers:{origin:"http://127.0.0.1:3000",authorization:`Bearer ${download.token}`}});requireResult(oldDownload.statusCode===401);report.restoredAccessDenied=true;
 for(const table of["users","resources","attachments","item_summaries","item_jobs","sessions","file_downloads"]){const result=await f.db.execute(sql.raw(`select count(*)::int as n from ${table}`));requireResult(result.rows[0].n===0);}report.privateDerivedRecordsRemoved=true;
 const queued=(await f.db.execute(sql`select storage_key,byte_size from blob_cleanup`)).rows;report.originalsExpected=keys.length;report.cleanupTasksRestored=queued.length;report.postSnapshotOriginalTracked=queued.some(row=>String(row.storage_key).endsWith(`/${afterSnapshot.id}.pdf`));requireResult(queued.length===keys.length&&queued.every(row=>Number(row.byte_size)===bytes.length));report.cleanupRecreatedWithByteAccounting=true;
 await f.db.execute(sql`update blob_cleanup set not_before=now()`);for(let i=0;i<keys.length;i++)await cleanPdfFiles(f.db,store);
 requireResult((await f.db.execute(sql`select count(*)::int as n from blob_cleanup`)).rows[0].n===0);
 for(const key of keys){let absent=false;try{await store.get(key);}catch{absent=true;}requireResult(absent);}report.allOriginalsRemoved=true;report.passed=true;
}catch(error){report.passed=false;report.errorType=error instanceof Error?error.name:"RecoveryFailed";}
finally{await app?.close();await live.close();await f.close();await rm(directory,{recursive:true,force:true});}
await writeFile("docs/evidence/library-v2/file-recovery.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
