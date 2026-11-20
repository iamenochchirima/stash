import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";
import { todoCreateInput, todoListInput, todoListUpdate, todoListQuery, todoPreferencesInput, todoUpdateInput } from "@stash/shared";
import { AppError } from "./index.js";
import { z } from "zod";

const LIMITS = { lists: 100, todos: 10_000, subtasks: 100, sources: 50 };
const stamp = (value: unknown) => value instanceof Date ? value.toISOString() : value == null ? null : String(value);
function validTimezone(value:string){try{new Intl.DateTimeFormat("en-US",{timeZone:value});}catch{throw new AppError(400,"Choose a valid IANA time zone.");}}

export function todoService(db: Database, userId: string) {
  async function active(tx: Database) {
    const result = await tx.execute(sql`select id from users where id=${userId} and suspended_at is null for update`);
    if (!result.rows.length) throw new AppError(403, "This account is unavailable.");
  }
  async function project(tx: Database, id: string | null, write: boolean) {
    if (!id) return;
    const result = await tx.execute(sql`select id,archived_at from projects where id=${id} and user_id=${userId} for update`);
    if (!result.rows.length) throw new AppError(404, "Project not found.");
    if (write && result.rows[0].archived_at) throw new AppError(409, "Reopen this project before changing its tasks.");
  }
  async function get(id: string, tx: Database = db, includeTrash = false) {
    const result = await tx.execute(sql`select t.id,t.user_id as "userId",t.project_id as "projectId",t.list_id as "listId",t.recurrence_id as "recurrenceId",t.title,t.description,t.state,t.priority,t.planned_date as "plannedDate",t.deadline_date as "deadlineDate",t.deadline_at as "deadlineAt",t.timezone,t.completed_at as "completedAt",t.trashed_at as "trashedAt",t.position,t.revision,t.created_at as "createdAt",t.updated_at as "updatedAt" from todos t where t.id=${id} and t.user_id=${userId}`);
    const row = result.rows[0];
    if (!row) throw new AppError(404, "Task not found.");
    if(row.trashedAt&&!includeTrash)throw new AppError(404,"Task not found.");
    const [subtasks, sources] = await Promise.all([
      tx.execute(sql`select id,title,completed_at as "completedAt",position,revision from todo_subtasks where todo_id=${id} and user_id=${userId} order by position,id`),
      tx.execute(sql`select s.id,s.resource_id as "resourceId",r.title,r.kind,r.url,r.project_id as "projectId" from todo_sources s left join resources r on r.id=s.resource_id and r.user_id=s.user_id where s.todo_id=${id} and s.user_id=${userId} order by s.created_at,s.id`),
    ]);
    return { ...row, deadlineAt: stamp(row.deadlineAt), completedAt: stamp(row.completedAt), trashedAt: stamp(row.trashedAt), createdAt: stamp(row.createdAt), updatedAt: stamp(row.updatedAt), subtasks: subtasks.rows.map((s: Record<string, any>) => ({ ...s, completedAt: stamp(s.completedAt) })), sources: sources.rows };
  }
  async function getList(id: string) {
    const result = await db.execute(sql`select id,project_id as "projectId",name,revision,position,created_at as "createdAt",updated_at as "updatedAt" from todo_lists where id=${id} and user_id=${userId}`);
    if (!result.rows[0]) throw new AppError(404,"List not found.");
    return result.rows[0];
  }
  async function requireList(tx: Database, listId: string | null, projectId: string | null, write: boolean) {
    if (!listId) return;
    const result = await tx.execute(sql`select l.id,l.project_id as "projectId",p.archived_at as "archivedAt" from todo_lists l left join projects p on p.id=l.project_id and p.user_id=l.user_id where l.id=${listId} and l.user_id=${userId} for update of l`);
    const row = result.rows[0];
    if (!row) throw new AppError(404, "List not found.");
    if (row.projectId !== projectId) throw new AppError(409, "The list and task must be in the same workspace.");
    if (write && row.archivedAt) throw new AppError(409, "Reopen this project before changing its tasks.");
  }
  async function ownedSources(tx: Database, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) throw new AppError(400, "Choose each source only once.");
    if (unique.length > LIMITS.sources) throw new AppError(400, "A task can link to up to 50 saved items.");
    if (!unique.length) return unique;
    const idList = sql.join(unique.map(id=>sql`${id}::uuid`),sql`, `);
    const found = await tx.execute(sql`select id from resources where user_id=${userId} and id in (${idList}) and deleted_at is null for update`);
    if (found.rows.length !== unique.length) throw new AppError(404, "One or more saved items are unavailable.");
    return unique;
  }
  const requests = async (tx: Database, requestId: string, action: string, payload: unknown) => {
    const fingerprint = createHash("sha256").update(JSON.stringify({ action, payload })).digest("hex");
    const prior = await tx.execute(sql`select fingerprint,todo_id as "todoId",result from todo_requests where user_id=${userId} and request_id=${requestId}`);
    if (prior.rows.length) {
      if (prior.rows[0].fingerprint !== fingerprint) throw new AppError(409, "This request ID was already used for a different action.");
      return { replay: true as const, todoId: prior.rows[0].todoId as string | null, result: prior.rows[0].result as Record<string,unknown>, fingerprint };
    }
    return { replay: false as const, todoId: null, result: null, fingerprint };
  };
  const saveRequest = async (tx: Database, requestId: string, action: string, fingerprint: string, todoId: string, result: unknown) => {
    await tx.execute(sql`insert into todo_requests(user_id,request_id,action,fingerprint,todo_id,result) values(${userId},${requestId},${action},${fingerprint},${todoId},${JSON.stringify(result)}::jsonb)`);
  };
  const getPreferences = async () => {
    const result = await db.execute(sql`select timezone,email_reminders as "emailReminders",in_app_reminders as "inAppReminders" from todo_preferences where user_id=${userId}`);
    return result.rows[0]
      ? { ...result.rows[0], configured: true }
      : { timezone: "UTC", emailReminders: false, inAppReminders: true, configured: false };
  };

  return {
    get,
    preferences: getPreferences,
    async updatePreferences(raw: unknown) {
      const input = todoPreferencesInput.parse(raw);
      validTimezone(input.timezone);
      await db.transaction(async tx => {
        await active(tx);
        await tx.execute(sql`insert into todo_preferences(user_id,timezone) values(${userId},${input.timezone}) on conflict(user_id) do update set timezone=excluded.timezone,updated_at=now()`);
      });
      return getPreferences();
    },
    async lists(projectId?: string | null) {
      const result = projectId === undefined
        ? await db.execute(sql`select id,project_id as "projectId",name,revision,position,created_at as "createdAt",updated_at as "updatedAt" from todo_lists where user_id=${userId} order by project_id nulls first,position,name,id`)
        : await db.execute(sql`select id,project_id as "projectId",name,revision,position,created_at as "createdAt",updated_at as "updatedAt" from todo_lists where user_id=${userId} and project_id is not distinct from ${projectId} order by position,name,id`);
      return result.rows;
    },
    async createList(raw: z.input<typeof todoListInput>) {
      const input = todoListInput.parse(raw);
      const id = await db.transaction(async tx => {
        await active(tx); await project(tx, input.projectId, true);
        const n = await tx.execute(sql`select count(*)::int as n from todo_lists where user_id=${userId}`);
        if (Number(n.rows[0].n) >= LIMITS.lists) throw new AppError(409, "Your limit of 100 task lists has been reached.");
        const row = await tx.execute(sql`insert into todo_lists(user_id,project_id,name,position) values(${userId},${input.projectId},${input.name},coalesce((select max(position)+1 from todo_lists where user_id=${userId} and project_id is not distinct from ${input.projectId}),0)) returning id`);
        return String(row.rows[0].id);
      });
      return getList(id);
    },
    async updateList(id: string, raw: z.input<typeof todoListUpdate>) {
      const input = todoListUpdate.parse(raw);
      await db.transaction(async tx => {
        await active(tx);
        const result = await tx.execute(sql`select l.revision,l.project_id as "projectId" from todo_lists l where l.id=${id} and l.user_id=${userId} for update`);
        const row = result.rows[0]; if (!row) throw new AppError(404, "List not found.");
        if (Number(row.revision) !== input.revision) throw new AppError(409, "This list changed elsewhere. Reload before saving.");
        await project(tx, row.projectId, true);
        await tx.execute(sql`update todo_lists set name=${input.name},revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
      });
      return getList(id);
    },
    async deleteList(id: string, revision: number) {
      return db.transaction(async tx => {
        await active(tx);
        const result = await tx.execute(sql`select revision,project_id as "projectId" from todo_lists where id=${id} and user_id=${userId} for update`);
        const row = result.rows[0]; if (!row) throw new AppError(404, "List not found.");
        if (Number(row.revision) !== revision) throw new AppError(409, "This list changed elsewhere. Reload before deleting.");
        await project(tx, row.projectId, true);
        await tx.execute(sql`update todos set list_id=null,revision=revision+1,updated_at=now() where list_id=${id} and user_id=${userId}`);
        await tx.execute(sql`delete from todo_lists where id=${id} and user_id=${userId}`);
        return { deleted: true, movedToInbox: true };
      });
    },
    async create(raw: z.input<typeof todoCreateInput>) {
      const input = todoCreateInput.parse(raw);
      const timezone = input.timezone ?? (await getPreferences()).timezone;
      validTimezone(timezone);
      const created = await db.transaction(async tx => {
        await active(tx);
        const replay = await requests(tx, input.requestId, "create", input);
        if (replay.replay) return replay.todoId;
        await project(tx, input.projectId, true);
        await requireList(tx, input.listId, input.projectId, true);
        const sources = await ownedSources(tx, input.sourceIds);
        const n = await tx.execute(sql`select count(*)::int as n from todos where user_id=${userId}`);
        if (Number(n.rows[0].n) >= LIMITS.todos) throw new AppError(409, "Your limit of 10,000 tasks has been reached.");
        const result = await tx.execute(sql`insert into todos(user_id,project_id,list_id,title,description,priority,planned_date,deadline_date,deadline_at,timezone,position) values(${userId},${input.projectId},${input.listId},${input.title},${input.description},${input.priority},${input.plannedDate},${input.deadlineDate},${input.deadlineAt},${timezone},coalesce((select max(position)+1 from todos where user_id=${userId} and project_id is not distinct from ${input.projectId} and list_id is not distinct from ${input.listId} and trashed_at is null),0)) returning id`);
        const id = String(result.rows[0].id);
        for (const resourceId of sources) await tx.execute(sql`insert into todo_sources(user_id,todo_id,resource_id) values(${userId},${id},${resourceId})`);
        const todo = await get(id, tx);
        await saveRequest(tx, input.requestId, "create", replay.fingerprint, id, todo);
        return id;
      });
      if (!created) throw new AppError(409, "This task request is no longer available.");
      return get(created);
    },
    async list(raw: z.input<typeof todoListQuery>) {
      const input = todoListQuery.parse(raw), filters = [sql`t.user_id=${userId}`];
      const tz = sql`coalesce(pref.timezone,t.timezone,'UTC')`;
      if (input.view === "trash") filters.push(sql`t.trashed_at is not null`);
      else if (input.view === "completed") filters.push(sql`t.trashed_at is null and t.state='done'`);
      else {
        filters.push(sql`t.trashed_at is null and t.state<>'done'`);
        if (input.view === "inbox") filters.push(sql`t.list_id is null`);
        if (input.view === "today") filters.push(sql`(t.planned_date <= (now() at time zone ${tz})::date or t.deadline_date <= (now() at time zone ${tz})::date or t.deadline_at <= now() or (t.deadline_at at time zone ${tz})::date=(now() at time zone ${tz})::date)`);
        if (input.view === "upcoming") filters.push(sql`(t.planned_date > (now() at time zone ${tz})::date or t.deadline_date > (now() at time zone ${tz})::date or (t.deadline_at at time zone ${tz})::date > (now() at time zone ${tz})::date)`);
      }
      if (input.projectId) filters.push(sql`t.project_id=${input.projectId}`);
      if (input.listId) filters.push(sql`t.list_id=${input.listId}`);
      if (input.state) filters.push(sql`t.state=${input.state}`);
      if (input.priority) filters.push(sql`t.priority=${input.priority}`);
      if (input.q) filters.push(sql`(t.title ilike ${"%"+input.q+"%"} or t.description ilike ${"%"+input.q+"%"})`);
      const where = sql.join(filters, sql` and `);
      const result = await db.execute(sql`select t.id,t.project_id as "projectId",t.list_id as "listId",t.title,t.state,t.priority,t.planned_date as "plannedDate",t.deadline_date as "deadlineDate",t.deadline_at as "deadlineAt",t.timezone,t.completed_at as "completedAt",t.trashed_at as "trashedAt",t.position,t.revision,t.created_at as "createdAt",t.updated_at as "updatedAt",(select count(*)::int from todo_subtasks s where s.todo_id=t.id and s.user_id=t.user_id) as "subtaskCount",(select count(*)::int from todo_subtasks s where s.todo_id=t.id and s.user_id=t.user_id and s.completed_at is not null) as "completedSubtaskCount",(select count(*)::int from todo_sources s where s.todo_id=t.id and s.user_id=t.user_id) as "sourceCount" from todos t left join todo_preferences pref on pref.user_id=t.user_id where ${where} order by coalesce(t.deadline_date,(t.deadline_at at time zone ${tz})::date,t.planned_date) asc nulls last,t.position,t.id limit ${input.limit} offset ${input.offset}`);
      const count = await db.execute(sql`select count(*)::int as total from todos t left join todo_preferences pref on pref.user_id=t.user_id where ${where}`);
      return { items: result.rows.map((row: Record<string, any>) => ({ ...row, deadlineAt: stamp(row.deadlineAt), completedAt: stamp(row.completedAt), trashedAt: stamp(row.trashedAt), createdAt: stamp(row.createdAt), updatedAt: stamp(row.updatedAt) })), total: Number(count.rows[0].total), offset: input.offset, limit: input.limit };
    },
    async update(id: string, raw: z.input<typeof todoUpdateInput>) {
      const input = todoUpdateInput.parse(raw);
      if(input.timezone)validTimezone(input.timezone);
      await db.transaction(async tx => {
        await active(tx);
        const result = await tx.execute(sql`select * from todos where id=${id} and user_id=${userId} for update`);
        const row = result.rows[0]; if (!row) throw new AppError(404,"Task not found.");
        if (row.trashed_at) throw new AppError(409,"Restore this task before editing it.");
        if (Number(row.revision)!==input.revision) throw new AppError(409,"This task changed elsewhere. Reload before saving.");
        const projectId = input.projectId === undefined ? row.project_id as string|null : input.projectId;
        const listId = input.listId === undefined ? row.list_id as string|null : input.listId;
        await project(tx, projectId, true); await requireList(tx,listId,projectId,true);
        const deadlineDate = input.deadlineDate !== undefined ? input.deadlineDate : input.deadlineAt !== undefined ? null : row.deadline_date;
        const deadlineAt = input.deadlineAt !== undefined ? input.deadlineAt : input.deadlineDate !== undefined ? null : row.deadline_at;
        const state = input.state ?? row.state;
        if(state==='done'&&row.state!=='done') {
          const incomplete=await tx.execute(sql`select 1 from todo_subtasks where todo_id=${id} and user_id=${userId} and completed_at is null limit 1`);
          if(incomplete.rows.length)throw new AppError(409,"Complete the unfinished subtasks or use the completion action to finish the task.");
        }
        await tx.execute(sql`update todos set project_id=${projectId},list_id=${listId},title=${input.title ?? row.title},description=${input.description ?? row.description},state=${state},priority=${input.priority ?? row.priority},planned_date=${input.plannedDate === undefined ? row.planned_date : input.plannedDate},deadline_date=${deadlineDate},deadline_at=${deadlineAt},timezone=${input.timezone ?? row.timezone},position=${input.position ?? row.position},completed_at=${state==='done' ? row.completed_at || new Date() : null},revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
        if(state==='done')await tx.execute(sql`update todo_reminders set status='cancelled',lease_until=null,updated_at=now() where todo_id=${id} and user_id=${userId} and status in ('pending','sending')`);
      });
      return get(id);
    },
    async setSources(id: string, sourceIds: string[], revision: number) {
      const ids = await db.transaction(async tx => {
        await active(tx);
        const result = await tx.execute(sql`select revision,project_id,trashed_at from todos where id=${id} and user_id=${userId} for update`);
        const row = result.rows[0]; if (!row) throw new AppError(404,"Task not found.");
        if (row.trashed_at) throw new AppError(409,"Restore this task before editing it.");
        if (Number(row.revision)!==revision) throw new AppError(409,"This task changed elsewhere. Reload before saving.");
        await project(tx,row.project_id as string|null,true); const sources = await ownedSources(tx,sourceIds);
        await tx.execute(sql`delete from todo_sources where todo_id=${id} and user_id=${userId}`);
        for (const resourceId of sources) await tx.execute(sql`insert into todo_sources(user_id,todo_id,resource_id) values(${userId},${id},${resourceId})`);
        await tx.execute(sql`update todos set revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
        return sources;
      });
      return { todo: await get(id), linked: ids.length };
    },
    async addSubtask(id: string, title: string) {
      const subtaskId = await db.transaction(async tx => {
        await active(tx);
        const task = await tx.execute(sql`select project_id,trashed_at from todos where id=${id} and user_id=${userId} for update`);
        const row = task.rows[0]; if (!row) throw new AppError(404,"Task not found.");
        if (row.trashed_at) throw new AppError(409,"Restore this task before editing it."); await project(tx,row.project_id as string|null,true);
        const count = await tx.execute(sql`select count(*)::int as n from todo_subtasks where todo_id=${id} and user_id=${userId}`);
        if (Number(count.rows[0].n)>=LIMITS.subtasks) throw new AppError(409,"A task can have up to 100 subtasks.");
        const inserted = await tx.execute(sql`insert into todo_subtasks(user_id,todo_id,title,position) values(${userId},${id},${title.trim()},coalesce((select max(position)+1 from todo_subtasks where user_id=${userId} and todo_id=${id}),0)) returning id`);
        await tx.execute(sql`update todos set revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
        return String(inserted.rows[0].id);
      });
      return (await get(id)).subtasks.find((item: {id:string})=>item.id===subtaskId);
    },
    async updateSubtask(id: string, subtaskId: string, raw: { revision: number; title?: string; completed?: boolean; position?: number }) {
      const input = z.object({ revision:z.number().int().positive(),title:z.string().trim().min(1).max(200).optional(),completed:z.boolean().optional(),position:z.number().int().min(0).optional() }).refine(v=>v.title!==undefined||v.completed!==undefined||v.position!==undefined).parse(raw);
      await db.transaction(async tx=>{
        await active(tx);
        const task=await tx.execute(sql`select project_id,trashed_at from todos where id=${id} and user_id=${userId} for update`); const row=task.rows[0]; if(!row)throw new AppError(404,"Task not found."); if(row.trashed_at)throw new AppError(409,"Restore this task before editing it."); await project(tx,row.project_id as string|null,true);
        const current=await tx.execute(sql`select * from todo_subtasks where id=${subtaskId} and todo_id=${id} and user_id=${userId} for update`); const old=current.rows[0]; if(!old)throw new AppError(404,"Subtask not found."); if(Number(old.revision)!==input.revision)throw new AppError(409,"This subtask changed elsewhere. Reload before saving.");
        await tx.execute(sql`update todo_subtasks set title=${input.title??old.title},completed_at=${input.completed===undefined?old.completed_at:input.completed?old.completed_at||new Date():null},position=${input.position??old.position},revision=revision+1,updated_at=now() where id=${subtaskId} and todo_id=${id} and user_id=${userId}`);
        await tx.execute(sql`update todos set revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
      });
      return (await get(id)).subtasks.find((item: {id:string})=>item.id===subtaskId);
    },
    async removeSubtask(id: string, subtaskId: string, revision: number) {
      await db.transaction(async tx=>{
        await active(tx); const task=await tx.execute(sql`select project_id,trashed_at from todos where id=${id} and user_id=${userId} for update`); const row=task.rows[0]; if(!row)throw new AppError(404,"Task not found."); if(row.trashed_at)throw new AppError(409,"Restore this task before editing it."); await project(tx,row.project_id as string|null,true);
        const result=await tx.execute(sql`delete from todo_subtasks where id=${subtaskId} and todo_id=${id} and user_id=${userId} and revision=${revision} returning id`); if(!result.rows.length){const exists=await tx.execute(sql`select id from todo_subtasks where id=${subtaskId} and todo_id=${id} and user_id=${userId}`);if(!exists.rows.length)throw new AppError(404,"Subtask not found.");throw new AppError(409,"This subtask changed elsewhere. Reload before deleting.");}
        await tx.execute(sql`update todos set revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
      }); return {deleted:true,todo:await get(id)};
    },
    async lifecycle(id: string, action: "complete"|"reopen"|"trash"|"restore"|"delete", revision: number, confirmation?: string, subtaskMode?: "parent_only"|"complete_all", requestId?: string) {
      if(action==="delete"&&confirmation!=="DELETE")throw new AppError(400,"Confirm permanent deletion.");
      let replayResult: Record<string,unknown>|null=null;
      await db.transaction(async tx=>{
        await active(tx);
        const replay=requestId?await requests(tx,requestId,action,{id,revision,confirmation,subtaskMode}):null;
        if(replay?.replay){replayResult=replay.result;return;}
        const result=await tx.execute(sql`select * from todos where id=${id} and user_id=${userId} for update`); const row=result.rows[0]; if(!row)throw new AppError(404,"Task not found.");
        if(Number(row.revision)!==revision)throw new AppError(409,"This task changed elsewhere. Reload before continuing.");
        if(action==="delete") { if(!row.trashed_at)throw new AppError(409,"Move this task to Trash before permanently deleting it."); await tx.execute(sql`delete from todos where id=${id} and user_id=${userId}`); return; }
        if(action==="trash"&&row.trashed_at)return;
        if(action==="restore"&&!row.trashed_at)return;
        await project(tx,row.project_id as string|null,true);
        if(action==="complete") {
          const incomplete=await tx.execute(sql`select 1 from todo_subtasks where todo_id=${id} and user_id=${userId} and completed_at is null limit 1`);
          if(incomplete.rows.length&&!subtaskMode)throw new AppError(409,"Choose whether to complete the unfinished subtasks too.");
          if(incomplete.rows.length&&subtaskMode==="complete_all")await tx.execute(sql`update todo_subtasks set completed_at=now(),revision=revision+1,updated_at=now() where todo_id=${id} and user_id=${userId} and completed_at is null`);
        }
        const nextState=action==="complete"?"done":action==="reopen"?"todo":row.state;
        await tx.execute(sql`update todos set state=${nextState},completed_at=${action==="complete"?row.completed_at||new Date():action==="reopen"?null:row.completed_at},trashed_at=${action==="trash"?new Date():action==="restore"?null:row.trashed_at},revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
        if(action==="trash"||action==="complete")await tx.execute(sql`update todo_reminders set status='cancelled',lease_until=null,updated_at=now() where todo_id=${id} and user_id=${userId} and status in ('pending','sending')`);
        if(requestId&&replay) {
          const result=await get(id,tx,action==="trash");
          await saveRequest(tx,requestId,action,replay.fingerprint,id,result);
          replayResult=result;
        }
      });
      if(action==="delete")return {deleted:true};
      if(replayResult)return replayResult;
      return get(id,db,action==="trash");
    },
  };
}
