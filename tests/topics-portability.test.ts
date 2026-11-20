import { test } from "node:test";
import assert from "node:assert/strict";
import { topicService } from "@stash/core";
import { importItems, exportItems, previewItemsImport } from "@stash/core/items-portability";
import { createBackupExport } from "../apps/server/src/backup-export.js";
import { openBackup } from "../apps/web/lib/backups/archive.js";
import { createHash } from "node:crypto";
import { fixture } from "./helpers.js";

async function collect(stream:NodeJS.ReadableStream){const chunks:Buffer[]=[];for await(const chunk of stream as AsyncIterable<Buffer>)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}

test("JSON v3 round-trips empty topics, descriptions and multiple memberships without overwriting local changes",async()=>{
 const f=await fixture();try{
  const a=await f.signup(),b=await f.signup(),topics=topicService(f.db,a.user.id);
  const security=(await topics.ensure({name:"Security Engineering",description:"Application, infrastructure and agentic security"})).topic;
  const agents=(await topics.ensure({name:"AI Agent Engineering",description:"Build and evaluate agents"})).topic;
  await topics.ensure({name:"Future research",description:"Empty topics survive exports"});
  const collection=(await f.request("POST","/api/collections",{name:"Reading queue"},a.cookie)).json().item;
  const saved=await f.request("POST","/api/items",{kind:"idea",body:"Secure agent tool execution",topicIds:[security.id,agents.id],collectionIds:[collection.id]},a.cookie);assert.equal(saved.statusCode,200,saved.body);
  const exported=await exportItems(f.db,a.user.id);assert.equal(exported.version,3);assert.equal(exported.topics.length,3);assert.deepEqual(exported.items[0].topics.sort(),[agents.name,security.name].sort());assert.deepEqual(exported.items[0].collections,[collection.name]);
  const input={format:"json",content:JSON.stringify(exported)},preview=await previewItemsImport(f.db,b.user.id,input);assert.equal(preview.topicsToCreate,3);
  const imported=await importItems(f.db,b.user.id,input);assert.equal(imported.saved,1);assert.deepEqual(imported.topicErrors,[]);
  const restored=await exportItems(f.db,b.user.id);assert.deepEqual(restored.topics,exported.topics);assert.deepEqual(restored.items[0].topics.sort(),exported.items[0].topics.sort());assert.equal((await topics.list()).length,3);
  const local=await topicService(f.db,b.user.id).ensure({name:" security   ENGINEERING ",description:"Do not overwrite"});assert.equal(local.created,false);
  await topicService(f.db,b.user.id).update(local.topic.id,{description:"Newer local description"});
  const localItem=(await f.request("GET","/api/items",undefined,b.cookie)).json().items[0];
  await f.request("PATCH",`/api/items/${localItem.id}`,{revision:localItem.revision,topicIds:[]},b.cookie);
  const again=await importItems(f.db,b.user.id,input);assert.equal(again.duplicates,1);assert.equal((await topicService(f.db,b.user.id).get(local.topic.id)).description,"Newer local description");assert.deepEqual((await exportItems(f.db,b.user.id)).items[0].topics,[]);
  assert.equal((await previewItemsImport(f.db,b.user.id,input)).topicsToCreate,0);
 }finally{await f.close();}
});

test("ZIP v4 restores topic metadata and memberships with retry-safe account-scoped mapping",async()=>{
 const f=await fixture();let backup:Awaited<ReturnType<typeof openBackup>>|undefined;try{
  const a=await f.signup(),b=await f.signup(),c=await f.signup();
  const topic=(await topicService(f.db,a.user.id).ensure({name:"Practical System Design",description:"Reliable software"})).topic;
  await topicService(f.db,a.user.id).ensure({name:"Business AI Systems",description:"Real business workflows"});
  await topicService(f.db,c.user.id).ensure({name:topic.name,description:"Other account"});
  await f.request("POST","/api/items",{kind:"note",body:"Design notes",topicIds:[topic.id]},a.cookie);
  backup=await openBackup(new Blob([await collect((await createBackupExport(f.db,a.user.id,undefined)).stream)]));assert.equal(backup.manifest.version,4);assert.equal(backup.manifest.topics.length,2);assert.equal(backup.manifest.collections.length,1);
  const permission=(await f.request("POST","/api/backups/restore",{manifestHash:createHash("sha256").update(backup.manifestBytes).digest("hex")},b.cookie)).json();
  const headers={authorization:`Bearer ${permission.token}`,"content-type":"application/vnd.stash.backup+json"};
  const manifest=await f.request("POST","/backup-transfers/restore/manifest",Buffer.from(backup.manifestBytes),undefined,headers);assert.equal(manifest.statusCode,200,manifest.body);
  const ref=backup.manifest.items[0],record=await backup.readItem(ref.id);assert.deepEqual(record.item.topics,[topic.name]);
  for(let n=0;n<2;n++){const result=await f.request("POST",`/backup-transfers/restore/items/${ref.id}`,Buffer.from(record.bytes),undefined,headers);assert.equal(result.statusCode,200,result.body);assert.equal(result.json().duplicate,n===1);}
  assert.equal((await f.request("POST","/backup-transfers/restore/finish",{},undefined,{authorization:headers.authorization})).statusCode,200);
  const restored=await exportItems(f.db,b.user.id);assert.deepEqual(restored.topics,backup.manifest.topics);assert.deepEqual(restored.items[0].topics,[topic.name]);assert.equal((await topicService(f.db,c.user.id).list())[0].description,"Other account");
 }finally{await backup?.close();await f.close();}
});

