import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
export type Mail = { to: string; subject: string; text: string };
export type Mailer = { send: (mail: Mail) => Promise<void> };
export function createMailer(options: {
  smtpUrl?: string;
  from?: string;
  directory: string;
  production: boolean;
}): Mailer {
  if (options.production && !options.smtpUrl)
    throw new Error("SMTP is required in production.");
  const smtp = options.smtpUrl ? new URL(options.smtpUrl) : null;
  smtp?.searchParams.set("connectionTimeout", "10000");
  smtp?.searchParams.set("socketTimeout", "10000");
  const transport = smtp ? nodemailer.createTransport(smtp.toString()) : null;
  return {
    async send(mail) {
      if (transport) {
        await transport.sendMail({ from: options.from, ...mail });
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
