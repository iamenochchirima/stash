import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { fixture } from "./helpers.js";
import { pdf } from "./pdf-fixture.js";
import { localFileStore } from "../apps/server/src/file-store.js";

test("Topics create concurrently by normalized name, retain descriptions, and isolate kinds and owners", async () => {
 const f=await fixture();
 try {
  const a=await f.signup(), b=await f.signup();
  assert.deepEqual((await f.request("GET","/api/topics",undefined,a.cookie)).json().items,[]);
  const creates=await Promise.all(["  Agent   Research ","AGENT RESEARCH","Ａｇｅｎｔ Research"].map(name=>f.request("POST","/api/topics",{name,description:"Original scope"},a.cookie)));
  for(const r of creates)assert.equal(r.statusCode,200,r.body);
  const topics=creates.map(r=>r.json()); const id=topics[0].topic.id;
  assert.equal(new Set(topics.map(t=>t.topic.id)).size,1);assert.equal(topics.filter(t=>t.created).length,1);
  assert.equal((await f.request("POST","/api/topics",{name:"agent research",description:"Overwrite"},a.cookie)).json().topic.description,"Original scope");
  const own=await f.request("POST","/api/topics",{name:"Agent Research"},b.cookie);assert.notEqual(own.json().topic.id,id);
  for(const method of ["GET","PATCH"])assert.equal((await f.request(method,`/api/topics/${id}`,method==="PATCH"?{name:"stolen"}:undefined,b.cookie)).statusCode,404);
  assert.equal((await f.request("GET",`/api/items?topicId=${id}`,undefined,b.cookie)).statusCode,404);
  assert.equal((await f.request("GET","/api/collections",undefined,a.cookie)).json().items.length,1);
  assert.equal((await f.request("PATCH",`/api/collections/${id}`,{name:"Converted"},a.cookie)).statusCode,404);
  assert.equal((await f.request("DELETE",`/api/collections/${id}`,undefined,a.cookie)).statusCode,404);
  assert.equal((await f.request("GET","/api/topics?q=RESEARCH",undefined,a.cookie)).json().items.length,1);
  const collection=(await f.request("POST","/api/collections",{name:"Ordinary"},a.cookie)).json().item;
  assert.equal((await f.request("POST","/api/topics",{name:collection.name},a.cookie)).statusCode,409);
  assert.equal((await f.request("PATCH",`/api/topics/${id}`,{name:collection.name},a.cookie)).statusCode,409);
  for(const body of [{name:" "},{name:"x".repeat(81)},{name:"valid",description:"x".repeat(4001)}])assert.equal((await f.request("POST","/api/topics",body,a.cookie)).statusCode,400);
 }finally{await f.close();}
});

test("Topic membership survives legacy edits and lifecycle, while deletion preserves resources", async()=>{
 const f=await fixture();
 try{
  const a=await f.signup();const topics=[];
  for(const name of ["Systems","Security"])topics.push((await f.request("POST","/api/topics",{name},a.cookie)).json().topic);
  const collection=(await f.request("GET","/api/collections",undefined,a.cookie)).json().items[0];
  const response=await f.request("POST","/api/items",{kind:"link",url:"https://example.test/topic-source",title:"Topic source",collectionIds:[collection.id],topicIds:topics.map(t=>t.id)},a.cookie);
  assert.equal(response.statusCode,200,response.body);let item=response.json().item;
  assert.equal(item.topicIds.length,2);assert.deepEqual(item.collectionIds,[collection.id]);
  const legacy=await f.request("PATCH",`/api/resources/${item.id}`,{title:"Edited by old client",collectionIds:[]},a.cookie);assert.equal(legacy.statusCode,200,legacy.body);
  item=(await f.request("GET",`/api/items/${item.id}`,undefined,a.cookie)).json().item;assert.equal(item.topicIds.length,2);assert.deepEqual(item.collectionIds,[]);
  assert.equal((await f.request("GET",`/api/items?topicId=${topics[0].id}`,undefined,a.cookie)).json().total,1);
  const count=async()=> (await f.request("GET",`/api/topics/${topics[0].id}`,undefined,a.cookie)).json().topic.itemCount;
  assert.equal(await count(),1);
  for(const [action,n] of [["archive",0],["unarchive",1],["trash",0],["restore",1]] as const){assert.equal((await f.request("POST",`/api/items/${item.id}/lifecycle`,{action},a.cookie)).statusCode,200);assert.equal(await count(),n);}
  assert.equal((await f.request("POST","/api/items",{kind:"idea",body:"Invalid",collectionIds:[topics[0].id]},a.cookie)).statusCode,404);
  assert.equal((await f.request("POST","/api/items",{kind:"idea",body:"Invalid",topicIds:[collection.id]},a.cookie)).statusCode,404);
  const project=(await f.request("POST","/api/projects",{name:"Specific outcome"},a.cookie)).json().project;
  assert.equal((await f.request("POST","/api/items",{kind:"idea",body:"Project idea",projectId:project.id,topicIds:[topics[0].id]},a.cookie)).statusCode,400);
  await f.request("DELETE",`/api/topics/${topics[0].id}`,undefined,a.cookie);
  item=(await f.request("GET",`/api/items/${item.id}`,undefined,a.cookie)).json().item;assert.deepEqual(item.topicIds,[topics[1].id]);
  assert.equal((await f.request("DELETE",`/api/topics/${topics[0].id}`,undefined,a.cookie)).statusCode,200);
 }finally{await f.close();}
});

