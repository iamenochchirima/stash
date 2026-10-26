import type { FastifyInstance } from "fastify";
import type { Database } from "@stash/db";
import { topicService } from "@stash/core";
import { topicInput, topicUpdate, topicListInput } from "@stash/shared";
import { z } from "zod";
import { auth } from "./auth.js";

export function registerTopics(app: FastifyInstance, db: Database, options: { production?: boolean }) {
  const authentication = auth(db, !!options.production);
  const id = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
  app.get("/api/topics", async req => ({ items: await topicService(db, (await authentication.user(req)).id).list(topicListInput.parse(req.query)) }));
  app.get("/api/topics/:id", async req => ({ topic: await topicService(db, (await authentication.user(req)).id).get(id(req.params)) }));
  app.post("/api/topics", async req => topicService(db, (await authentication.user(req)).id).ensure(topicInput.parse(req.body)));
  app.patch("/api/topics/:id", async req => ({ topic: await topicService(db, (await authentication.user(req)).id).update(id(req.params), topicUpdate.parse(req.body)) }));
  app.delete("/api/topics/:id", async req => topicService(db, (await authentication.user(req)).id).delete(id(req.params)));
}
