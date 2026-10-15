import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { fixture } from "./helpers.js";
import { localFileStore, backblazeFileStore } from "../apps/server/src/file-store.js";
import { extractPdf } from "../apps/server/src/pdf-process.js";
import { processPdfJob, cleanPdfFiles } from "../apps/server/src/pdf-worker.js";
import { pdf } from "./pdf-fixture.js";

test("PDF parser extracts real page text and safely rejects malformed and image-only files", async () => {
  assert.equal((await extractPdf(pdf())).pages[0].text, "Research survives the conversation");
  await assert.rejects(extractPdf(Buffer.from("%PDF-broken")), /invalid_pdf/);
  await assert.rejects(extractPdf(await readFile(new URL("./fixtures/password-protected.pdf", import.meta.url))), /password_protected/);
  await assert.rejects(extractPdf(Buffer.concat([pdf(), Buffer.alloc(20 * 1024 * 1024)])), /invalid_pdf/);
  await assert.rejects(extractPdf(pdf("")), /no_extractable_text/);
  assert.throws(() => backblazeFileStore({ endpoint: "http://localhost", region: "x", bucket: "private", keyId: "x", applicationKey: "x" }));
});
test("Private PDF upload, extraction, search, ownership, retry rejection and durable cleanup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stash-file-test-")), store = localFileStore(directory);
  const f = await fixture({ fileStore: store });
  try {
    const a = await f.signup(), b = await f.signup(), content = pdf();
    assert.equal((await f.request("POST", "/api/items/uploads", { filename: "../bad.pdf", byteSize: 100 }, a.cookie)).statusCode, 400);
    const ticketResponse = await f.request("POST", "/api/items/uploads", { filename: "Research.pdf", byteSize: content.length }, a.cookie);
    assert.equal(ticketResponse.statusCode, 200, ticketResponse.body);
    const ticket = ticketResponse.json();
    assert.equal((await f.request("POST", `/uploads/${ticket.id}`, content, undefined, { "content-type": "application/pdf" })).statusCode, 401);
    assert.equal((await f.request("OPTIONS", `/uploads/${ticket.id}`, undefined, undefined, { origin: "https://evil.test" })).statusCode, 403);
    const preflight = await f.request("OPTIONS", `/uploads/${ticket.id}`);
    assert.equal(preflight.statusCode, 204); assert.equal(preflight.headers["access-control-allow-origin"], "http://127.0.0.1:3000");
    const saved = await f.request("POST", `/uploads/${ticket.id}`, content, undefined, { authorization: `Bearer ${ticket.token}`, "content-type": "application/pdf" });
    assert.equal(saved.statusCode, 200, saved.body);
    const item = saved.json().item;
    assert.equal(item.kind, "pdf"); assert.equal(item.pdf.filename, "Research.pdf");
    assert.equal((await f.request("POST", `/uploads/${ticket.id}`, content, undefined, { authorization: `Bearer ${ticket.token}`, "content-type": "application/pdf" })).statusCode, 401);
    assert.equal((await f.request("GET", `/api/items/${item.id}/pages`, undefined, b.cookie)).statusCode, 404);
    const permission = await f.request("POST", `/api/items/${item.id}/download`, {}, a.cookie);
    assert.equal(permission.statusCode, 200, permission.body);
    const download = permission.json();
    const original = await f.request("GET", `/downloads/${item.id}`, undefined, undefined, { authorization: `Bearer ${download.token}` });
    assert.equal(original.statusCode, 200, original.body); assert.ok(original.rawPayload.equals(content));
    assert.equal((await f.request("GET", `/downloads/${item.id}`, undefined, undefined, { authorization: `Bearer ${download.token}` })).statusCode, 401);
    await processPdfJob(f.db, store);
    const pages = await f.request("GET", `/api/items/${item.id}/pages`, undefined, a.cookie);
    assert.equal(pages.json().state, "ready", pages.body);
    assert.match(pages.json().pages[0].text, /Research survives/);
    assert.equal((await f.request("GET", "/api/items?q=survives", undefined, a.cookie)).json().total, 1);
    const detail = (await f.request("GET", `/api/items/${item.id}`, undefined, a.cookie)).json().item;
    assert.equal(detail.extractedText, undefined); assert.equal(detail.pdf.storageKey, undefined);
    await f.request("POST", `/api/items/${item.id}/lifecycle`, { action: "trash" }, a.cookie);
    assert.equal((await f.request("GET", `/api/items/${item.id}/pages`, undefined, a.cookie)).statusCode, 404);
    await f.request("POST", `/api/items/${item.id}/lifecycle`, { action: "purge" }, a.cookie);
    const cleanup = await f.db.execute(sql`select storage_key from blob_cleanup`);
    assert.equal(cleanup.rows.length, 1);
    const key = String(cleanup.rows[0].storage_key);
    assert.ok((await store.get(key)).equals(content));
    await f.db.execute(sql`update blob_cleanup set not_before=now()`);
    await cleanPdfFiles(f.db, store);
    await assert.rejects(store.get(key));
    assert.equal((await f.db.execute(sql`select * from blob_cleanup`)).rows.length, 0);
  } finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
});

