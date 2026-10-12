import { resolve } from "node:path";
export function config(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const emailDisabled = env.EMAIL_DISABLED === "true";
  const origin = env.WEB_ORIGIN || "http://127.0.0.1:3000";
  const publicApiUrl = env.PUBLIC_API_URL || "http://127.0.0.1:4000";
  const port = Number(env.PORT || 4000);
  for (const [name, value] of [
    ["WEB_ORIGIN", origin],
    ["PUBLIC_API_URL", publicApiUrl],
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
      (!emailDisabled && (!env.SMTP_URL || !env.MAIL_FROM)) ||
      !env.DELETION_JOURNAL_DIR)
  )
    throw new Error(
      "Production requires DATABASE_URL and a durable DELETION_JOURNAL_DIR, plus SMTP_URL and MAIL_FROM unless EMAIL_DISABLED=true.",
    );
  if (
    env.SMTP_URL &&
    !["smtp:", "smtps:"].includes(new URL(env.SMTP_URL).protocol)
  )
    throw new Error("SMTP_URL must use smtp or smtps.");
  return {
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
    mailFrom: env.MAIL_FROM || "Stash <hello@localhost.invalid>",
  };
}
