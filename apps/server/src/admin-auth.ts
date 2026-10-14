import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { adminUsers, adminSessions, adminInvites, adminRecoveryCodes, adminAudit, type Database } from "@stash/db";
import { AppError } from "@stash/core";
import { email, password, type AdminRole, type AdminProfile } from "@stash/shared";
import { digest, hashPassword, verifyPassword } from "./auth.js";
import { mfaCipher, newMfaSecret, totpStep } from "./admin-crypto.js";
import { requestPath } from "./request-path.js";
import type { Mailer } from "./mail.js";

export type { AdminRole } from "@stash/shared";
export type AdminOptions = { origin: string; encryptionKey: string; production: boolean; mailer: Mailer; emailDisabled?: boolean };
const rank = { viewer: 0, operator: 1, owner: 2 };
const token = () => randomBytes(32).toString("base64url");
const idleMs = 30 * 60_000, absoluteMs = 8 * 60 * 60_000, recentMs = 5 * 60_000;
export const adminProfile = (user: typeof adminUsers.$inferSelect): AdminProfile => ({ id: user.id, email: user.email, name: user.name, role: user.role, disabledAt: user.disabledAt?.toISOString() || null, recoveryPendingAt:user.recoveryPendingAt?.toISOString() || null, mfaEnabled: true, verifiedAt: user.verifiedAt.toISOString(), lastSignedInAt: user.lastSignedInAt?.toISOString() || null, createdAt: user.createdAt.toISOString() });
export const audit = async (db: Database, input: typeof adminAudit.$inferInsert) => { await db.insert(adminAudit).values(input); };

export async function inviteAdmin(db: Database, options: AdminOptions, input: { email: string; name: string; role: AdminRole; invitedBy?: string; bootstrap?: boolean; recover?: boolean; reason?: string }) {
  if (options.emailDisabled) throw new AppError(503, "Admin invitations require email delivery.");
  const address = email.parse(input.email), name = z.string().trim().min(1).max(100).parse(input.name);
  const inviteId = randomUUID(), secret = token(), expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(61320491)`);
    if (input.bootstrap) {
      const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(adminUsers);
      if (count.total) throw new AppError(409, "An administrator already exists. Use the owner invitation flow.");
      if (input.role !== "owner") throw new AppError(400, "Bootstrap requires an owner.");
    } else if (!input.recover && input.role === "owner") throw new AppError(400, "Invite an operator or viewer, then explicitly assign ownership.");
    if (!input.bootstrap && !input.recover) {
      const [actor] = await tx.select().from(adminUsers).where(eq(adminUsers.id,input.invitedBy || "00000000-0000-0000-0000-000000000000")).for("update");
      if (!actor || actor.disabledAt || actor.recoveryPendingAt || actor.role !== "owner") throw new AppError(403,"An active owner must issue administrator invitations.");
    }
    const [existing] = await tx.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, address));
    if (input.recover) {
      const [current] = await tx.select().from(adminUsers).where(eq(adminUsers.email,address)).for("update");
      if (!current || current.disabledAt || current.role !== input.role) throw new AppError(409,"Only an existing active administrator can be recovered.");
      await tx.delete(adminInvites).where(eq(adminInvites.invitedBy,current.id));
      await tx.delete(adminSessions).where(eq(adminSessions.adminId,current.id));
      await tx.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId,current.id));
      await tx.update(adminUsers).set({ pendingMfaSecret:null, recoveryPendingAt:new Date() }).where(eq(adminUsers.id,current.id));
    } else if (existing) throw new AppError(409, "This administrator already exists.");
    await tx.delete(adminInvites).where(eq(adminInvites.email, address));
    await tx.insert(adminInvites).values({ id:inviteId, purpose:input.recover?"recover":"enroll", hash: digest(secret), email: address, name, role: input.role, invitedBy: input.invitedBy, expiresAt });
    await audit(tx, { actorId: input.invitedBy, action: "admin.invite", targetId: inviteId, reason: input.reason || (input.bootstrap ? "Initial owner bootstrap" : input.recover ? "Operator-assisted MFA recovery" : "Administrator invitation"), outcome: "success", changes: { role: input.role } });
  });
  try {
    await options.mailer.send({ to: address, subject: "Your Stash Admin invitation", text: `You have been invited to Stash Admin. Set your password and authenticator using this link:\n${options.origin}/enroll#token=${secret}\nThis invitation expires in 24 hours.` });
  } catch {
    await db.delete(adminInvites).where(eq(adminInvites.hash, digest(secret)));
    await audit(db, { actorId: input.invitedBy, action: "admin.invite.delivery", targetId: inviteId, reason: "Invitation delivery failed", outcome: "failed" });
    throw new AppError(503, "Invitation could not be sent. Please retry.");
  }
  return { invited: true, expiresAt };
}

