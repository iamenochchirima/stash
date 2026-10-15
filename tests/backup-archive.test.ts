import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipFile } from "../apps/server/node_modules/yazl/index.js";
import { fixture } from "./helpers.js";
import { pdf } from "./pdf-fixture.js";
import { localFileStore } from "../apps/server/src/file-store.js";
import { processPdfJob } from "../apps/server/src/pdf-worker.js";
import { createBackupExport } from "../apps/server/src/backup-export.js";
import { openBackup } from "../apps/web/lib/backups/archive.js";
import { sql } from "drizzle-orm";
import { BACKUP_LIMITS } from "@stash/shared";
async function collect(stream:NodeJS.ReadableStream){const chunks:Buffer[]=[];for await(const part of stream as AsyncIterable<Buffer>)chunks.push(Buffer.from(part));return Buffer.concat(chunks);}
async function archive(entries:{name:string;bytes:Buffer;mode?:number}[]){const zip=new ZipFile();for(const entry of entries)zip.addBuffer(entry.bytes,entry.name,{mode:entry.mode||0o100600,compress:false});const output=collect(zip.outputStream);zip.end();return output;}
function fixtureManifest(id:string,sha256:string){return{format:"stash-backup",version:2,exportedAt:new Date().toISOString(),profile:{name:"Test",email:"test@example.test",bio:"",interests:[]},projects:[],collections:[],items:[{id,path:`items/${id}.json`,sha256,original:null}]};}

test("Full ZIP contains complete item JSON, checked originals, empty collections and project associations",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"stash-zip-test-")),store=localFileStore(directory),f=await fixture({fileStore:store});
 try{
  const a=await f.signup(),b=await f.signup();await f.request("POST","/api/collections",{name:"Empty collection"},a.cookie);
  const projectResponse=await f.request("POST","/api/projects",{name:"Research workspace"},a.cookie);assert.equal(projectResponse.statusCode,200,projectResponse.body);const project=projectResponse.json().project;
  await f.request("POST","/api/items",{kind:"idea",title:"Working research",body:"Full project context",projectId:project.id},a.cookie);
  await f.request("POST","/api/items",{kind:"note",title:"Library note",body:"Complete personal notes"},a.cookie);
  const bytes=pdf(),ticket=(await f.request("POST","/api/items/uploads",{filename:"Original.pdf",byteSize:bytes.length},a.cookie)).json();
  const saved=await f.request("POST",`/uploads/${ticket.id}`,bytes,undefined,{authorization:`Bearer ${ticket.token}`,"content-type":"application/pdf"});assert.equal(saved.statusCode,200,saved.body);
  await processPdfJob(f.db,store);
  const exported=await createBackupExport(f.db,a.user.id,store),buffer=await collect(exported.stream),backup=await openBackup(new Blob([buffer]));
  try{
   assert.equal(backup.manifest.items.length,3);assert.equal(backup.manifest.projects.length,1);assert.ok(backup.manifest.collections.some(c=>c.name==="Empty collection"));
   for(const ref of backup.manifest.items){const{item}=await backup.readItem(ref.id);if(item.kind==="pdf")assert.ok(Buffer.from(await backup.readOriginal(ref.id)).equals(bytes));if(item.projectId)assert.equal(item.body,"Full project context");}
   assert.doesNotMatch(JSON.stringify(backup.manifest),/storage_key|storageKey|token_hash|passwordHash/);
  }finally{await backup.close();}
  const foreign=await createBackupExport(f.db,b.user.id,store),other=await openBackup(new Blob([await collect(foreign.stream)]));assert.equal(other.manifest.items.length,0);await other.close();
 }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});

test("Backup validation rejects corrupt indexes, oversized entries, traversal, symlinks and checksum changes",async()=>{
 const id=randomUUID(),item=Buffer.from(JSON.stringify({id,kind:"note",body:"Original content"})),hash=createHash("sha256").update(item).digest("hex"),manifest=fixtureManifest(id,hash);
 const good=await archive([{name:`items/${id}.json`,bytes:item},{name:"manifest.json",bytes:Buffer.from(JSON.stringify(manifest))}]);
 const valid=await openBackup(new Blob([good]));assert.equal((await valid.readItem(id)).item.body,"Original content");await valid.close();
 await assert.rejects(openBackup(new Blob([good.subarray(0,good.length-10)])));
 const traversal=Buffer.from(good);let offset=0;while((offset=traversal.indexOf(Buffer.from("items/"),offset))>=0){traversal.write("../xx/",offset);offset+=6;}await assert.rejects(openBackup(new Blob([traversal])));
 const symlink=await archive([{name:`items/${id}.json`,bytes:Buffer.from("/etc/passwd"),mode:0o120777},{name:"manifest.json",bytes:Buffer.from(JSON.stringify(manifest))}]);await assert.rejects(openBackup(new Blob([symlink])));
 const oversized=Buffer.from(good),central=oversized.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));assert.ok(central>=0);oversized.writeUInt32LE(BACKUP_LIMITS.itemBytes+1,central+24);await assert.rejects(openBackup(new Blob([oversized])));
 const mismatch=await archive([{name:`items/${id}.json`,bytes:Buffer.from(JSON.stringify({id,kind:"note",body:"Changed content"}))},{name:"manifest.json",bytes:Buffer.from(JSON.stringify(manifest))}]);
 const damaged=await openBackup(new Blob([mismatch]));await assert.rejects(damaged.readItem(id),/checksum/);await damaged.close();
});


test("Full backup preserves the legal maximum project document and twenty prior bodies",async()=>{
 const f=await fixture();try{
  const a=await f.signup(),project=(await f.request("POST","/api/projects",{name:"Long research"},a.cookie)).json().project;
  const saved=await f.request("POST","/api/items",{kind:"note",projectId:project.id,title:"Complete history",body:"Initial research"},a.cookie);assert.equal(saved.statusCode,200,saved.body);const id=saved.json().item.id;
  await f.db.execute(sql`update resources set body=repeat(chr(1),500000),revision=21 where id=${id}`);
  await f.db.execute(sql`insert into project_item_history(user_id,resource_id,revision,body,actor) select ${a.user.id},${id},n,repeat(chr(1),500000),'web' from generate_series(1,20) n`);
  const exported=await createBackupExport(f.db,a.user.id,undefined),backup=await openBackup(new Blob([await collect(exported.stream)]));
  try{const{item,bytes}=await backup.readItem(backup.manifest.items[0].id);assert.equal(item.body.length,500000);assert.equal(item.history.length,20);assert.ok(item.history.every(h=>h.body.length===500000));assert.ok(bytes.length>60*1024*1024);assert.ok(bytes.length<BACKUP_LIMITS.itemBytes);}finally{await backup.close();}
 }finally{await f.close();}
});
