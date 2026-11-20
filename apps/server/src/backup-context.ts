import type { Database } from "@stash/db";
import { sql } from "drizzle-orm";
import { AppError } from "@stash/core";
import type { BackupManifest } from "@stash/shared";
export type RestoreManifest=Pick<BackupManifest,"version"|"projects"|"collections"|"topics"|"items"|"todos">;
export type RestoreContext={tokenHash:string;userId:string;manifest:RestoreManifest|null;manifestHash:string;createdProjects:string[]};
export async function restoreContext(db:Database,tokenHash:string):Promise<RestoreContext>{
 const result=await db.execute(sql`select b.user_id,b.manifest,b.manifest_hash,b.created_projects from backup_restores b join users u on u.id=b.user_id join sessions s on s.hash=b.session_hash where b.token_hash=${tokenHash} and b.expires_at>now() and b.created_at>now()-interval '24 hours' and s.expires_at>now() and u.suspended_at is null and s.user_id=b.user_id`);
 const row=result.rows[0];if(!row)throw new AppError(401,"Restore permission has expired. Choose the backup again.");
 return{tokenHash,userId:String(row.user_id),manifest:row.manifest as RestoreManifest|null,manifestHash:String(row.manifest_hash),createdProjects:row.created_projects as string[]};
}
