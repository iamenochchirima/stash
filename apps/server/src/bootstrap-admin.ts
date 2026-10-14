import { openDatabase } from "@stash/db";
import { config } from "./config.js";
import { createMailer } from "./mail.js";
import { inviteAdmin } from "./admin-auth.js";
const settings = config();
const address = process.argv[2], name = process.argv[3] || "Stash owner";
if (!address || !settings.adminEncryptionKey) throw new Error("Provide an email and configure ADMIN_ENCRYPTION_KEY and ADMIN_WEB_ORIGIN before bootstrapping.");
const database = await openDatabase({ url: settings.databaseUrl });
try {
  await inviteAdmin(database.db, {
    origin: settings.adminOrigin, encryptionKey: settings.adminEncryptionKey,
    production: settings.production, emailDisabled: settings.emailDisabled,
    mailer: createMailer({ directory: settings.mailPath, production: settings.production, disabled: settings.emailDisabled, resendApiKey: settings.resendApiKey, smtpUrl: settings.smtpUrl, from: settings.mailFrom }),
  }, { email: address, name, role: "owner", bootstrap: true });
  console.log("Initial owner invitation sent. Complete verification and authenticator enrolment through the email link.");
} finally { await database.close(); }
