import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
test("JSON v3 preserves full mixed content and states; repeated imports preserve edits", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(), b = await f.signup();
    await f.request("POST", "/api/collections", { name: "Empty collection" }, a.cookie);
    const group = (await f.request("POST", "/api/collections", { name: "Ideas" }, a.cookie)).json().item;
    const idea = (await f.request("POST", "/api/items", { kind: "idea", body: "Complete context ".repeat(80), title: "An idea", collectionIds: [group.id] }, a.cookie)).json().item;
    await f.request("PATCH", `/api/items/${idea.id}`, { revision: 1, favourite: true }, a.cookie);
    await f.request("POST", `/api/items/${idea.id}/lifecycle`, { action: "archive" }, a.cookie);
    await f.request("POST", "/api/items", { kind: "link", url: "https://example.test/export", notes: "Link context" }, a.cookie);
    const exported = (await f.request("GET", "/api/items/export", undefined, a.cookie)).json();
    assert.equal(exported.version, 3); assert.equal(exported.items.length, 2);
    const exportedIdea = exported.items.find((i: any) => i.kind === "idea");
    assert.equal(exportedIdea.body, idea.body); assert.equal(exportedIdea.favourite, true); assert.ok(exportedIdea.archivedAt);
    assert.ok(!JSON.stringify(exported).includes("passwordHash")); assert.ok(!JSON.stringify(exported).includes("importOriginId"));
    const body = { format: "json", content: JSON.stringify(exported) };
    const preview = await f.request("POST", "/api/items/import/preview", body, b.cookie);
    assert.equal(preview.statusCode, 200, preview.body); assert.equal(preview.json().toSave, 2);
    const imported = await f.request("POST", "/api/items/import", body, b.cookie);
    assert.equal(imported.statusCode, 200, imported.body); assert.equal(imported.json().saved, 2);
    const after = (await f.request("GET", "/api/items?location=archive", undefined, b.cookie)).json().items[0];
    const full = (await f.request("GET", `/api/items/${after.id}`, undefined, b.cookie)).json().item;
    assert.equal(full.body, idea.body); assert.equal(full.favourite, true);
    await f.request("PATCH", `/api/items/${after.id}`, { revision: full.revision, body: "My newer imported edit" }, b.cookie);
    const repeated = await f.request("POST", "/api/items/import", body, b.cookie);
    assert.equal(repeated.json().duplicates, 2);
    assert.equal((await f.request("GET", `/api/items/${after.id}`, undefined, b.cookie)).json().item.body, "My newer imported edit");
    assert.ok((await f.request("GET", "/api/collections", undefined, b.cookie)).json().items.some((c: any) => c.name === "Empty collection"));
    assert.equal((await f.request("GET", `/api/items/${idea.id}`, undefined, b.cookie)).statusCode, 404);
  } finally { await f.close(); }
});