test("Topics and collections share a serialized quota and topic reuse works at capacity",async()=>{
 const f=await fixture();try{
  const a=await f.signup();
  await f.db.execute(sql`insert into collections(user_id,name) select ${a.user.id},'Existing '||n from generate_series(1,98) n`);
  const results=await Promise.all(["Last topic","Over limit"].map(name=>f.request("POST","/api/topics",{name},a.cookie)));
  assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
  const topic=results.find(r=>r.statusCode===200)!.json().topic;
  assert.equal((await f.request("POST","/api/topics",{name:topic.name.toUpperCase()},a.cookie)).json().created,false);
  assert.equal((await f.request("POST","/api/collections",{name:"Excess collection"},a.cookie)).statusCode,409);
 }finally{await f.close();}
});

test("PDF topic capture validates ownership again at commit and topic deletion preserves originals",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"stash-topics-"));const store=localFileStore(directory), f=await fixture({fileStore:store});
 try{
  const a=await f.signup(),b=await f.signup(),content=pdf();
  const topic=(await f.request("POST","/api/topics",{name:"PDF research"},a.cookie)).json().topic;
  assert.equal((await f.request("POST","/api/items/uploads",{filename:"Source.pdf",byteSize:content.length,topicIds:[topic.id]},b.cookie)).statusCode,404);
  const ticket=(await f.request("POST","/api/items/uploads",{filename:"Source.pdf",byteSize:content.length,topicIds:[topic.id],requestId:randomUUID()},a.cookie)).json();
  const uploaded=await f.request("POST",`/uploads/${ticket.id}`,content,undefined,{authorization:`Bearer ${ticket.token}`,"content-type":"application/pdf"});assert.equal(uploaded.statusCode,200,uploaded.body);
  const item=uploaded.json().item;assert.deepEqual(item.topicIds,[topic.id]);
  await f.request("DELETE",`/api/topics/${topic.id}`,undefined,a.cookie);
  const permission=await f.request("POST",`/api/items/${item.id}/download`,{},a.cookie);assert.equal(permission.statusCode,200,permission.body);
  assert.equal((await f.request("GET",`/api/items/${item.id}`,undefined,a.cookie)).json().item.pdf.hasOriginal,true);
  const pendingTopic=(await f.request("POST","/api/topics",{name:"Deleted during upload"},a.cookie)).json().topic;
  const pending=(await f.request("POST","/api/items/uploads",{filename:"Pending.pdf",byteSize:content.length,topicIds:[pendingTopic.id]},a.cookie)).json();
  await f.request("DELETE",`/api/topics/${pendingTopic.id}`,undefined,a.cookie);
  assert.equal((await f.request("POST",`/uploads/${pending.id}`,content,undefined,{authorization:`Bearer ${pending.token}`,"content-type":"application/pdf"})).statusCode,404);
 }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});
