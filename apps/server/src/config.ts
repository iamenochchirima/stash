import { backblazeFileStore, localFileStore } from "./file-store.js";
import { mfaCipher } from "./admin-crypto.js";
import { resolve } from "node:path";
export function config(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const emailDisabled = env.EMAIL_DISABLED === "true";
  const origin = env.WEB_ORIGIN || "http://127.0.0.1:3000";
  const publicApiUrl = env.PUBLIC_API_URL || "http://127.0.0.1:4000";
  const adminOrigin = env.ADMIN_WEB_ORIGIN || "http://127.0.0.1:3001";
  if (env.ADMIN_ENCRYPTION_KEY) {
    mfaCipher(env.ADMIN_ENCRYPTION_KEY);
    if (production && !env.ADMIN_WEB_ORIGIN) throw new Error("Admin access requires ADMIN_WEB_ORIGIN in production.");
  }
  const port = Number(env.PORT || 4000);
  for (const [name, value] of [
    ["WEB_ORIGIN", origin],
    ["PUBLIC_API_URL", publicApiUrl],
    ...(env.ADMIN_ENCRYPTION_KEY ? [["ADMIN_WEB_ORIGIN", adminOrigin]] : []),
  ]) {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(
        `${name} must be an HTTP origin without credentials or a path.`,
      );
    if (production && url.protocol !== "https:")
      throw new Error(`${name} must use HTTPS in production.`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535.");
  if (
    production &&
    (!env.DATABASE_URL ||
      (!emailDisabled && ((!env.RESEND_API_KEY && !env.SMTP_URL) || !env.MAIL_FROM)) ||
      !env.DELETION_JOURNAL_DIR)
  )
    throw new Error(
      "Production requires DATABASE_URL and a durable DELETION_JOURNAL_DIR, plus RESEND_API_KEY or SMTP_URL and MAIL_FROM unless EMAIL_DISABLED=true.",
    );
  if (
    env.SMTP_URL &&
    !["smtp:", "smtps:"].includes(new URL(env.SMTP_URL).protocol)
  )
    throw new Error("SMTP_URL must use smtp or smtps.");
  const b2Configured = [env.B2_ENDPOINT, env.B2_REGION, env.B2_BUCKET, env.B2_KEY_ID, env.B2_APPLICATION_KEY];
  if (b2Configured.some(Boolean) && !b2Configured.every(Boolean)) throw new Error("Backblaze storage configuration is incomplete.");
  const fileStore = b2Configured.every(Boolean) ? backblazeFileStore({ endpoint: env.B2_ENDPOINT!, region: env.B2_REGION!, bucket: env.B2_BUCKET!, keyId: env.B2_KEY_ID!, applicationKey: env.B2_APPLICATION_KEY! }) : !production ? localFileStore(resolve(env.FILE_DIR || "../../.data/files")) : undefined;
  return {
    fileStore,
    itemsEnabled: env.LIBRARY_V2_ENABLED === "true" || !production,
    adminOrigin,
    adminEncryptionKey: env.ADMIN_ENCRYPTION_KEY,
    production,
    emailDisabled,
    origin,
    publicApiUrl,
    port,
    databaseUrl: env.DATABASE_URL,
    dataPath: resolve(env.DATA_DIR || "../../.data/stash"),
    deletionJournalDir: resolve(
      env.DELETION_JOURNAL_DIR || "../../.data/deletions",
    ),
    mailPath: resolve(env.MAIL_DIR || "../../.data/mail"),
    smtpUrl: env.SMTP_URL,
    resendApiKey: env.RESEND_API_KEY,
    mailFrom: env.MAIL_FROM || "Stash <hello@localhost.invalid>",
  };
}
