import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { apiKeys, users, type Database } from "@stash/db";
import { AppError, library } from "@stash/core";
import {
  previewImport,
  importLibrary,
  exportLibrary,
} from "@stash/core/portability";
import {
  resourceInput,
  resourceUpdate,
  listInput,
  collectionInput,
  keyInput,
  LIMITS,
} from "@stash/shared";
import { auth, digest } from "./auth.js";
import { createDeletionJournal, type DeletionJournal } from "./deletions.js";
import { registerAccounts } from "./accounts.js";
import { createMailer, type Mailer } from "./mail.js";
import { handleMcp } from "./mcp.js";
import { fetchMetadata } from "./metadata.js";
export async function createApp(
  db: Database,
  options: {
    origin?: string;
    publicApiUrl?: string;
    production?: boolean;
    logger?: boolean;
    mailer?: Mailer;
    mailPath?: string;
    journal?: DeletionJournal;
    deletionJournalDir?: string;
  } = {},
) {
  const origin = options.origin || "http://127.0.0.1:3000",
    publicApiUrl = options.publicApiUrl || "http://127.0.0.1:4000";
  const app = Fastify({
    logger: options.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            'res.headers["set-cookie"]',
          ],
          serializers: {
            req: (request) => ({
              method: request.method,
              url: request.url.split("?")[0],
              id: request.id,
            }),
            err: (error) => ({
              type: error.name,
              message: "Internal operation failed",
              stack: "",
            }),
          },
        }
      : false,
    bodyLimit: 3 * 1024 * 1024,
  });
  const authentication = auth(db, !!options.production);
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({ error: error.issues[0]?.message || "Invalid input." });
    if (error instanceof AppError)
      return reply.code(error.status).send({ error: error.message });
    const dbError = error as { code?: string; cause?: { code?: string } },
      code = dbError.code || dbError.cause?.code;
    if (code === "23505")
      return reply
        .code(409)
        .send({ error: "That email or name is already in use." });
    if (code === "23503")
      return reply
        .code(409)
        .send({
          error:
            "This resource or collection changed. Please reload and try again.",
        });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500)
      return reply
        .code(status)
        .send({
          error:
            status === 429
              ? "Too many requests. Try again shortly."
              : "Invalid request.",
        });
    request.log.error(
      { event: "request_failed", requestId: request.id },
      "Request failed",
    );
    return reply
      .code(500)
      .send({ error: "Something went wrong. Please try again." });
  });
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "no-store");
    const path = request.url.split("?")[0];
    if (request.headers.origin && request.headers.origin !== origin)
      throw new AppError(403, "Origin not allowed.");
    if (
      path.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.origin !== origin
    )
      throw new AppError(403, "A matching browser origin is required.");
    if (path === "/api/import" || path === "/api/import/preview")
      await authentication.user(request);
    if (path === "/mcp" && request.headers.host !== new URL(publicApiUrl).host)
      throw new AppError(403, "Host not allowed.");
  });
  const id = (params: unknown) =>
    z.object({ id: z.string().uuid() }).parse(params).id;
  app.get("/health", async () => ({ ok: true, version: "0.1.0" }));
  app.get("/ready", async (_request, reply) => {
    try {
      await db.execute(sql`select 1 from stash_migrations limit 1`);
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
  registerAccounts(app, db, {
    origin,
    production: !!options.production,
    journal:
      options.journal ||
      createDeletionJournal(options.deletionJournalDir || ".data/deletions"),
    mailer:
      options.mailer ||
      createMailer({
        directory: options.mailPath || ".data/mail",
        production: !!options.production,
      }),
  });
  app.get("/api/resources", async (request) =>
    library(db, (await authentication.user(request)).id).list(
      listInput.parse(request.query),
    ),
  );
  app.get("/api/resources/:id", async (request) => ({
    item: await library(db, (await authentication.user(request)).id).get(
      id(request.params),
    ),
  }));
  app.post("/api/resources", async (request) => {
    const user = await authentication.user(request),
      input = resourceInput.parse(request.body);
    return library(db, user.id).save(
      input,
      "web",
      !input.title ? await fetchMetadata(input.url) : undefined,
    );
  });
  app.patch("/api/resources/:id", async (request) => ({
    item: await library(db, (await authentication.user(request)).id).update(
      id(request.params),
      resourceUpdate.parse(request.body),
    ),
  }));
  app.delete("/api/resources/:id", async (request) =>
    library(db, (await authentication.user(request)).id).remove(
      id(request.params),
    ),
  );
  app.post(
    "/api/metadata",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => {
      await authentication.user(request);
      return fetchMetadata(
        resourceInput.pick({ url: true }).parse(request.body).url,
      );
    },
  );
  app.get("/api/collections", async (request) => ({
    items: await library(
      db,
      (await authentication.user(request)).id,
    ).collections(),
  }));
  app.post("/api/collections", async (request) => ({
    item: await library(
      db,
      (await authentication.user(request)).id,
    ).createCollection(collectionInput.parse(request.body).name),
  }));
  app.patch("/api/collections/:id", async (request) => ({
    item: await library(
      db,
      (await authentication.user(request)).id,
    ).renameCollection(
      id(request.params),
      collectionInput.parse(request.body).name,
    ),
  }));
  app.delete("/api/collections/:id", async (request) =>
    library(db, (await authentication.user(request)).id).deleteCollection(
      id(request.params),
    ),
  );
  app.get("/api/keys", async (request) => {
    const user = await authentication.user(request);
    return {
      items: await db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          scope: apiKeys.scope,
          createdAt: apiKeys.createdAt,
          lastUsedAt: apiKeys.lastUsedAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.userId, user.id)),
      endpoint: `${publicApiUrl}/mcp`,
    };
  });
  app.post("/api/keys", async (request) => {
    const user = await authentication.user(request),
      input = keyInput.parse(request.body);
    if (!user.emailVerifiedAt)
      throw new AppError(403, "Verify your email before connecting an agent.");
    const token = `stash_${randomBytes(32).toString("base64url")}`;
    const row = await db.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, user.id))
        .for("update");
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(apiKeys)
        .where(eq(apiKeys.userId, user.id));
      if (count.total >= LIMITS.keys)
        throw new AppError(409, "Your agent key limit has been reached.");
      const [row] = await tx
        .insert(apiKeys)
        .values({
          ...input,
          userId: user.id,
          hash: digest(token),
          prefix: token.slice(0, 12),
        })
        .returning({ id: apiKeys.id });
      return row;
    });
    return { ...row, token };
  });
  app.delete("/api/keys/:id", async (request) => {
    const user = await authentication.user(request);
    const rows = await db
      .delete(apiKeys)
      .where(
        and(eq(apiKeys.id, id(request.params)), eq(apiKeys.userId, user.id)),
      )
      .returning({ id: apiKeys.id });
    if (!rows.length) throw new AppError(404, "Agent key not found.");
    return { deleted: true };
  });
  const imports = {
    bodyLimit: LIMITS.importBytes * 2 + 1024,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  };
  app.post("/api/import/preview", imports, async (request) =>
    previewImport(db, (await authentication.user(request)).id, request.body),
  );
  app.post("/api/import", imports, async (request) =>
    importLibrary(db, (await authentication.user(request)).id, request.body),
  );
  app.get("/api/export", async (request, reply) => {
    const user = await authentication.user(request);
    reply.header(
      "Content-Disposition",
      'attachment; filename="stash-export.json"',
    );
    return exportLibrary(db, user.id);
  });
  app.post("/mcp", async (request, reply) =>
    handleMcp(db, await authentication.agent(request), request, reply),
  );
  app.route({
    method: ["GET", "DELETE"],
    url: "/mcp",
    handler: async (_request, reply) =>
      reply
        .code(405)
        .header("Allow", "POST")
        .send({ error: "This stateless MCP endpoint accepts POST requests." }),
  });
  return app;
}