test("PDF reservations serialize quota races and expired uploads leave a tracked cleanup task", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stash-quota-test-")), store = localFileStore(directory);
  const f = await fixture({ fileStore: store });
  try {
    const a = await f.signup();
    await f.db.execute(sql`with added as (
      insert into resources(user_id,kind,title,url) select ${a.user.id},'pdf','Synthetic quota reservation',null from generate_series(1,24) returning id,user_id
    ) insert into attachments(user_id,resource_id,storage_key,filename,byte_size,state,upload_expires_at)
      select user_id,id,user_id::text||'/'||id::text||'.pdf','Synthetic.pdf',20971520,'ready',now() from added`);
    const results = await Promise.all([1, 2].map(() => f.request("POST", "/api/items/uploads", { filename: "Last slot.pdf", byteSize: 20 * 1024 * 1024 }, a.cookie)));
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
    const ticket = results.find(r => r.statusCode === 200)!.json();
    await f.db.execute(sql`update attachments set upload_expires_at=now()-interval '10 minutes' where id=${ticket.id}`);
    await cleanPdfFiles(f.db, store);
    assert.equal((await f.db.execute(sql`select * from attachments where id=${ticket.id}`)).rows.length, 0);
    assert.equal((await f.db.execute(sql`select * from blob_cleanup`)).rows.length, 1);
    assert.equal((await f.request("POST","/api/items/uploads",{filename:"Wait for deletion.pdf",byteSize:20*1024*1024},a.cookie)).statusCode,409);
    await f.db.execute(sql`update blob_cleanup set not_before=now()`);
    await cleanPdfFiles(f.db,store);
    assert.equal((await f.request("POST","/api/items/uploads",{filename:"Space released.pdf",byteSize:20*1024*1024},a.cookie)).statusCode,200);
  } finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
});

test("PDF worker recovers an expired lease and retains cleanup work across storage outages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stash-worker-test-")), store = localFileStore(directory);
  const f = await fixture({ fileStore: store });
  try {
    const a = await f.signup(), content = pdf();
    const ticket = (await f.request("POST", "/api/items/uploads", { filename: "Restart.pdf", byteSize: content.length }, a.cookie)).json();
    const saved = await f.request("POST", `/uploads/${ticket.id}`, content, undefined, { authorization: `Bearer ${ticket.token}`, "content-type": "application/pdf" });
    assert.equal(saved.statusCode, 200, saved.body);
    const item = saved.json().item;
    await f.db.execute(sql`update item_jobs set state='running',attempts=1,lease_until=now()-interval '1 minute' where resource_id=${item.id}`);
    await processPdfJob(f.db, { ...store, async get() { throw new Error("Synthetic storage outage"); } });
    let job = (await f.db.execute(sql`select state,error_code,attempts from item_jobs where resource_id=${item.id}`)).rows[0];
    assert.equal(job.state, "queued"); assert.equal(job.error_code, "storage_unavailable");
    await f.db.execute(sql`update item_jobs set run_after=now()-interval '1 minute' where resource_id=${item.id}`);
    await processPdfJob(f.db, store);
    job = (await f.db.execute(sql`select state,error_code,attempts from item_jobs where resource_id=${item.id}`)).rows[0];
    assert.equal(job.state, "succeeded");
    const deletion = await f.request("DELETE", "/api/me", { password: "correct horse battery staple", confirmation: "DELETE" }, a.cookie);
    assert.equal(deletion.statusCode, 200, deletion.body);
    assert.equal((await f.db.execute(sql`select * from attachments where user_id=${a.user.id}`)).rows.length, 0);
    assert.equal((await f.db.execute(sql`select * from item_jobs where user_id=${a.user.id}`)).rows.length, 0);
    await f.db.execute(sql`update blob_cleanup set not_before=now()`);
    await cleanPdfFiles(f.db, { ...store, async remove() { throw new Error("Synthetic delete outage"); } });
    assert.equal((await f.db.execute(sql`select * from blob_cleanup`)).rows.length, 1);
    await f.db.execute(sql`update blob_cleanup set not_before=now()`);
    await cleanPdfFiles(f.db, store);
    assert.equal((await f.db.execute(sql`select * from blob_cleanup`)).rows.length, 0);
  } finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
});

