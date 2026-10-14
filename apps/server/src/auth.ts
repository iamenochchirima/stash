import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { users, sessions, apiKeys, type Database } from "@stash/db";
import { LIMITS } from "@stash/shared";
import { AppError } from "@stash/core";
import type { FastifyRequest, FastifyReply } from "fastify";
export const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const derive = (password: string, salt: string, cost: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: cost, r: 8, p: 1, maxmem: 192 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$131072$${salt}$${(await derive(password, salt, 131072)).toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const modern = stored.startsWith("scrypt$");
  const parts = stored.split(modern ? "$" : ":");
  const salt = modern ? parts[2] : parts[0],
    hex = modern ? parts[3] : parts[1];
  if (!salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const cost = modern ? Number(parts[1]) : 16384;
  if (![16384, 131072].includes(cost)) return false;
  return timingSafeEqual(
    await derive(password, salt, cost),
    Buffer.from(hex, "hex"),
  );
}
export function publicProfile(
  user: typeof users.$inferSelect,
  emailEnabled = true,
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    bio: user.bio,
    interests: user.interests,
    avatar: user.avatar,
    emailVerified: !!user.emailVerifiedAt,
    emailEnabled,
    onboarding: {
      profile: !!user.profileCompletedAt,
      saved: !!user.firstSavedAt,
      organized: !!user.firstOrganizedAt,
      connected: !!user.agentConnectedAt,
      retrieved: !!user.agentRetrievedAt,
    },
  };
}
export function auth(
  db: Database,
  production: boolean,
  requireEmailVerification = true,
  resource = "http://127.0.0.1:4000/mcp",
) {
  return {
    async session(
      userId: string,
      reply: FastifyReply,
      connection: Database = db,
    ) {
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + LIMITS.sessionDays * 86400_000);
      await connection
        .insert(sessions)
        .values({ hash: digest(token), userId, expiresAt });
      reply.setCookie("stash_session", token, {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        path: "/",
        expires: expiresAt,
      });
    },
    async user(request: FastifyRequest) {
      const token = request.cookies.stash_session;
      if (!token) throw new AppError(401, "Sign in to continue.");
      const [row] = await db
        .select({ user: users })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(
          and(
            eq(sessions.hash, digest(token)),
            gt(sessions.expiresAt, new Date()),
          ),
        );
      if (!row || row.user.suspendedAt)
        throw new AppError(401, "Your session expired. Please sign in again.");
      request.stashActivityUserId = row.user.id;
      return row.user;
    },
    async agent(request: FastifyRequest) {
      const token = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
      if (!token || token.length > 200)
        throw new AppError(401, "An agent key is required.");
      const [row] = await db
        .select({ key: apiKeys, user: users })
        .from(apiKeys)
        .innerJoin(users, eq(apiKeys.userId, users.id))
        .where(eq(apiKeys.hash, digest(token)));
      if (
        !row || row.user.suspendedAt ||
        (row.key.oauthClientId && row.key.oauthResource !== resource) ||
        (row.key.expiresAt && row.key.expiresAt <= new Date()) ||
        (requireEmailVerification && !row.user.emailVerifiedAt)
      )
        throw new AppError(401, "This agent key is invalid or revoked.");
      await db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, row.key.id));
      await db
        .update(users)
        .set({
          agentConnectedAt: sql`coalesce(${users.agentConnectedAt},now())`,
        })
        .where(eq(users.id, row.user.id));
      request.stashActivityUserId = row.user.id;
      return row.key;
    },
  };
}


declare module "fastify" { interface FastifyRequest { stashActivityUserId?: string; } }
