import { mkdir,appendFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";
import type { FileStore } from "./file-store.js";
const eventSchema=z.object({seq:z.string().regex(/^[1-9][0-9]{0,18}$/),key:z.string().regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.pdf$/),userId:z.string().uuid(),byteSize:z.number().int().min(0).max(20971520),kind:z.enum(["put","remove","removed"]),recordedAt:z.string().datetime()}).strict();
type StorageEvent=z.infer<typeof eventSchema>;
async function remember(db:Database,events:StorageEvent[]){
 if(!events.length)return;
 const latest=new Map<string,StorageEvent>();for(const event of events){const previous=latest.get(event.key);if(!previous||BigInt(event.seq)>BigInt(previous.seq))latest.set(event.key,event);}
 await db.execute(sql`insert into storage_file_ledger(storage_key,user_id,byte_size,state,last_event_seq,recorded_at)
 select e.key,e."userId"::uuid,e."byteSize",e.kind,e.seq::bigint,e."recordedAt"::timestamptz from jsonb_to_recordset(${JSON.stringify([...latest.values()])}::jsonb) as e(key text,"userId" text,"byteSize" int,kind text,seq text,"recordedAt" text)
 on conflict(storage_key) do update set byte_size=excluded.byte_size,state=excluded.state,last_event_seq=excluded.last_event_seq,recorded_at=excluded.recorded_at where storage_file_ledger.last_event_seq<excluded.last_event_seq`);
}
export function createStorageJournal(directory:string){
 const path=join(directory,"storage-events.jsonl");
 const journal={
  async record(db:Database,key:string,kind:"put"|"remove"|"removed",byteSize:number){
   const userId=z.string().uuid().parse(key.split("/")[0]);
   const sequence=await db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(78134930)`);return String((await tx.execute(sql`select nextval('storage_file_event_order')::text as seq`)).rows[0].seq);});
   const event=eventSchema.parse({seq:sequence,key,userId,kind,byteSize,recordedAt:new Date().toISOString()});
   await mkdir(directory,{recursive:true,mode:0o700});
   // Disk intent precedes the object write. The journal must survive database rollback.
   await appendFile(path,JSON.stringify(event)+"\n",{mode:0o600,flush:true});await remember(db,[event]);
  },
  async replay(db:Database){
   let count=0,batch:StorageEvent[]=[];
   try{
    const reader=createInterface({input:createReadStream(path,{encoding:"utf8"}),crlfDelay:Infinity});
    for await(const line of reader){if(!line)continue;if(Buffer.byteLength(line)>2048)throw new Error("Invalid storage journal");const event=eventSchema.parse(JSON.parse(line));if(event.key.split("/")[0]!==event.userId)throw new Error("Invalid storage journal");batch.push(event);count++;if(batch.length===250){await remember(db,batch);batch=[];}}
    await remember(db,batch);
   }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw new Error("Storage journal could not be replayed");
    const existing=await db.execute(sql`select storage_key from storage_file_ledger limit 1`);if(existing.rows.length)throw new Error("Persistent storage journal is missing");}
   await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(78134930)`);
    await tx.execute(sql`select setval('storage_file_event_order',greatest((select last_value from storage_file_event_order),(select coalesce(max(last_event_seq),1) from storage_file_ledger)),true)`);
   });
   // Seed originals/reservations from the pre-journal release without rewriting their objects.
   for(;;){const legacy=await db.execute(sql`select a.storage_key,a.byte_size from attachments a where a.storage_key is not null and not exists(select 1 from storage_file_ledger l where l.storage_key=a.storage_key) limit 250`);if(!legacy.rows.length)break;for(const row of legacy.rows)await journal.record(db,String(row.storage_key),"put",Number(row.byte_size));}
   // Completed physical deletion remains authoritative after restoring older metadata.
   await db.execute(sql`update item_jobs j set state='cancelled',lease_until=null,error_code='original_missing',updated_at=now() from attachments a,storage_file_ledger l where j.resource_id=a.resource_id and j.kind='extract' and j.state in('queued','running') and a.storage_key=l.storage_key and l.state in('remove','removed')`);
   const missing=await db.execute(sql`update attachments a set storage_key=null,state='missing',upload_token_hash=null,updated_at=now() from storage_file_ledger l where a.storage_key=l.storage_key and l.state in('remove','removed') and a.resource_id is not null returning a.id`);
   await db.execute(sql`delete from attachments a using storage_file_ledger l where a.storage_key=l.storage_key and l.state in('remove','removed') and a.resource_id is null`);
   await db.execute(sql`delete from blob_cleanup b using storage_file_ledger l where b.storage_key=l.storage_key and l.state='removed'`);
   const queued=await db.execute(sql`insert into blob_cleanup(user_id,storage_key,byte_size) select l.user_id,l.storage_key,l.byte_size from storage_file_ledger l where l.state in('put','remove') and not exists(select 1 from attachments a where a.storage_key=l.storage_key) on conflict(storage_key) do nothing returning id`);
   return{events:count,missing:missing.rows.length,queued:queued.rows.length};
  },
 };
 return journal;
}
export function journaledFileStore(store:FileStore,db:Database,journal:ReturnType<typeof createStorageJournal>):FileStore{
 return{async put(key,content){await journal.record(db,key,"put",content.length);await store.put(key,content);},get:key=>store.get(key),async remove(key){
  const size=await db.execute(sql`select coalesce((select byte_size from storage_file_ledger where storage_key=${key}),(select byte_size from blob_cleanup where storage_key=${key}),0)::int as bytes`);
  await journal.record(db,key,"remove",Number(size.rows[0].bytes));await store.remove(key);await journal.record(db,key,"removed",0);
 }};
}