test("PDF details save atomically and request identity prevents duplicate uploads", async () => {
  const directory=await mkdtemp(join(tmpdir(),"stash-upload-identity-")),store=localFileStore(directory),f=await fixture({fileStore:store});
  try {
    const a=await f.signup(),b=await f.signup(),content=pdf();
    const group=(await f.request("POST","/api/collections",{name:"Reading"},a.cookie)).json().item;
    const foreign=(await f.request("POST","/api/collections",{name:"Private"},b.cookie)).json().item;
    const input={filename:"Atomic.pdf",byteSize:content.length,requestId:crypto.randomUUID(),title:"A useful document",notes:"Keep the context",tags:["Research"],collectionIds:[group.id],status:"reading"};
    assert.equal((await f.request("POST","/api/items/uploads",{...input,collectionIds:[foreign.id]},a.cookie)).statusCode,404);
    const first=(await f.request("POST","/api/items/uploads",input,a.cookie)).json();
    const second=(await f.request("POST","/api/items/uploads",input,a.cookie)).json();
    assert.equal(first.id,second.id);
    assert.equal((await f.request("POST",`/uploads/${first.id}`,content,undefined,{authorization:`Bearer ${first.token}`,"content-type":"application/pdf"})).statusCode,401);
    const saved=await f.request("POST",`/uploads/${second.id}`,content,undefined,{authorization:`Bearer ${second.token}`,"content-type":"application/pdf"});
    assert.equal(saved.statusCode,200,saved.body);const item=saved.json().item;
    assert.equal(item.title,input.title);assert.equal(item.notes,input.notes);assert.equal(item.status,"reading");assert.deepEqual(item.tags,["research"]);assert.deepEqual(item.collectionIds,[group.id]);
    const repeated=await f.request("POST","/api/items/uploads",input,a.cookie);assert.equal(repeated.statusCode,200,repeated.body);assert.equal(repeated.json().item.id,item.id);
    assert.equal((await f.request("POST","/api/items/uploads",{...input,notes:"Changed request"},a.cookie)).statusCode,409);
    assert.equal((await f.db.execute(sql`select * from resources where user_id=${a.user.id}`)).rows.length,1);
    await f.request("POST",`/api/items/${item.id}/lifecycle`,{action:"trash"},a.cookie);
    assert.equal((await f.request("POST","/api/items/uploads",input,a.cookie)).statusCode,409);
  } finally {await f.close();await rm(directory,{recursive:true,force:true});}
});

test("Deleting an account during upload tracks and removes the late-written original", async () => {
  const directory=await mkdtemp(join(tmpdir(),"stash-upload-delete-")),store=localFileStore(directory);
  let entered!:()=>void,release!:()=>void;const writing=new Promise<void>(r=>{entered=r;}),resume=new Promise<void>(r=>{release=r;});
  const f=await fixture({fileStore:{...store,async put(key,content){entered();await resume;await store.put(key,content);}}});
  try {
    const a=await f.signup(),content=pdf();
    const ticket=(await f.request("POST","/api/items/uploads",{filename:"Late upload.pdf",byteSize:content.length},a.cookie)).json();
    const upload=f.request("POST",`/uploads/${ticket.id}`,content,undefined,{authorization:`Bearer ${ticket.token}`,"content-type":"application/pdf"});
    await writing;
    const deleted=await f.request("DELETE","/api/me",{password:"correct horse battery staple",confirmation:"DELETE"},a.cookie);assert.equal(deleted.statusCode,200,deleted.body);
    release();assert.equal((await upload).statusCode,403);
    const cleanup=await f.db.execute(sql`select storage_key from blob_cleanup`);assert.equal(cleanup.rows.length,1);
    const key=String(cleanup.rows[0].storage_key);assert.ok((await store.get(key)).equals(content));
    await f.db.execute(sql`update blob_cleanup set not_before=now()`);await cleanPdfFiles(f.db,store);await assert.rejects(store.get(key));
    assert.equal((await f.db.execute(sql`select * from resources where user_id=${a.user.id}`)).rows.length,0);
  } finally {release();await f.close();await rm(directory,{recursive:true,force:true});}
});


test("A changed stored original cannot be downloaded or parsed",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"stash-integrity-test-")),base=localFileStore(directory);
 let changed=false;
 const store={...base,async get(key:string){const original=await base.get(key);if(!changed)return original;const corrupt=Buffer.from(original);corrupt[corrupt.length-1]^=1;return corrupt;}};
 const f=await fixture({fileStore:store});try{
  const a=await f.signup(),bytes=pdf();
  const ticket=(await f.request("POST","/api/items/uploads",{filename:"Original.pdf",byteSize:bytes.length},a.cookie)).json();
  const saved=await f.request("POST",`/uploads/${ticket.id}`,bytes,undefined,{authorization:`Bearer ${ticket.token}`,"content-type":"application/pdf"});assert.equal(saved.statusCode,200);const id=saved.json().item.id;
  changed=true;
  const permission=(await f.request("POST",`/api/items/${id}/download`,{},a.cookie)).json();
  const download=await f.request("GET",`/downloads/${id}`,undefined,undefined,{authorization:`Bearer ${permission.token}`});assert.equal(download.statusCode,409);assert.match(download.body,/integrity/);
  await processPdfJob(f.db,store);
  const pages=(await f.request("GET",`/api/items/${id}/pages`,undefined,a.cookie)).json();assert.equal(pages.state,"failed");assert.equal(pages.errorCode,"original_changed");assert.deepEqual(pages.pages,[]);
 }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});
