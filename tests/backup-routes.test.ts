import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { fixture } from "./helpers.js";
import { openBackup } from "../apps/web/lib/backups/archive.js";

test("Full backup grants are private, single-use, session-bound and account-scoped",async()=>{
 const f=await fixture();
 try{
  const a=await f.signup(),b=await f.signup();
  await f.request("POST","/api/items",{kind:"note",title:"Private backup",body:"Only account A"},a.cookie);
  assert.equal((await f.request("POST","/api/backups/export",{})).statusCode,401);
  assert.equal((await f.request("POST","/api/backups/export",{},a.cookie,{origin:"https://foreign.example"})).statusCode,403);
  const ticket=(await f.request("POST","/api/backups/export",{},a.cookie)).json();
  const path=new URL(ticket.downloadUrl).pathname,headers={authorization:`Bearer ${ticket.token}`};
  assert.equal((await f.request("GET",path,undefined,undefined,{...headers,origin:"https://foreign.example"})).statusCode,403);
  assert.equal((await f.request("GET",path,undefined,b.cookie)).statusCode,401);
  const result=await f.request("GET",path,undefined,undefined,headers);
  assert.equal(result.statusCode,200);assert.match(String(result.headers["content-type"]),/application\/zip/);assert.equal(result.headers["cache-control"],"no-store");
  const backup=await openBackup(new Blob([result.rawPayload]));try{assert.equal(backup.manifest.items.length,1);assert.equal((await backup.readItem(backup.manifest.items[0].id)).item.body,"Only account A");}finally{await backup.close();}
  assert.equal((await f.request("GET",path,undefined,undefined,headers)).statusCode,401);
  const foreignTicket=(await f.request("POST","/api/backups/export",{},b.cookie)).json();
  const foreign=await f.request("GET",path,undefined,undefined,{authorization:`Bearer ${foreignTicket.token}`});assert.equal(foreign.statusCode,200);
  const empty=await openBackup(new Blob([foreign.rawPayload]));assert.equal(empty.manifest.items.length,0);await empty.close();
  const logoutTicket=(await f.request("POST","/api/backups/export",{},a.cookie)).json();
  await f.request("POST","/api/auth/logout",{},a.cookie);
  assert.equal((await f.request("GET",path,undefined,undefined,{authorization:`Bearer ${logoutTicket.token}`})).statusCode,401);
 }finally{await f.close();}
});

test("Backup expiry, pending limits and suspended accounts prevent export",async()=>{
 const f=await fixture();try{
  const a=await f.signup();
  const ticket=(await f.request("POST","/api/backups/export",{},a.cookie)).json();
  await f.db.execute(sql`update backup_downloads set expires_at=now()-interval '1 second'`);
  assert.equal((await f.request("GET","/backup-transfers/export",undefined,undefined,{authorization:`Bearer ${ticket.token}`})).statusCode,401);
  for(let i=0;i<3;i++)assert.equal((await f.request("POST","/api/backups/export",{},a.cookie)).statusCode,200);
  assert.equal((await f.request("POST","/api/backups/export",{},a.cookie)).statusCode,429);
  await f.db.execute(sql`update users set suspended_at=now() where id=${a.user.id}`);
  assert.equal((await f.request("POST","/api/backups/export",{},a.cookie)).statusCode,401);
 }finally{await f.close();}
});
