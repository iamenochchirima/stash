import { deleteCustomer, sendAccountEmail } from "./account-lifecycle.js";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  accountTokens,
  users,
  sessions,
  apiKeys,
  oauthRequests,
  oauthCodes,
  collections,
  type Database,
} from "@stash/db";
import {
  LIMITS,
  signupInput,
  loginInput,
  email,
  password,
  profileInput,
} from "@stash/shared";
import { AppError } from "@stash/core";
import { z } from "zod";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import {
  auth,
  digest,
  hashPassword,
  verifyPassword,
  publicProfile,
} from "./auth.js";
import type { DeletionJournal } from "./deletions.js";
import type { Mailer } from "./mail.js";
export function registerAccounts(
  app: FastifyInstance,
  db: Database,
  options: {
    origin: string;
    production: boolean;
    emailDisabled?: boolean;
    mailer: Mailer;
    journal: DeletionJournal;
  },
) {
  const authentication = auth(db, options.production, !options.emailDisabled);
  const profile = (user: typeof users.$inferSelect) =>
    publicProfile(user, !options.emailDisabled);
  const authLimit = {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  };
  const tokenInput = z.object({ token: z.string().min(20).max(200) });
  const sendToken = (user: typeof users.$inferSelect, purpose: "verify" | "reset") => sendAccountEmail(db, user.id, purpose, options);
  app.post("/api/auth/signup", authLimit, async (request, reply) => {
    const input = signupInput.parse(request.body),
      passwordHash = await hashPassword(input.password);
    const user = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          name: input.name,
          bio: input.bio,
          interests: input.interests,
          profileCompletedAt: new Date(),
        })
        .returning();
      await tx.insert(collections).values({ userId: row.id, name: "Inbox" });
      return row;
    });
    await authentication.session(user.id, reply);
    let emailSent = !options.emailDisabled;
    try {
      if (!options.emailDisabled) await sendToken(user, "verify");
    } catch {
      emailSent = false;
    }
    return reply.code(201).send({ user: profile(user), emailSent });
  });
  app.post("/api/auth/login", authLimit, async (request, reply) => {
    const input = loginInput.parse(request.body);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, input.email));
    const valid = await verifyPassword(
      input.password,
      user?.passwordHash ||
        `scrypt$131072$${"0".repeat(32)}$${"0".repeat(128)}`,
    );
    if (!user || user.suspendedAt || !valid)
      throw new AppError(401, "Email or password is incorrect.");
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .for("update");
      if (!current || current.suspendedAt || current.passwordHash !== user.passwordHash)
        throw new AppError(401, "Email or password is incorrect.");
      await authentication.session(current.id, reply, tx);
      return { user: profile(current) };
    });
  });
  app.post("/api/auth/logout", async (request, reply) => {
    if (request.cookies.stash_session)
      await db
        .delete(sessions)
        .where(eq(sessions.hash, digest(request.cookies.stash_session)));
    reply.clearCookie("stash_session", { path: "/" });
    return { ok: true };
  });
  app.post("/api/auth/resend", authLimit, async (request) => {
    if (options.emailDisabled)
      throw new AppError(503, "Email verification is currently unavailable.");
    const user = await authentication.user(request);
    if (!user.emailVerifiedAt)
      if (!options.emailDisabled) await sendToken(user, "verify");
    return { ok: true };
  });
  app.post("/api/auth/verify", authLimit, async (request) => {
    const { token } = tokenInput.parse(request.body);
    const [candidate] = await db.select({ userId: accountTokens.userId }).from(accountTokens).where(and(eq(accountTokens.hash, digest(token)), eq(accountTokens.purpose, "verify")));
    if (!candidate) throw new AppError(400, "This link is invalid or expired. Request a new one.");
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(users).where(eq(users.id, candidate.userId)).for("update");
      if (!current || current.suspendedAt) throw new AppError(400, "This link is invalid or expired. Request a new one.");
      const [record] = await tx
        .delete(accountTokens)
        .where(
          and(
            eq(accountTokens.hash, digest(token)),
            eq(accountTokens.purpose, "verify"),
            gt(accountTokens.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!record)
        throw new AppError(
          400,
          "This verification link is invalid or expired. Request a new one.",
        );
      await tx
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(users.id, record.userId));
    });
    return { ok: true };
  });
  app.post("/api/auth/forgot", authLimit, async (request) => {
    if (options.emailDisabled)
      throw new AppError(503, "Password recovery is currently unavailable.");
    const input = z.object({ email }).parse(request.body);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, input.email));
    if (user && !user.suspendedAt) {
      try {
        await sendToken(user, "reset");
      } catch {
        /* Keep the public response identical. */
      }
    }
    return {
      message: "If that email has an account, a reset link will be sent.",
    };
  });
  app.post("/api/auth/reset", authLimit, async (request, reply) => {
    const input = tokenInput.extend({ password }).parse(request.body),
      passwordHash = await hashPassword(input.password);
    const [candidate] = await db.select({ userId: accountTokens.userId }).from(accountTokens).where(and(eq(accountTokens.hash, digest(input.token)), eq(accountTokens.purpose, "reset")));
    if (!candidate) throw new AppError(400, "This link is invalid or expired. Request a new one.");
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(users).where(eq(users.id, candidate.userId)).for("update");
      if (!current || current.suspendedAt) throw new AppError(400, "This link is invalid or expired. Request a new one.");
      const [record] = await tx
        .delete(accountTokens)
        .where(
          and(
            eq(accountTokens.hash, digest(input.token)),
            eq(accountTokens.purpose, "reset"),
            gt(accountTokens.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!record)
        throw new AppError(
          400,
          "This reset link is invalid or expired. Request a new one.",
        );
      await tx
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, record.userId));
      await tx.delete(sessions).where(eq(sessions.userId, record.userId));
      await tx.delete(apiKeys).where(eq(apiKeys.userId, record.userId));
      await tx
        .delete(oauthRequests)
        .where(eq(oauthRequests.userId, record.userId));
      await tx.delete(oauthCodes).where(eq(oauthCodes.userId, record.userId));
    });
    reply.clearCookie("stash_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/me", async (request) => ({
    user: profile(await authentication.user(request)),
  }));
  app.patch("/api/me", async (request) => {
    const user = await authentication.user(request),
      input = profileInput.parse(request.body);
    const [updated] = await db
      .update(users)
      .set({
        ...input,
        profileCompletedAt: sql`coalesce(${users.profileCompletedAt},now())`,
      })
      .where(eq(users.id, user.id))
      .returning();
    return { user: profile(updated) };
  });
  app.post("/api/me/avatar", authLimit, async (request) => {
    const user = await authentication.user(request);
    const { image } = z
      .object({
        image: z.string().max(Math.ceil((LIMITS.avatarBytes * 4) / 3) + 100),
      })
      .parse(request.body);
    const match = image.match(
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/,
    );
    if (!match) throw new AppError(400, "Upload a PNG, JPEG, or WebP image.");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > LIMITS.avatarBytes)
      throw new AppError(400, "Avatar must be at most 2 MiB.");
    let encoded: Buffer;
    try {
      const image = sharp(bytes, {
        limitInputPixels: LIMITS.avatarPixels,
        animated: false,
      });
      const meta = await image.metadata();
      if (
        meta.format !==
          (
            { png: "png", jpeg: "jpeg", webp: "webp" } as Record<string, string>
          )[match[1]] ||
        (meta.pages || 1) > 1
      )
        throw new Error("Invalid image format");
      encoded = await image.resize(256, 256, { fit: "cover" }).png().toBuffer();
    } catch {
      throw new AppError(
        400,
        "Image could not be read. Use a valid static PNG, JPEG, or WebP under 16 megapixels.",
      );
    }
    const [updated] = await db
      .update(users)
      .set({ avatar: `data:image/png;base64,${encoded.toString("base64")}` })
      .where(eq(users.id, user.id))
      .returning();
    return { user: profile(updated) };
  });
  app.delete("/api/me/avatar", async (request) => {
    const user = await authentication.user(request);
    const [updated] = await db
      .update(users)
      .set({ avatar: null })
      .where(eq(users.id, user.id))
      .returning();
    return { user: profile(updated) };
  });
  app.delete("/api/me", authLimit, async (request, reply) => {
    const user = await authentication.user(request);
    const input = z
      .object({
        password: z.string().max(128),
        confirmation: z.literal("DELETE"),
      })
      .parse(request.body);
    if (!(await verifyPassword(input.password, user.passwordHash)))
      throw new AppError(401, "Password is incorrect.");
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .for("update");
      if (!current || current.suspendedAt || current.passwordHash !== user.passwordHash)
        throw new AppError(
          401,
          "Your account changed. Sign in and confirm deletion again.",
        );
      await deleteCustomer(tx, user.id, options.journal);
    });
    reply.clearCookie("stash_session", { path: "/" });
    return { deleted: true };
  });
}
