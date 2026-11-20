import type { FastifyInstance } from "fastify";
import { todoBulkInput, todoCreateInput, todoListInput, todoListQuery, todoListUpdate, todoMoveInput, todoReorderInput, todoSubtaskInput, todoSubtaskUpdate, todoUpdateInput, todoDeleteInput, todoReferenceInput } from "@stash/shared";
import { todoService } from "@stash/core";
import { auth } from "./auth.js";
import { z } from "zod";

export function registerTodos(app: FastifyInstance, db: Parameters<typeof todoService>[0], production = false) {
  const authentication = auth(db, production), id = (raw: unknown) => z.object({id:z.string().uuid()}).parse(raw).id;
  const service = async (request: Parameters<typeof authentication.user>[0]) => todoService(db,(await authentication.user(request)).id);
  app.get("/api/todo-preferences", async request => ({preferences:await (await service(request)).preferences()}));
  app.put("/api/todo-preferences", async request => ({preferences:await (await service(request)).updatePreferences(request.body)}));
  app.get("/api/todo-lists", async request => {
    const input=z.object({projectId:z.string().uuid().nullable().optional()}).parse(request.query);
    return {items:await (await service(request)).lists(input.projectId)};
  });
  app.post("/api/todo-lists", async request => ({list:await (await service(request)).createList(todoListInput.parse(request.body))}));
  app.patch("/api/todo-lists/:id", async request => ({list:await (await service(request)).updateList(id(request.params),todoListUpdate.parse(request.body))}));
  app.delete("/api/todo-lists/:id", async request => {
    const input=z.object({revision:z.number().int().positive()}).parse(request.body);
    return (await service(request)).deleteList(id(request.params),input.revision);
  });
  app.get("/api/todos", async request => (await service(request)).list(todoListQuery.parse(request.query)));
  app.post("/api/todos/bulk", async request => (await service(request)).bulk(todoBulkInput.parse(request.body)));
  app.post("/api/todos/reorder", async request => (await service(request)).reorder(todoReorderInput.parse(request.body)));
  app.post("/api/todos", async request => ({todo:await (await service(request)).create(todoCreateInput.parse(request.body))}));
  app.get("/api/todos/:id", async request => {
    const input=z.object({trash:z.enum(["true","false"]).default("false")}).parse(request.query);
    return {todo:await (await service(request)).get(id(request.params),undefined,input.trash==="true")};
  });
  app.patch("/api/todos/:id", async request => ({todo:await (await service(request)).update(id(request.params),todoUpdateInput.parse(request.body))}));
  app.put("/api/todos/:id/sources", async request => {
    const input=todoReferenceInput.extend({revision:z.number().int().positive()}).parse(request.body);
    return (await service(request)).setSources(id(request.params),input.sourceIds,input.revision);
  });
  app.post("/api/todos/:id/subtasks", async request => ({subtask:await (await service(request)).addSubtask(id(request.params),todoSubtaskInput.parse(request.body).title)}));
  app.patch("/api/todos/:id/subtasks/:subtaskId", async request => {
    const ids=z.object({id:z.string().uuid(),subtaskId:z.string().uuid()}).parse(request.params);
    return {subtask:await (await service(request)).updateSubtask(ids.id,ids.subtaskId,todoSubtaskUpdate.parse(request.body))};
  });
  app.delete("/api/todos/:id/subtasks/:subtaskId", async request => {
    const ids=z.object({id:z.string().uuid(),subtaskId:z.string().uuid()}).parse(request.params),input=z.object({revision:z.number().int().positive()}).parse(request.body);
    return (await service(request)).removeSubtask(ids.id,ids.subtaskId,input.revision);
  });
  app.post("/api/todos/:id/complete", async request => {
    const input=z.object({revision:z.number().int().positive(),requestId:z.string().uuid(),subtasks:z.enum(["parent_only","complete_all"]).optional()}).parse(request.body);
    return {todo:await (await service(request)).lifecycle(id(request.params),"complete",input.revision,undefined,input.subtasks,input.requestId)};
  });
  app.post("/api/todos/:id/reopen", async request => {
    const input=z.object({revision:z.number().int().positive()}).parse(request.body);
    return {todo:await (await service(request)).lifecycle(id(request.params),"reopen",input.revision)};
  });
  app.post("/api/todos/:id/trash", async request => {
    const input=z.object({revision:z.number().int().positive()}).parse(request.body);
    return {todo:await (await service(request)).lifecycle(id(request.params),"trash",input.revision)};
  });
  app.post("/api/todos/:id/restore", async request => {
    const input=z.object({revision:z.number().int().positive()}).parse(request.body);
    return {todo:await (await service(request)).lifecycle(id(request.params),"restore",input.revision)};
  });
  app.delete("/api/todos/:id", async request => {
    const input=todoDeleteInput.parse(request.body);
    return (await service(request)).lifecycle(id(request.params),"delete",input.revision,input.confirmation);
  });
  app.post("/api/todos/:id/move", async request => {
    const input=todoMoveInput.extend({revision:z.number().int().positive()}).parse(request.body);
    return {todo:await (await service(request)).update(id(request.params),{...input})};
  });
}
