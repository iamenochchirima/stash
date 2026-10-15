import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { parseImport } from "@stash/core/portability";
import { createJsonExport } from "../apps/server/src/backup-export.js";
import { fixture } from "./helpers.js";
test("Bookmark export includes only owned library link titles/URLs, escapes HTML and reports omissions",async()=>{
 const f=await fixture();try{
  const a=await f.signup(),b=await f.signup();
  const first=await f.request("POST","/api/items",{kind:"link",url:"https://example.test/find?a=1&b=2",title:'A <script>alert(1)</script> & "quote"',notes:"Private note excluded"},a.cookie);assert.equal(first.statusCode,200,first.body);
  const archived=(await f.request("POST","/api/items",{kind:"link",url:"https://example.test/archive",title:"Archived source"},a.cookie)).json().item;await f.request("POST",`/api/items/${archived.id}/lifecycle`,{action:"archive"},a.cookie);
  const trash=(await f.request("POST","/api/items",{kind:"link",url:"https://example.test/trash",title:"Trashed source"},a.cookie)).json().item;await f.request("POST",`/api/items/${trash.id}/lifecycle`,{action:"trash"},a.cookie);
  await f.request("POST","/api/items",{kind:"note",body:"Private note body"},a.cookie);await f.request("POST","/api/items",{kind:"idea",body:"Private idea body"},a.cookie);
  await f.db.execute(sql`insert into resources(user_id,kind,title,url) values(${a.user.id},'pdf','Private PDF',null)`);
  const project=(await f.request("POST","/api/projects",{name:"Private project"},a.cookie)).json().project;await f.request("POST","/api/items",{kind:"link",url:"https://example.test/project",projectId:project.id},a.cookie);
  await f.request("POST","/api/items",{kind:"link",url:"https://example.test/foreign",title:"Foreign title"},b.cookie);
  const preview=await f.request("GET","/api/items/bookmarks",undefined,a.cookie);assert.deepEqual(preview.json(),{links:2,omitted:5});
  assert.equal((await f.request("GET","/api/items/bookmarks")).statusCode,401);
  const ticket=(await f.request("POST","/api/backups/export",{format:"bookmarks"},a.cookie)).json();
  const downloaded=await f.request("GET",new URL(ticket.downloadUrl).pathname,undefined,undefined,{authorization:`Bearer ${ticket.token}`});assert.equal(downloaded.statusCode,200,downloaded.body);assert.match(String(downloaded.headers["content-disposition"]),/stash-bookmarks.html/);
  const parsed=parseImport({format:"html",content:downloaded.body});assert.equal(parsed.entries.length,2);assert.doesNotMatch(downloaded.body,/<script>/);assert.equal(parsed.entries[0].url,"https://example.test/find?a=1&b=2");assert.equal(parsed.entries[0].title,'A <script>alert(1)</script> & "quote"');assert.match(downloaded.body,/5 other items omitted/);assert.doesNotMatch(downloaded.body,/Private note|Private idea|Private PDF|Private project|Foreign title|Trashed source/);
  const imported=await f.request("POST","/api/items/import",{format:"html",content:downloaded.body},b.cookie);assert.equal(imported.statusCode,200,imported.body);assert.equal(imported.json().saved,2);
 }finally{await f.close();}
});

test("Data-only JSON downloads keep the v2 contract and one-use permissions",async()=>{
 const f=await fixture();try{
  const a=await f.signup();await f.request("POST","/api/items",{kind:"idea",body:"Complete idea body"},a.cookie);
  const ticket=(await f.request("POST","/api/backups/export",{format:"json"},a.cookie)).json(),path=new URL(ticket.downloadUrl).pathname,headers={authorization:`Bearer ${ticket.token}`};
  const downloaded=await f.request("GET",path,undefined,undefined,headers);assert.equal(downloaded.statusCode,200,downloaded.body);assert.match(String(downloaded.headers["content-disposition"]),/stash-export.json/);assert.equal(downloaded.json().version,2);assert.equal(downloaded.json().items[0].body,"Complete idea body");assert.equal(downloaded.json().excludesOriginalFiles,true);
  assert.equal((await f.request("GET",path,undefined,undefined,headers)).statusCode,401);
 }finally{await f.close();}
});


test("Large data-only exports stream bounded items rather than one complete payload",async()=>{
 const f=await fixture();try{
  const a=await f.signup();await f.db.execute(sql`insert into resources(user_id,kind,title,body,url) select ${a.user.id},'note','Complete long note',repeat('x',50000),null from generate_series(1,120)`);
  const output=await createJsonExport(f.db,a.user.id),parts:Buffer[]=[];let largest=0;for await(const part of output.stream){const bytes=Buffer.from(part);largest=Math.max(largest,bytes.length);parts.push(bytes);}
  assert.ok(parts[0].length<5000);assert.ok(largest<70000);const bytes=Buffer.concat(parts);assert.ok(bytes.length>5*1024*1024);const document=JSON.parse(bytes.toString());assert.equal(document.items.length,120);assert.ok(document.items.every((row:{body:string})=>row.body.length===50000));
 }finally{await f.close();}
});
