import { maintainAdmin } from "./admin-maintenance.js";
import { openDatabase } from "@stash/db";
import { config } from "./config.js";
const settings=config();
if(!settings.adminEncryptionKey)throw new Error("Admin access must be configured before administrative retention maintenance.");
const database=await openDatabase({url:settings.databaseUrl});
try{
  await maintainAdmin(database.db);
  console.log("Expired admin sessions/invitations and records beyond the approved retention periods were removed.");
}finally{await database.close();}