test("Versioned topic imports reject ambiguous, missing and unknown metadata; old v2 remains importable",async()=>{
 const f=await fixture();try{
  const a=await f.signup(),input=(value:unknown)=>({format:"json",content:JSON.stringify(value)});
  const legacy=await importItems(f.db,a.user.id,input({version:2,items:[{kind:"idea",body:"Old export",userId:"ignored legacy metadata"}]}));assert.equal(legacy.saved,1);
  await assert.rejects(importItems(f.db,a.user.id,input({version:2,topics:[],items:[]})),/version 3/);
  await assert.rejects(importItems(f.db,a.user.id,input({version:3,items:[]})),/include topics/);
  await assert.rejects(importItems(f.db,a.user.id,input({version:3,topics:[{name:"AI"},{name:" ai "}],items:[]})),/duplicated/);
  await assert.rejects(importItems(f.db,a.user.id,input({version:3,topics:[{name:"AI",descripton:"Typo"}],items:[]})));
  const missing=await importItems(f.db,a.user.id,input({version:3,topics:[],items:[{kind:"idea",body:"Missing topic",topics:["AI"]}]}));assert.equal(missing.saved,0);assert.match(missing.rejected[0].error,/topic missing/);
  const unknown=await importItems(f.db,a.user.id,input({version:3,topics:[],items:[{kind:"idea",body:"Unknown metadata",topicNames:["AI"]}]}));assert.equal(unknown.saved,0);
  const project=(await f.request("POST","/api/projects",{name:"Bounded work"},a.cookie)).json().project;
  const invalid=await importItems(f.db,a.user.id,input({version:3,topics:[{name:"AI"}],projects:[{id:project.id,name:project.name}],items:[{kind:"idea",body:"Project membership",projectId:project.id,topics:["AI"]}]}));assert.equal(invalid.saved,0);assert.match(invalid.rejected[0].error,/Project items/);
 }finally{await f.close();}
});


test("Topics survive link, note, idea and PDF data-only records without turning into collections",async()=>{
 const f=await fixture();try{
  const a=await f.signup(),b=await f.signup(),snapshot={version:3,topics:[{name:"Custom research",description:"A user-created area"}],collections:[],items:[
   {kind:"link",url:"https://example.test/custom-research",topics:["Custom research"]},
   {kind:"note",body:"Note context",topics:["Custom research"]},
   {kind:"idea",body:"Idea context",topics:["Custom research"]},
   {kind:"pdf",title:"Research paper",topics:["Custom research"],pdf:{filename:"Research.pdf",byteSize:300,state:"missing",pages:[{page:1,text:"Research text"}],pageCount:1}},
  ]};
  const imported=await importItems(f.db,a.user.id,{format:"json",content:JSON.stringify(snapshot)});assert.equal(imported.saved,4);assert.deepEqual(imported.rejected,[]);
  const exported=await exportItems(f.db,a.user.id);assert.equal(exported.items.length,4);assert.ok(exported.items.every(item=>item.topics[0]==="Custom research"&&item.collections.length===0));
  const restored=await importItems(f.db,b.user.id,{format:"json",content:JSON.stringify(exported)});assert.equal(restored.saved,4);assert.equal(restored.missingOriginals,1);
  assert.deepEqual((await exportItems(f.db,b.user.id)).topics,snapshot.topics);assert.equal((await topicService(f.db,b.user.id).list()).length,1);
 }finally{await f.close();}
});


test("Legacy JSON refuses topic loss and bookmark export reports omitted topics",async()=>{
 const f=await fixture();try{
  const a=await f.signup(),b=await f.signup(),topic=(await topicService(f.db,a.user.id).ensure({name:"Private topic",description:"Private context"})).topic;
  await f.request("POST","/api/items",{kind:"link",url:"https://example.test/public-reference",topicIds:[topic.id]},a.cookie);
  const legacy=await f.request("GET","/api/export",undefined,a.cookie);assert.equal(legacy.statusCode,409);assert.match(legacy.body,/JSON version 3/);
  assert.equal((await f.request("GET","/api/export",undefined,b.cookie)).statusCode,200);
  const counts=await f.request("GET","/api/items/bookmarks",undefined,a.cookie);assert.deepEqual(counts.json(),{links:1,omitted:0,topicsOmitted:1});
  const{exportBookmarks}=await import("@stash/core/bookmarks");const bookmark=await exportBookmarks(f.db,a.user.id),html=[...bookmark.parts()].join("");assert.match(html,/1 topic and its memberships omitted/);assert.doesNotMatch(html,/Private topic|Private context/);
  const invalid=await f.request("POST","/api/import",{format:"json",content:JSON.stringify({version:1,collections:[],topics:[{name:"Topic"}],resources:[]})},a.cookie);assert.equal(invalid.statusCode,400);
 }finally{await f.close();}
});