test("Data-only JSON restores PDF text and summary provenance without claiming an original",async()=>{
 const {sql}=await import("drizzle-orm"),{createHash}=await import("node:crypto");
 const {queueSummary}=await import("@stash/core"),{processSummaryJob}=await import("../apps/server/src/summary-worker.js");
 const f=await fixture();
 try{
  const a=await f.signup(),b=await f.signup(),text="Paper filters removed more sediment in the six-week trial.",hash=createHash("sha256").update(text).digest("hex");
  const added=await f.db.execute(sql`insert into resources(user_id,kind,title,url,extracted_text,notes,favourite) values(${a.user.id},'pdf','Original research',null,${text},'Private author context',true) returning id`),id=String(added.rows[0].id);
  await f.db.execute(sql`insert into attachments(user_id,resource_id,storage_key,filename,byte_size,content_hash,state,pages,page_count,parser_version,upload_expires_at) values(${a.user.id},${id},${a.user.id+'/'+id+'.pdf'},'Research.pdf',500,${"a".repeat(64)},'ready',${JSON.stringify([{page:1,text}])}::jsonb,1,'fixture',now())`);
  await queueSummary(f.db,a.user.id,id,{revision:1,requestId:crypto.randomUUID()},true);
  await processSummaryJob(f.db,{model:"verification/provider:free",async preflight(){},async generate(){return{model:"verification/provider:free",tokens:100,cost:0,result:{overview:{text,sourceIds:["s1"],quote:text},points:[{text,sourceIds:["s1"],quote:text}]}};}});
  const output=await f.request("GET","/api/items/export",undefined,a.cookie);assert.equal(output.statusCode,200,output.body);const exported=output.json();
  assert.equal(exported.excludesOriginalFiles,true);assert.equal(exported.items[0].summary.sourceHash,hash);assert.equal(exported.items[0].pdf.pages[0].text,text);
  assert.doesNotMatch(output.body,/storageKey|storage_key|token_hash|knownSourceHash|userId/);
  const input={format:"json",content:JSON.stringify(exported)},preview=await f.request("POST","/api/items/import/preview",input,b.cookie);assert.equal(preview.json().missingOriginals,1,preview.body);
  const imported=await f.request("POST","/api/items/import",input,b.cookie);assert.equal(imported.statusCode,200,imported.body);assert.equal(imported.json().saved,1);assert.equal(imported.json().missingOriginals,1);
  const restored=(await f.request("GET","/api/items",undefined,b.cookie)).json().items[0];assert.equal(restored.kind,"pdf");assert.equal(restored.pdf.state,"missing");assert.equal(restored.pdf.hasOriginal,false);assert.equal(restored.favourite,true);
  assert.equal((await f.request("GET",`/api/items/${restored.id}/pages`,undefined,b.cookie)).json().pages[0].text,text);
  const summary=(await f.request("GET",`/api/items/${restored.id}/summary`,undefined,b.cookie)).json();assert.equal(summary.saved.imported,true);assert.equal(summary.saved.stale,false);
  assert.equal((await f.request("GET","/api/items?q=sediment",undefined,b.cookie)).json().total,1);
  assert.equal((await f.request("POST",`/api/items/${restored.id}/download`,{},b.cookie)).statusCode,503);
  assert.equal((await f.request("GET",`/api/items/${restored.id}`,undefined,a.cookie)).statusCode,404);
  const repeated=await f.request("POST","/api/items/import",input,b.cookie);assert.equal(repeated.json().duplicates,1);
  await f.request("POST",`/api/items/${restored.id}/lifecycle`,{action:"trash"},b.cookie);await f.request("POST",`/api/items/${restored.id}/lifecycle`,{action:"purge"},b.cookie);
  assert.equal((await f.db.execute(sql`select * from blob_cleanup where user_id=${b.user.id}`)).rows.length,0);
 }finally{await f.close();}
});

test("JSON import identity survives request expiry and rejected snapshots do not create partial items",async()=>{
 const f=await fixture();
 try{
  const a=await f.signup(),input={format:"json",content:JSON.stringify({version:2,items:[{kind:"idea",body:"Two different ideas can share content"},{kind:"idea",body:"Two different ideas can share content"}]})};
  assert.equal((await f.request("POST","/api/items/import",input,a.cookie)).json().saved,2);
  const {sql}=await import("drizzle-orm");await f.db.execute(sql`delete from item_requests`);
  assert.equal((await f.request("POST","/api/items/import/preview",input,a.cookie)).json().duplicates,2);
  assert.equal((await f.request("POST","/api/items/import",input,a.cookie)).json().duplicates,2);
  const bad={format:"json",content:JSON.stringify({version:2,items:[{kind:"pdf",title:"Missing metadata"},{kind:"idea",body:"invalid\u0000text"}]})};
  const preview=await f.request("POST","/api/items/import/preview",bad,a.cookie);assert.equal(preview.json().rejected.length,2);
  const report=await f.request("POST","/api/items/import",bad,a.cookie);assert.equal(report.json().saved,0);assert.equal((await f.request("GET","/api/items",undefined,a.cookie)).json().total,2);
 }finally{await f.close();}
});
