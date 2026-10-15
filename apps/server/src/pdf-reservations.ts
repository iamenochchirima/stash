import type { Database } from "@stash/db";
import { sql } from "drizzle-orm";
import { AppError } from "@stash/core";
import { LIMITS } from "@stash/shared";
// Call with the global storage reservation lock and the account row already locked.
export async function requirePdfCapacity(tx:Database,userId:string,byteSize:number,newItem=true){
 const global=await tx.execute(sql`select ((select coalesce(sum(byte_size) filter(where storage_key is not null),0) from attachments)+(select coalesce(sum(byte_size),0) from blob_cleanup))::bigint as bytes`);
 if(Number(global.rows[0].bytes)+byteSize>5*1024*1024*1024)throw new AppError(503,"PDF storage is full. Try again later.");
 const usage=await tx.execute(sql`select (coalesce(sum(byte_size) filter(where storage_key is not null),0)+(select coalesce(sum(byte_size),0) from blob_cleanup where user_id=${userId}))::bigint as bytes,count(*) filter(where resource_id is null)::int as pending from attachments where user_id=${userId}`);
 const used=usage.rows[0];
 if(Number(used.bytes)+byteSize>500*1024*1024)throw new AppError(409,"Your PDF storage limit has been reached.");
 if(Number(used.pending)>=3)throw new AppError(429,"Finish your current uploads before adding another.");
 if(newItem){const count=await tx.execute(sql`select count(*)::int as total from resources where user_id=${userId}`);if(Number(count.rows[0].total)+Number(used.pending)>=LIMITS.resources)throw new AppError(409,"Your item limit has been reached.");}
}
