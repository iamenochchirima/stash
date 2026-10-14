import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";
export async function maintainAdmin(db:Database){
  await db.transaction(async tx=>{
    await tx.execute(sql`delete from admin_sessions where expires_at<now() or last_active_at<now()-interval '30 minutes'`);
    await tx.execute(sql`delete from admin_invites where expires_at<now()`);
    await tx.execute(sql`delete from admin_email_jobs where status IN ('sent','failed') AND created_at<now()-interval '7 days'`);
    await tx.execute(sql`delete from admin_audit where created_at<now()-interval '90 days'`);
  });
}
