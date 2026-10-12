import { sql } from "drizzle-orm";
import { openDatabase } from "@stash/db";
import { createApp } from "./app.js";
import { createDeletionJournal } from "./deletions.js";
import { config } from "./config.js";
import { createMailer } from "./mail.js";
const settings = config();
const database = await openDatabase({ url: settings.databaseUrl });
try {
  await database.db.execute(sql`select 1 from stash_migrations limit 1`);
} catch {
  await database.close();
  throw new Error(
    "Database is unavailable or not initialized. Set DATABASE_URL and run pnpm db:migrate.",
  );
}
const journal = createDeletionJournal(settings.deletionJournalDir);
await journal.apply(database.db);
const app = await createApp(database.db, {
  ...settings,
  journal,
  logger: true,
  mailer: createMailer({
    resendApiKey: settings.resendApiKey,
    smtpUrl: settings.smtpUrl,
    from: settings.mailFrom,
    directory: settings.mailPath,
    production: settings.production,
    disabled: settings.emailDisabled,
  }),
});
await app.listen({
  port: settings.port,
  host: settings.production ? "0.0.0.0" : "127.0.0.1",
});
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await app.close();
    await database.close();
    process.exit(0);
  });
