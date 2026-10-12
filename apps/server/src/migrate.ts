import { openDatabase } from "@stash/db";
import { config } from "./config.js";
const settings = config();
const connection = await openDatabase({ url: settings.databaseUrl });
try {
  await connection.migrate();
  console.log("Stash database migrations applied.");
} finally {
  await connection.close();
}
