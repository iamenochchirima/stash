import type { FastifyInstance } from "fastify";
import type { Database } from "@stash/db";
import { projectService } from "@stash/core";
import { projectInput, projectUpdate, projectDelete, projectItemMove, projectDocumentRestore } from "@stash/shared";
import { z } from "zod";
import { auth } from "./auth.js";
export function registerProjects(
  app: FastifyInstance,
  db: Database,
  production = false,
) {
  const authentication = auth(db, production),
    id = (raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw).id;
  app.get("/api/projects", async (req) => {
    const input = z
      .object({
        archived: z.enum(["true", "false"]).default("false"),
        q: z.string().max(200).default(""),
      })
      .parse(req.query);
    return projectService(db, (await authentication.user(req)).id).list(
      input.archived === "true",
      input.q,
    );
  });
  app.post("/api/projects", async (req) => ({
    project: await projectService(
      db,
      (await authentication.user(req)).id,
    ).create(projectInput.parse(req.body)),
  }));
  app.get("/api/projects/:id", async (req) => ({
    project: await projectService(db, (await authentication.user(req)).id).get(
      id(req.params),
    ),
  }));
  app.patch("/api/projects/:id", async (req) => ({
    project: await projectService(
      db,
      (await authentication.user(req)).id,
    ).update(id(req.params), projectUpdate.parse(req.body)),
  }));
  app.delete("/api/projects/:id", async req =>
    projectService(db, (await authentication.user(req)).id).remove(id(req.params), projectDelete.parse(req.body)));
  app.post("/api/items/:id/move-project", async req =>
    projectService(db, (await authentication.user(req)).id).moveItem(id(req.params), projectItemMove.parse(req.body)));
  app.post("/api/items/:id/restore-document", async req =>
    projectService(db, (await authentication.user(req)).id).restoreDocument(id(req.params), projectDocumentRestore.parse(req.body)));
  app.get("/api/items/:id/history", async (req) =>
    projectService(db, (await authentication.user(req)).id).history(
      id(req.params),
      z
        .object({ revision: z.coerce.number().int().positive().optional() })
        .parse(req.query).revision,
    ),
  );
  app.post("/api/items/:id/append", async (req) =>
    projectService(db, (await authentication.user(req)).id).append(
      id(req.params),
      z
        .object({
          revision: z.number().int().positive(),
          requestId: z.string().uuid(),
          body: z.string().trim().min(1).max(500000),
        })
        .parse(req.body),
      "web",
    ),
  );
  app.post("/api/items/:id/promote", async (req) =>
    projectService(db, (await authentication.user(req)).id).promote(
      id(req.params),
      z
        .object({
          requestId: z.string().uuid(),
          body: z.string().trim().min(1).max(50000).optional(),
        })
        .parse(req.body),
    ),
  );
}
