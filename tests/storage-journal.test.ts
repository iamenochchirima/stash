import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp,rm,writeFile,readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { fixture } from "./helpers.js";
import { pdf } from "./pdf-fixture.js";
import { localFileStore } from "../apps/server/src/file-store.js";
import { cleanPdfFiles } from "../apps/server/src/pdf-worker.js";
import { createStorageJournal,journaledFileStore } from "../apps/server/src/storage-journal.js";

test("Storage journal replays orphan intents, deletion acknowledgements and monotonic ordering",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"stash-storage-journal-")),f=await fixture(),base=localFileStore(join(directory,"objects")),journal=createStorageJournal(join(directory,"journal")),store=journaledFileStore(base,f.db,journal);
 try{
  assert.deepEqual(await journal.replay(f.db),{events:0,missing:0,queued:0});
  const a=await f.signup(),key=`${a.user.id}/${randomUUID()}.pdf`,bytes=pdf();await store.put(key,bytes);
  const first=(await f.db.execute(sql`select last_event_seq from storage_file_ledger where storage_key=${key}`)).rows[0];
  const replay=await journal.replay(f.db);assert.equal(replay.queued,1);assert.equal((await journal.replay(f.db)).queued,0);
  assert.equal(Number((await f.db.execute(sql`select byte_size from blob_cleanup where storage_key=${key}`)).rows[0].byte_size),bytes.length);
  await f.db.execute(sql`update blob_cleanup set not_before=now()`);await cleanPdfFiles(f.db,store);await assert.rejects(base.get(key));
  const removed=(await f.db.execute(sql`select state,last_event_seq from storage_file_ledger where storage_key=${key}`)).rows[0];assert.equal(removed.state,"removed");assert.ok(BigInt(String(removed.last_event_seq))>BigInt(String(first.last_event_seq)));
  // Simulate older restored metadata, without restoring the independent disk journal.
  await f.db.execute(sql`update storage_file_ledger set state='put',last_event_seq=${first.last_event_seq} where storage_key=${key}`);
  const item=(await f.request("POST","/api/items",{kind:"note",body:"Recovery placeholder"},a.cookie)).json().item;
  await f.db.execute(sql`update resources set kind='pdf',body='',extracted_text='Saved source text' where id=${item.id}`);
  await f.db.execute(sql`insert into attachments(user_id,resource_id,storage_key,filename,byte_size,state,upload_expires_at) values(${a.user.id},${item.id},${key},'Old.pdf',${bytes.length},'ready',now())`);
  await f.db.execute(sql`insert into item_jobs(user_id,resource_id,kind,input_revision) values(${a.user.id},${item.id},'extract',1)`);
  assert.equal((await journal.replay(f.db)).missing,1);
  const file=(await f.db.execute(sql`select storage_key,state from attachments where resource_id=${item.id}`)).rows[0];assert.equal(file.storage_key,null);assert.equal(file.state,"missing");assert.equal((await f.db.execute(sql`select state from item_jobs where resource_id=${item.id}`)).rows[0].state,"cancelled");
  assert.equal((await f.db.execute(sql`select * from blob_cleanup`)).rows.length,0);
  const entries=(await readFile(join(directory,"journal/storage-events.jsonl"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));assert.equal(entries.length,3);assert.deepEqual(Object.keys(entries[0]).sort(),["byteSize","key","kind","recordedAt","seq","userId"]);
 }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});

test("Storage writes fail before touching objects if the durable journal cannot be written",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"stash-journal-failure-")),f=await fixture(),base=localFileStore(join(directory,"objects"));try{
  const a=await f.signup(),key=`${a.user.id}/${randomUUID()}.pdf`,path=join(directory,"not-a-directory");await writeFile(path,"fixture",{mode:0o600});const journal=createStorageJournal(path),store=journaledFileStore(base,f.db,journal);
  await assert.rejects(store.put(key,pdf()));await assert.rejects(base.get(key));await base.put(key,pdf());await assert.rejects(store.remove(key));assert.ok((await base.get(key)).equals(pdf()));assert.equal((await f.db.execute(sql`select * from storage_file_ledger`)).rows.length,0);
 }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});

test("Storage journal rejects missing/corrupt private history and seeds pre-journal originals",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"stash-journal-seed-")),f=await fixture();try{
  const a=await f.signup(),key=`${a.user.id}/${randomUUID()}.pdf`,item=(await f.request("POST","/api/items",{kind:"note",body:"Original metadata"},a.cookie)).json().item;
  await f.db.execute(sql`insert into attachments(user_id,resource_id,storage_key,filename,byte_size,state,upload_expires_at) values(${a.user.id},${item.id},${key},'Existing.pdf',100,'ready',now())`);
  const journal=createStorageJournal(join(directory,"journal"));await journal.replay(f.db);assert.equal((await f.db.execute(sql`select * from storage_file_ledger where storage_key=${key}`)).rows.length,1);
  await assert.rejects(createStorageJournal(join(directory,"missing")).replay(f.db),/missing/);
  await writeFile(join(directory,"journal/storage-events.jsonl"),"invalid-json\n",{mode:0o600});await assert.rejects(journal.replay(f.db),/could not be replayed/);
 }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});

test("An interrupted physical deletion remains authoritative after older attachment metadata returns",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"stash-journal-remove-")),f=await fixture(),base=localFileStore(join(directory,"objects")),journal=createStorageJournal(join(directory,"journal"));
 try{
  const a=await f.signup(),key=`${a.user.id}/${randomUUID()}.pdf`,bytes=pdf(),store=journaledFileStore(base,f.db,journal);await store.put(key,bytes);
  const unavailable=journaledFileStore({...base,async remove(){throw new Error("Synthetic storage outage");}},f.db,journal);await assert.rejects(unavailable.remove(key));
  const item=(await f.request("POST","/api/items",{kind:"note",body:"Old metadata"},a.cookie)).json().item;await f.db.execute(sql`update resources set kind='pdf',body='' where id=${item.id}`);
  await f.db.execute(sql`insert into attachments(user_id,resource_id,storage_key,filename,byte_size,state,upload_expires_at) values(${a.user.id},${item.id},${key},'Old.pdf',${bytes.length},'ready',now())`);
  const replay=await journal.replay(f.db);assert.equal(replay.missing,1);assert.equal(replay.queued,1);assert.ok((await base.get(key)).equals(bytes));
  const pending=(await f.db.execute(sql`select byte_size from blob_cleanup where storage_key=${key}`)).rows[0];assert.equal(Number(pending.byte_size),bytes.length);
  await f.db.execute(sql`update blob_cleanup set not_before=now()`);await cleanPdfFiles(f.db,store);await assert.rejects(base.get(key));assert.equal((await f.db.execute(sql`select * from blob_cleanup`)).rows.length,0);
 }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});
