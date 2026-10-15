import type { FastifyInstance } from "fastify";
import type { Database } from "@stash/db";
import { summaryStatus, queueSummary, cancelSummary } from "@stash/core";
import { z } from "zod";
import { auth } from "./auth.js";
export function registerSummaryRoutes(app: FastifyInstance, db: Database, options: { production?: boolean; available: boolean }) {
  const authentication = auth(db, !!options.production);
  const id = (params: unknown) => z.object({ id: z.string().uuid() }).parse(params).id;
  app.get("/api/items/:id/summary", async req => summaryStatus(db,(await authentication.user(req)).id,id(req.params),options.available));
  app.post("/api/items/:id/summary", async req => {
    const user = await authentication.user(req), input = z.object({ revision: z.number().int().positive(), requestId: z.string().uuid() }).strict().parse(req.body);
    return queueSummary(db,user.id,id(req.params),input,options.available);
  });
  app.post("/api/items/:id/summary/cancel", async req => cancelSummary(db,(await authentication.user(req)).id,id(req.params)));
}
