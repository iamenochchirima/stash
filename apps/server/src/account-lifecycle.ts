import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { users, sessions, apiKeys, oauthRequests, oauthCodes, accountTokens, type Database } from "@stash/db";
import { AppError } from "@stash/core";
import { LIMITS } from "@stash/shared";
import { digest } from "./auth.js";
import type { DeletionJournal } from "./deletions.js";
import type { Mailer } from "./mail.js";
export async function revokeCustomerAccess(tx: Database, userId: string, mode: "all" | "sessions" | "agents" = "all") {
  if (mode !== "agents") await tx.delete(sessions).where(eq(sessions.userId, userId));
  if (mode !== "sessions") {
    await tx.delete(apiKeys).where(eq(apiKeys.userId, userId));
    await tx.delete(oauthRequests).where(eq(oauthRequests.userId, userId));
    await tx.delete(oauthCodes).where(eq(oauthCodes.userId, userId));
  }
  if (mode === "all") await tx.delete(accountTokens).where(eq(accountTokens.userId, userId));
}
// Caller must hold the user row lock. The durable intent survives a failed DB commit.
export async function deleteCustomer(tx: Database, userId: string, journal: DeletionJournal) {
  await journal.record(userId);
  await tx.delete(users).where(eq(users.id, userId));
}
export async function prepareAccountEmail(tx: Database, user: typeof users.$inferSelect, purpose: "verify" | "reset", options: { origin: string; emailDisabled?: boolean }) {
  if (options.emailDisabled) throw new AppError(503, "Email verification and password recovery are currently unavailable.");
  if (user.suspendedAt) throw new AppError(403, "This account is suspended.");
  const token = randomBytes(32).toString("base64url"), hash = digest(token);
  await tx.delete(accountTokens).where(and(eq(accountTokens.userId,user.id),eq(accountTokens.purpose,purpose)));
  await tx.insert(accountTokens).values({ hash, userId: user.id, purpose, expiresAt: new Date(Date.now() + (purpose === "verify" ? LIMITS.verifyMinutes : LIMITS.resetMinutes)*60000) });
  return { hash, mail: { to: user.email, subject: purpose === "verify" ? "Verify your Stash email" : "Reset your Stash password", text: `${purpose === "verify" ? "Verify your email" : "Reset your password"}: ${options.origin}/account/${purpose}?${purpose}=${token}\nThis link expires in ${purpose === "verify" ? LIMITS.verifyMinutes : LIMITS.resetMinutes} minutes. If you did not request this, ignore this message.` } };
}
export async function sendAccountEmail(db: Database, userId: string, purpose: "verify" | "reset", options: { origin: string; emailDisabled?: boolean; mailer: Mailer }) {
  const prepared = await db.transaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id,userId)).for("update");
    if (!user) throw new AppError(404,"Account not found.");
    return prepareAccountEmail(tx,user,purpose,options);
  });
  try { await options.mailer.send(prepared.mail); }
  catch { await db.delete(accountTokens).where(eq(accountTokens.hash,prepared.hash)); throw new AppError(503,"Email delivery is unavailable. Please try again shortly."); }
}
