import { randomBytes, createHash } from "node:crypto";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  apiKeys,
  oauthClients,
  oauthRequests,
  oauthCodes,
  oauthRefreshTokens,
  users,
  type Database,
} from "@stash/db";
import { AppError } from "@stash/core";
import { LIMITS } from "@stash/shared";
import { auth, digest } from "./auth.js";
const random = () => randomBytes(32).toString("base64url");
const READ = "stash:read",
  WRITE = "stash:write";
const ACCESS_SECONDS = 3600,
  REFRESH_MS = 30 * 86400_000;
class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function redirectUri(value: string) {
  const u = new URL(value);
  if (
    u.hash ||
    u.username ||
    u.password ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname))
    )
  )
    throw new OAuthError(
      "invalid_request",
      "Redirect URI must use HTTPS or loopback HTTP, without credentials or a fragment.",
    );
  return value;
}
function scopes(value: string) {
  const requested = [...new Set(value.split(/\s+/).filter(Boolean))];
  if (!requested.length || requested.some((s) => ![READ, WRITE].includes(s)))
    throw new OAuthError("invalid_scope", "Unsupported permission.");
  return requested.includes(WRITE) ? `${READ} ${WRITE}` : READ;
}
export function registerOAuth(
  app: FastifyInstance,
  db: Database,
  options: {
    origin: string;
    publicApiUrl: string;
    production?: boolean;
    emailDisabled?: boolean;
  },
) {
  const issuer = options.publicApiUrl,
    resource = `${issuer}/mcp`;
  const authentication = auth(
    db,
    !!options.production,
    !options.emailDisabled,
    resource,
  );
  const protocol =
    (handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        return await handler(req, reply);
      } catch (e) {
        if (e instanceof OAuthError)
          return reply
            .code(e.status)
            .send({ error: e.code, error_description: e.message });
        if (e instanceof ZodError || e instanceof TypeError)
          return reply.code(400).send({
            error: "invalid_request",
            error_description: "Invalid OAuth request.",
          });
        req.log.error(
          { event: "oauth_failed", requestId: req.id },
          "OAuth request failed",
        );
        return reply.code(500).send({
          error: "server_error",
          error_description: "Please try again.",
        });
      }
    };
  const metadata = async () => ({
    resource,
    authorization_servers: [issuer],
    scopes_supported: [READ, WRITE],
    bearer_methods_supported: ["header"],
    resource_name: "Stash",
    resource_documentation: `${options.origin}/help#agents`,
  });
  app.get("/.well-known/oauth-protected-resource", metadata);
  app.get("/.well-known/oauth-protected-resource/mcp", metadata);
  app.get("/.well-known/oauth-authorization-server", async () => ({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [READ, WRITE],
    authorization_response_iss_parameter_supported: true,
  }));
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      const params = new URLSearchParams(body as string);
      const result: Record<string, string> = {};
      for (const [key, value] of params) {
        if (key in result) {
          done(new Error("Duplicate form field"));
          return;
        }
        result[key] = value;
      }
      done(null, result);
    },
  );
  app.post(
    "/oauth/register",
    {
      bodyLimit: 16384,
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    protocol(async (req, reply) => {
      const input = z
        .object({
          client_name: z.string().trim().min(1).max(80).default("MCP client"),
          redirect_uris: z.array(z.string().url().max(2048)).min(1).max(10),
          token_endpoint_auth_method: z.literal("none").default("none"),
          grant_types: z
            .array(z.enum(["authorization_code", "refresh_token"]))
            .optional(),
          response_types: z.array(z.literal("code")).optional(),
        })
        .parse(req.body);
      input.redirect_uris.forEach(redirectUri);
      const clientId = `stash_client_${random()}`;
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(78134922)`);
        const [count] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(oauthClients);
        if (count.total >= 10000)
          throw new OAuthError(
            "temporarily_unavailable",
            "Client registration is temporarily unavailable.",
            503,
          );
        await tx.insert(oauthClients).values({
          id: clientId,
          name: input.client_name,
          redirectUris: input.redirect_uris,
        });
      });
      return reply.code(201).send({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: input.client_name,
        redirect_uris: input.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    }),
  );
  app.get(
    "/oauth/authorize",
    protocol(async (req, reply) => {
      const input = z
        .object({
          response_type: z.literal("code"),
          client_id: z.string().max(200),
          redirect_uri: z.string().url().max(2048),
          resource: z.literal(resource),
          scope: z.string().max(200).default(READ),
          state: z.string().max(2048).default(""),
          code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          code_challenge_method: z.literal("S256"),
        })
        .parse(req.query);
      const [client] = await db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.id, input.client_id));
      if (!client || !client.redirectUris.includes(input.redirect_uri))
        throw new OAuthError(
          "invalid_request",
          "Unknown client or redirect URI.",
        );
      const scope = scopes(input.scope),
        nonce = random();
      await db
        .delete(oauthRequests)
        .where(lt(oauthRequests.expiresAt, new Date()));
      await db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, new Date()));
      await db.insert(oauthRequests).values({
        hash: digest(nonce),
        clientId: client.id,
        redirectUri: input.redirect_uri,
        resource,
        scope,
        state: input.state,
        challenge: input.code_challenge,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      });
      return reply.redirect(`${options.origin}/oauth/consent?request=${nonce}`);
    }),
  );
  const requestHash = (params: unknown) =>
    digest(
      z
        .object({ request: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
        .parse(params).request,
    );
  app.get("/api/oauth/requests/:request", async (req) => {
    const user = await authentication.user(req),
      hash = requestHash(req.params);
    const pending = await db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ id: users.id, suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, user.id))
        .for("update");
      if (!owner || owner.suspendedAt) throw new AppError(401, "Sign in to continue.");
      const [pending] = await tx
        .update(oauthRequests)
        .set({ userId: user.id })
        .where(
          and(
            eq(oauthRequests.hash, hash),
            gt(oauthRequests.expiresAt, new Date()),
            or(isNull(oauthRequests.userId), eq(oauthRequests.userId, user.id)),
          ),
        )
        .returning();
      return pending;
    });
    if (!pending)
      throw new AppError(
        400,
        "This connection request expired. Start again in your agent.",
      );
    const [client] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, pending.clientId));
    return {
      clientName: client.name,
      redirectHost: new URL(pending.redirectUri).host,
      canWrite: pending.scope.includes(WRITE),
      emailVerified: !!user.emailVerifiedAt || !!options.emailDisabled,
      email: user.email,
    };
  });
  app.post("/api/oauth/requests/:request", async (req) => {
    const user = await authentication.user(req),
      hash = requestHash(req.params);
    const input = z
      .object({ approve: z.boolean(), write: z.boolean().default(false) })
      .parse(req.body);
    if (input.approve && !options.emailDisabled && !user.emailVerifiedAt)
      throw new AppError(403, "Verify your email before connecting an agent.");
    return db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ id: users.id, suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.id, user.id))
        .for("update");
      if (!owner || owner.suspendedAt) throw new AppError(401, "Sign in to continue.");
      const [pending] = await tx
        .select()
        .from(oauthRequests)
        .where(
          and(
            eq(oauthRequests.hash, hash),
            eq(oauthRequests.userId, user.id),
            gt(oauthRequests.expiresAt, new Date()),
          ),
        )
        .for("update");
      if (!pending)
        throw new AppError(
          400,
          "This connection request expired. Start again in your agent.",
        );
      if (input.write && !pending.scope.includes(WRITE))
        throw new AppError(400, "This client did not request write access.");
      await tx.delete(oauthRequests).where(eq(oauthRequests.hash, hash));
      const callback = new URL(pending.redirectUri);
      for (const parameter of [
        "code",
        "state",
        "error",
        "error_description",
        "iss",
      ])
        callback.searchParams.delete(parameter);
      if (pending.state) callback.searchParams.set("state", pending.state);
      callback.searchParams.set("iss", issuer);
      if (!input.approve) callback.searchParams.set("error", "access_denied");
      else {
        const code = random();
        await tx.insert(oauthCodes).values({
          hash: digest(code),
          clientId: pending.clientId,
          redirectUri: pending.redirectUri,
          resource,
          scope: input.write ? `${READ} ${WRITE}` : READ,
          challenge: pending.challenge,
          userId: user.id,
          expiresAt: new Date(Date.now() + 60_000),
        });
        callback.searchParams.set("code", code);
      }
      return { redirect: callback.toString() };
    });
  });
  const response = (access: string, refresh: string, scope: string) => ({
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_SECONDS,
    refresh_token: refresh,
    scope,
  });
  app.post(
    "/oauth/token",
    {
      bodyLimit: 16384,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    protocol(async (req, reply) => {
      const input = z
        .object({
          grant_type: z.enum(["authorization_code", "refresh_token"]),
          client_id: z.string().min(1).max(200),
          resource: z.literal(resource),
          code: z.string().max(200).optional(),
          redirect_uri: z.string().max(2048).optional(),
          code_verifier: z
            .string()
            .regex(/^[A-Za-z0-9._~-]{43,128}$/)
            .optional(),
          refresh_token: z.string().max(200).optional(),
          scope: z.string().max(200).optional(),
        })
        .parse(req.body);
      const result = await db.transaction(async (tx) => {
        if (input.grant_type === "authorization_code") {
          if (!input.code || !input.code_verifier || !input.redirect_uri)
            throw new OAuthError(
              "invalid_request",
              "Code, verifier, and redirect URI are required.",
            );
          const [candidate] = await tx
            .select()
            .from(oauthCodes)
            .where(eq(oauthCodes.hash, digest(input.code)));
          if (!candidate)
            throw new OAuthError(
              "invalid_grant",
              "Code is invalid, expired, or already used.",
            );
          const [user] = await tx
            .select()
            .from(users)
            .where(eq(users.id, candidate.userId))
            .for("update");
          const [code] = await tx
            .select()
            .from(oauthCodes)
            .where(eq(oauthCodes.hash, digest(input.code)))
            .for("update");
          const challenge = createHash("sha256")
            .update(input.code_verifier)
            .digest("base64url");
          if (
            !code ||
            code.expiresAt <= new Date() ||
            code.clientId !== input.client_id ||
            code.redirectUri !== input.redirect_uri ||
            code.resource !== input.resource ||
            code.challenge !== challenge
          )
            throw new OAuthError(
              "invalid_grant",
              "Code is invalid, expired, or already used.",
            );
          if (!user || user.suspendedAt || (!options.emailDisabled && !user.emailVerifiedAt))
            throw new OAuthError(
              "invalid_grant",
              "Account is unavailable or unverified.",
            );
          const [count] = await tx
            .select({ total: sql<number>`count(*)::int` })
            .from(apiKeys)
            .where(eq(apiKeys.userId, user.id));
          if (count.total >= LIMITS.keys)
            throw new OAuthError(
              "access_denied",
              "Connection limit reached. Revoke an unused connection in Stash.",
            );
          const [client] = await tx
            .select()
            .from(oauthClients)
            .where(eq(oauthClients.id, input.client_id));
          const access = `stash_oauth_${random()}`,
            refresh = `stash_refresh_${random()}`;
          const [key] = await tx
            .insert(apiKeys)
            .values({
              userId: user.id,
              oauthClientId: client.id,
              name: client.name,
              oauthResource: resource,
              hash: digest(access),
              prefix: "OAuth",
              scope: code.scope.includes(WRITE) ? "write" : "read",
              expiresAt: new Date(Date.now() + ACCESS_SECONDS * 1000),
            })
            .returning();
          await tx.insert(oauthRefreshTokens).values({
            hash: digest(refresh),
            keyId: key.id,
            expiresAt: new Date(Date.now() + REFRESH_MS),
          });
          await tx.delete(oauthCodes).where(eq(oauthCodes.hash, code.hash));
          return response(access, refresh, code.scope);
        }
        if (!input.refresh_token)
          throw new OAuthError("invalid_request", "Refresh token is required.");
        const [candidate] = await tx
          .select({ keyId: apiKeys.id, userId: apiKeys.userId })
          .from(oauthRefreshTokens)
          .innerJoin(apiKeys, eq(oauthRefreshTokens.keyId, apiKeys.id))
          .where(
            and(
              eq(oauthRefreshTokens.hash, digest(input.refresh_token)),
              eq(apiKeys.oauthClientId, input.client_id),
              eq(apiKeys.oauthResource, input.resource),
            ),
          );
        if (!candidate)
          throw new OAuthError(
            "invalid_grant",
            "Refresh token expired or revoked.",
          );
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, candidate.userId))
          .for("update");
        const [key] = await tx
          .select()
          .from(apiKeys)
          .where(eq(apiKeys.id, candidate.keyId))
          .for("update");
        const [token] = await tx
          .select()
          .from(oauthRefreshTokens)
          .where(eq(oauthRefreshTokens.hash, digest(input.refresh_token)))
          .for("update");
        if (!token || token.expiresAt <= new Date())
          throw new OAuthError(
            "invalid_grant",
            "Refresh token expired or revoked.",
          );
        if (
          !key ||
          key.oauthClientId !== input.client_id ||
          key.oauthResource !== input.resource
        )
          throw new OAuthError(
            "invalid_grant",
            "Refresh token does not belong to this client.",
          );
        if (token.usedAt) {
          await tx.delete(apiKeys).where(eq(apiKeys.id, key.id));
          return { replay: true as const };
        }
        if (!user || user.suspendedAt || (!options.emailDisabled && !user.emailVerifiedAt))
          throw new OAuthError(
            "invalid_grant",
            "Account is unavailable or unverified.",
          );
        const previous = key.scope === "write" ? `${READ} ${WRITE}` : READ;
        const scope = input.scope ? scopes(input.scope) : previous;
        if (scope.includes(WRITE) && key.scope !== "write")
          throw new OAuthError(
            "invalid_scope",
            "Refresh cannot increase permissions.",
          );
        const access = `stash_oauth_${random()}`,
          refresh = `stash_refresh_${random()}`;
        await tx
          .update(oauthRefreshTokens)
          .set({ usedAt: new Date() })
          .where(eq(oauthRefreshTokens.hash, token.hash));
        await tx
          .update(apiKeys)
          .set({
            hash: digest(access),
            scope: scope.includes(WRITE) ? "write" : "read",
            expiresAt: new Date(Date.now() + ACCESS_SECONDS * 1000),
          })
          .where(eq(apiKeys.id, key.id));
        await tx.insert(oauthRefreshTokens).values({
          hash: digest(refresh),
          keyId: key.id,
          expiresAt: token.expiresAt,
        });
        return response(access, refresh, scope);
      });
      if ("replay" in result)
        throw new OAuthError(
          "invalid_grant",
          "Refresh token was reused. Reconnect your agent.",
        );
      return reply.header("Pragma", "no-cache").send(result);
    }),
  );
  app.post(
    "/oauth/revoke",
    { bodyLimit: 16384 },
    protocol(async (req) => {
      const input = z
        .object({ token: z.string().max(200), client_id: z.string().max(200) })
        .parse(req.body);
      const [refresh] = await db
        .select()
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.hash, digest(input.token)));
      await db
        .delete(apiKeys)
        .where(
          and(
            eq(apiKeys.oauthClientId, input.client_id),
            refresh
              ? eq(apiKeys.id, refresh.keyId)
              : eq(apiKeys.hash, digest(input.token)),
          ),
        );
      return {};
    }),
  );
}