export function registerAdminAuth(app: FastifyInstance, db: Database, options: AdminOptions) {
  const cipher = mfaCipher(options.encryptionKey), cookie = options.production ? "__Host-stash_admin" : "stash_admin";
  const limited = { bodyLimit: 8192, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
  app.addHook("onRequest", async (request, reply) => {
    if (!requestPath(request).startsWith("/admin-api/")) return;
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin !== options.origin) throw new AppError(403, "A matching admin origin is required.");
  });
  async function issue(tx: Database, user: typeof adminUsers.$inferSelect, reply: FastifyReply) {
    const secret = token(), now = new Date(), expiresAt = new Date(now.getTime() + absoluteMs);
    await tx.insert(adminSessions).values({ hash: digest(secret), adminId: user.id, expiresAt, lastActiveAt: now, authenticatedAt: now });
    reply.setCookie(cookie, secret, { httpOnly: true, secure: options.production, sameSite: "strict", path: "/", expires: expiresAt });
  }
  async function factor(tx: Database, user: typeof adminUsers.$inferSelect, code: string) {
    const step = totpStep(cipher.decrypt(user.mfaSecret), code, user.lastTotpStep);
    if (step !== null) {
      await tx.update(adminUsers).set({ lastTotpStep: step }).where(eq(adminUsers.id, user.id)); return true;
    }
    if (!/^[A-F0-9]{8}-[A-F0-9]{8}$/.test(code)) return false;
    const used = await tx.delete(adminRecoveryCodes).where(and(eq(adminRecoveryCodes.adminId, user.id), eq(adminRecoveryCodes.hash, digest(code)))).returning({ hash: adminRecoveryCodes.hash });
    return used.length === 1;
  }
  async function authorize(request: FastifyRequest, minimum: AdminRole = "viewer", recent = false, connection: Database = db, lock = false) {
    const secret = request.cookies[cookie];
    if (!secret || secret.length > 200) throw new AppError(401, "Sign in to Stash Admin.");
    let query = connection.select({ user: adminUsers, session: adminSessions }).from(adminSessions).innerJoin(adminUsers, eq(adminSessions.adminId, adminUsers.id)).where(and(eq(adminSessions.hash, digest(secret)), gt(adminSessions.expiresAt, new Date())));
    const [row] = lock ? await query.for("update", { of: adminUsers }) : await query;
    if (!row || row.user.disabledAt || row.user.recoveryPendingAt || Date.now() - row.session.lastActiveAt.getTime() >= idleMs) throw new AppError(401, "Your admin session expired. Sign in again.");
    if (!(row.user.role in rank) || rank[row.user.role] < rank[minimum]) throw new AppError(403, "You do not have permission for this action.");
    if (recent && Date.now() - row.session.authenticatedAt.getTime() >= recentMs) throw new AppError(428, "Confirm your password and authenticator before continuing.");
    await connection.update(adminSessions).set({ lastActiveAt: new Date() }).where(eq(adminSessions.hash, row.session.hash));
    return row;
  }
  async function recovery(tx: Database, adminId: string) {
    const codes = Array.from({ length: 8 }, () => `${randomBytes(4).toString("hex").toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`);
    await tx.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.adminId, adminId));
    await tx.insert(adminRecoveryCodes).values(codes.map(code => ({ adminId, hash: digest(code) })));
    return codes;
  }
  const inviteInput = z.object({ token: z.string().min(20).max(200) });
  app.post("/admin-api/enroll/start", limited, async request => {
    const input = inviteInput.parse(request.body);
    return db.transaction(async tx => {
      const [invite] = await tx.select().from(adminInvites).where(and(eq(adminInvites.hash, digest(input.token)), gt(adminInvites.expiresAt, new Date()))).for("update");
      if (!invite) throw new AppError(400, "This invitation is invalid or expired.");
      const secret = invite.mfaSecret ? cipher.decrypt(invite.mfaSecret) : newMfaSecret();
      if (!invite.mfaSecret) await tx.update(adminInvites).set({ mfaSecret: cipher.encrypt(secret) }).where(eq(adminInvites.hash, invite.hash));
      return { email: invite.email, name: invite.name, secret, otpauth: `otpauth://totp/${encodeURIComponent(`Stash Admin:${invite.email}`)}?secret=${secret}&issuer=Stash%20Admin&algorithm=SHA1&digits=6&period=30` };
    });
  });
  app.post("/admin-api/enroll/finish", limited, async (request, reply) => {
    const input = inviteInput.extend({ password, code: z.string().regex(/^\d{6}$/) }).parse(request.body), passwordHash = await hashPassword(input.password);
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(61320491)`);
      const [invite] = await tx.select().from(adminInvites).where(and(eq(adminInvites.hash, digest(input.token)), gt(adminInvites.expiresAt, new Date()))).for("update");
      if (!invite?.mfaSecret) throw new AppError(400, "This invitation is invalid or expired.");
      if (invite.invitedBy) {
        const [inviter]=await tx.select().from(adminUsers).where(eq(adminUsers.id,invite.invitedBy)).for("update");
        if (!inviter || inviter.disabledAt || inviter.recoveryPendingAt || inviter.role!=="owner") throw new AppError(400,"This invitation is no longer authorised. Request a new invitation.");
      }
      if (invite.role === "owner" && invite.purpose === "enroll") {
        const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(adminUsers);
        if (count.total) throw new AppError(409, "Initial owner enrolment is no longer available.");
      }
      const step = totpStep(cipher.decrypt(invite.mfaSecret), input.code, -1);
      if (step === null) throw new AppError(400, "Authenticator code is incorrect.");
      let user: typeof adminUsers.$inferSelect;
      if (invite.purpose === "recover") {
        const [current] = await tx.select().from(adminUsers).where(eq(adminUsers.email,invite.email)).for("update");
        if (!current || current.disabledAt || current.role !== invite.role) throw new AppError(400,"This recovery invitation is no longer valid.");
        [user] = await tx.update(adminUsers).set({ passwordHash,mfaSecret:invite.mfaSecret,pendingMfaSecret:null,recoveryPendingAt:null,lastTotpStep:step,lastSignedInAt:new Date() }).where(eq(adminUsers.id,current.id)).returning();
        await tx.delete(adminSessions).where(eq(adminSessions.adminId,current.id));
      } else {
        [user] = await tx.insert(adminUsers).values({ email: invite.email, name: invite.name, role: invite.role, passwordHash, mfaSecret: invite.mfaSecret, lastTotpStep: step, verifiedAt: new Date(), lastSignedInAt: new Date() }).returning();
      }
      await tx.delete(adminInvites).where(eq(adminInvites.hash, invite.hash));
      const recoveryCodes = await recovery(tx, user.id);
      await audit(tx, { actorId: user.id, targetId: user.id, action: invite.purpose === "recover"?"admin.recover":"admin.enroll", reason: "Verified invitation and MFA enrolment", outcome: "success" });
      await issue(tx, user, reply);
      return { admin: adminProfile(user), recoveryCodes };
    });
  });
  app.post("/admin-api/login", limited, async (request, reply) => {
    const input = z.object({ email, password: z.string().min(1).max(128), code: z.string().min(6).max(40) }).parse(request.body);
    const [candidate] = await db.select().from(adminUsers).where(eq(adminUsers.email, input.email));
    const valid = await verifyPassword(input.password, candidate?.passwordHash || `scrypt$131072$${"0".repeat(32)}$${"0".repeat(128)}`);
    if (!candidate || !valid) throw new AppError(401, "Email, password or authenticator code is incorrect.");
    return db.transaction(async tx => {
      const [user] = await tx.select().from(adminUsers).where(eq(adminUsers.id, candidate.id)).for("update");
      if (!user || user.disabledAt || user.recoveryPendingAt || user.passwordHash !== candidate.passwordHash || !(await factor(tx, user, input.code))) throw new AppError(401, "Email, password or authenticator code is incorrect.");
      await tx.update(adminUsers).set({ lastSignedInAt: new Date() }).where(eq(adminUsers.id, user.id));
      await audit(tx, { actorId: user.id, targetId: user.id, action: "admin.login", reason: "Password and second factor verified", outcome: "success" });
      await issue(tx, user, reply);
      return { admin: adminProfile(user) };
    });
  });
  app.get("/admin-api/me", async request => ({ admin: adminProfile((await authorize(request)).user) }));
  app.post("/admin-api/logout", async (request, reply) => {
    const secret = request.cookies[cookie];
    if (secret) await db.delete(adminSessions).where(eq(adminSessions.hash, digest(secret)));
    reply.clearCookie(cookie, { path: "/", secure: options.production }); return { ok: true };
  });
  app.post("/admin-api/reauthenticate", limited, async request => {
    const input = z.object({ password: z.string().max(128), code: z.string().min(6).max(40) }).parse(request.body);
    return db.transaction(async tx => {
      const row = await authorize(request, "viewer", false, tx, true);
      if (!(await verifyPassword(input.password, row.user.passwordHash)) || !(await factor(tx, row.user, input.code))) throw new AppError(401, "Password or authenticator code is incorrect.");
      await tx.update(adminSessions).set({ authenticatedAt: new Date() }).where(eq(adminSessions.hash, row.session.hash));
      await audit(tx, { actorId: row.user.id, action: "admin.reauthenticate", reason: "Sensitive action verification", outcome: "success" });
      return { ok: true };
    });
  });
  app.post("/admin-api/mfa/start", limited, async request => db.transaction(async tx => {
    const row = await authorize(request,"viewer",true,tx,true);
    const secret = newMfaSecret();
    await tx.update(adminUsers).set({pendingMfaSecret:cipher.encrypt(secret)}).where(eq(adminUsers.id,row.user.id));
    await audit(tx,{actorId:row.user.id,targetId:row.user.id,action:"admin.mfa.rotation.requested",reason:"Authenticator replacement requested",outcome:"success"});
    return {secret,otpauth:`otpauth://totp/${encodeURIComponent(`Stash Admin:${row.user.email}`)}?secret=${secret}&issuer=Stash%20Admin&algorithm=SHA1&digits=6&period=30`};
  }));
  app.post("/admin-api/mfa/finish", limited, async (request,reply) => db.transaction(async tx => {
    const row = await authorize(request,"viewer",true,tx,true);
    const {code}=z.object({code:z.string().regex(/^\d{6}$/)}).parse(request.body);
    if(!row.user.pendingMfaSecret)throw new AppError(400,"Start authenticator replacement first.");
    const step=totpStep(cipher.decrypt(row.user.pendingMfaSecret),code,-1);
    if(step===null)throw new AppError(400,"Authenticator code is incorrect.");
    const [user]=await tx.update(adminUsers).set({mfaSecret:row.user.pendingMfaSecret,pendingMfaSecret:null,lastTotpStep:step}).where(eq(adminUsers.id,row.user.id)).returning();
    await tx.delete(adminSessions).where(eq(adminSessions.adminId,user.id));
    const recoveryCodes=await recovery(tx,user.id);
    await audit(tx,{actorId:user.id,targetId:user.id,action:"admin.mfa.rotation",reason:"Authenticator replaced; prior recovery codes and sessions revoked",outcome:"success"});
    await issue(tx,user,reply);
    return {recoveryCodes};
  }));
  return { authorize, factor, recovery, cipher, cookie };
}
