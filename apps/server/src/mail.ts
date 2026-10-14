import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
export type Mail = { to: string; subject: string; text: string; idempotencyKey?: string };
export type Mailer = { send: (mail: Mail) => Promise<void> };
export function createMailer(options: {
  resendApiKey?: string;
  smtpUrl?: string;
  from?: string;
  directory: string;
  production: boolean;
  disabled?: boolean;
}): Mailer {
  if (options.disabled) return { async send() { throw new Error("Email delivery disabled"); } };
  if (options.resendApiKey) {
    if (!options.from) throw new Error("MAIL_FROM is required for Resend.");
    return {
      async send(mail) {
        const { idempotencyKey, ...content } = mail;
        try {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${options.resendApiKey}`,
              "Content-Type": "application/json",
              ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
            },
            body: JSON.stringify({ from: options.from, ...content, to: [mail.to] }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok) throw new Error("Email delivery failed.");
          const result = await response.json() as { id?: string };
          if (!result.id) throw new Error("Email delivery failed.");
        } catch {
          throw new Error("Email delivery failed.");
        }
      },
    };
  }
  if (options.production && !options.smtpUrl)
    throw new Error("RESEND_API_KEY or SMTP_URL is required in production.");
  const smtp = options.smtpUrl ? new URL(options.smtpUrl) : null;
  smtp?.searchParams.set("connectionTimeout", "10000");
  smtp?.searchParams.set("socketTimeout", "10000");
  const transport = smtp ? nodemailer.createTransport(smtp.toString()) : null;
  return {
    async send(mail) {
      if (transport) {
        const { idempotencyKey, ...content } = mail;
        await transport.sendMail({ from: options.from, ...content, ...(idempotencyKey ? { messageId: `<${idempotencyKey}@stash.kasitek.co.za>` } : {}) });
        return;
      }
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      await writeFile(
        join(options.directory, `${Date.now()}-${randomUUID()}.json`),
        JSON.stringify(mail),
        { mode: 0o600 },
      );
    },
  };
}
