import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";
import { localDateTimeToUtc, nextTodoOccurrenceDate, utcToLocalDateTime } from "@stash/shared";
import { todoBulkInput, todoCreateInput, todoListInput, todoListUpdate, todoListQuery, todoPreferencesInput, todoRecurrenceInput, todoRecurrenceStopInput, todoReorderInput, todoUpdateInput } from "@stash/shared";
import { AppError } from "./index.js";
import { z } from "zod";

const LIMITS = { lists: 100, todos: 10_000, subtasks: 100, sources: 50 };
const stamp = (value: unknown) => value instanceof Date ? value.toISOString() : value == null ? null : String(value);
function validTimezone(value:string){try{new Intl.DateTimeFormat("en-US",{timeZone:value});}catch{throw new AppError(400,"Choose a valid IANA time zone.");}}
function localDateAt(value:Date,timezone:string){const parts=new Intl.DateTimeFormat("en-CA-u-ca-iso8601",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(value);const part=(type:string)=>parts.find(item=>item.type===type)?.value;return `${part("year")}-${part("month")}-${part("day")}`;}

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
  async function projects(tx: Database, ids: Array<string | null | undefined>, write: boolean) {
    for (const id of [...new Set(ids.filter((value): value is string => !!value))].sort()) await project(tx, id, write);
  }
  async function touchProjects(tx: Database, ids: Array<string | null | undefined>) {
    const owned = [...new Set(ids.filter((value): value is string => !!value))];
    if (!owned.length) return;
    const idList = sql.join(owned.map(id => sql`${id}::uuid`), sql`, `);
    await tx.execute(sql`update projects set updated_at=now() where user_id=${userId} and id in (${idList})`);
  }
  async function get(id: string, tx: Database = db, includeTrash = false) {
    const result = await tx.execute(sql`select t.id,t.user_id as "userId",t.project_id as "projectId",t.list_id as "listId",t.recurrence_id as "recurrenceId",t.title,t.description,t.state,t.priority,t.planned_date as "plannedDate",t.deadline_date as "deadlineDate",t.deadline_at as "deadlineAt",t.timezone,t.completed_at as "completedAt",t.trashed_at as "trashedAt",t.position,t.revision,t.created_at as "createdAt",t.updated_at as "updatedAt" from todos t where t.id=${id} and t.user_id=${userId}`);
    const row = result.rows[0];
    if (!row) throw new AppError(404, "Task not found.");
    if(row.trashedAt&&!includeTrash)throw new AppError(404,"Task not found.");
    const subtasks = await tx.execute(sql`select id,title,completed_at as "completedAt",position,revision from todo_subtasks where todo_id=${id} and user_id=${userId} order by position,id`);
    const sources = await tx.execute(sql`select s.id,s.resource_id as "resourceId",r.title,r.kind,r.url,r.project_id as "projectId" from todo_sources s left join resources r on r.id=s.resource_id and r.user_id=s.user_id where s.todo_id=${id} and s.user_id=${userId} order by s.created_at,s.id`);
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
  const saveRequest = async (tx: Database, requestId: string, action: string, fingerprint: string, todoId: string | null, result: unknown) => {
    await tx.execute(sql`insert into todo_requests(user_id,request_id,action,fingerprint,todo_id,result) values(${userId},${requestId},${action},${fingerprint},${todoId},${JSON.stringify(result)}::jsonb)`);
  };
  const getPreferences = async () => {
    const result = await db.execute(sql`select p.timezone,p.email_reminders as "emailReminders",p.in_app_reminders as "inAppReminders",u.email_verified_at as "emailVerified" from users u left join todo_preferences p on p.user_id=u.id where u.id=${userId}`);
    const row=result.rows[0];
    return { timezone:row?.timezone||"UTC",emailReminders:!!row?.emailReminders,inAppReminders:row?.inAppReminders!==false,emailVerified:!!row?.emailVerified,configured:!!row?.timezone };
  };

  return {
    get,
    preferences: getPreferences,
    async updatePreferences(raw: unknown) {
      const input = todoPreferencesInput.parse(raw);
      validTimezone(input.timezone);
      await db.transaction(async tx => {
        await active(tx);
        if(input.emailReminders===true){const verified=await tx.execute(sql`select email_verified_at from users where id=${userId} and email_verified_at is not null`);if(!verified.rows.length)throw new AppError(409,"Verify your email address before enabling email reminders.");}
        await tx.execute(sql`insert into todo_preferences(user_id,timezone,email_reminders,in_app_reminders) values(${userId},${input.timezone},${input.emailReminders??false},${input.inAppReminders??true}) on conflict(user_id) do update set timezone=excluded.timezone,email_reminders=case when ${input.emailReminders!==undefined} then excluded.email_reminders else todo_preferences.email_reminders end,in_app_reminders=case when ${input.inAppReminders!==undefined} then excluded.in_app_reminders else todo_preferences.in_app_reminders end,updated_at=now()`);
      });
      return getPreferences();
    },
    async recurrence(id:string){
      const task=await db.execute(sql`select recurrence_id as "recurrenceId" from todos where id=${id} and user_id=${userId}`);
      if(!task.rows[0])throw new AppError(404,"Task not found.");
      if(!task.rows[0].recurrenceId)return null;
      const result=await db.execute(sql`select id,rule,timezone,anchor_date as "anchorDate",local_time as "localTime",ends_on as "endsOn",remaining_count as "remainingCount",active,current_todo_id as "currentTodoId",completed_count as "completedCount",created_at as "createdAt",updated_at as "updatedAt" from todo_recurrences where id=${task.rows[0].recurrenceId} and user_id=${userId}`);
      if(!result.rows[0])throw new AppError(404,"Repeating schedule not found.");
      const history=await db.execute(sql`select occurrence_number as "occurrenceNumber",scheduled_date as "scheduledDate",completed_at as "completedAt" from todo_occurrences where recurrence_id=${task.rows[0].recurrenceId} and user_id=${userId} order by occurrence_number desc limit 100`);
      return { ...result.rows[0],createdAt:stamp(result.rows[0].createdAt),updatedAt:stamp(result.rows[0].updatedAt),history:history.rows.map((row:Record<string,any>)=>({...row,completedAt:stamp(row.completedAt)})) };
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
        await touchProjects(tx, [input.projectId]);
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
        await touchProjects(tx, [row.projectId]);
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
        await touchProjects(tx, [row.projectId]);
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
        await touchProjects(tx, [input.projectId]);
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
      const order = input.sort==="manual" ? sql`t.position,t.id` : sql`coalesce(t.deadline_date,(t.deadline_at at time zone ${tz})::date,t.planned_date) asc nulls last,t.position,t.id`;
      const result = await db.execute(sql`select t.id,t.project_id as "projectId",t.list_id as "listId",t.recurrence_id as "recurrenceId",t.title,t.state,t.priority,t.planned_date as "plannedDate",t.deadline_date as "deadlineDate",t.deadline_at as "deadlineAt",t.timezone,t.completed_at as "completedAt",t.trashed_at as "trashedAt",t.position,t.revision,t.created_at as "createdAt",t.updated_at as "updatedAt",(select count(*)::int from todo_subtasks s where s.todo_id=t.id and s.user_id=t.user_id) as "subtaskCount",(select count(*)::int from todo_subtasks s where s.todo_id=t.id and s.user_id=t.user_id and s.completed_at is not null) as "completedSubtaskCount",(select count(*)::int from todo_sources s where s.todo_id=t.id and s.user_id=t.user_id) as "sourceCount" from todos t left join todo_preferences pref on pref.user_id=t.user_id where ${where} order by ${order} limit ${input.limit} offset ${input.offset}`);
      const count = await db.execute(sql`select count(*)::int as total from todos t left join todo_preferences pref on pref.user_id=t.user_id where ${where}`);
      return { items: result.rows.map((row: Record<string, any>) => ({ ...row, deadlineAt: stamp(row.deadlineAt), completedAt: stamp(row.completedAt), trashedAt: stamp(row.trashedAt), createdAt: stamp(row.createdAt), updatedAt: stamp(row.updatedAt) })), total: Number(count.rows[0].total), offset: input.offset, limit: input.limit };
    },
    async reorder(raw: unknown) {
      const input=todoReorderInput.parse(raw),order=[...input.tasks].sort((a,b)=>a.id.localeCompare(b.id));
      const result=await db.transaction(async tx=>{
        await active(tx);
        const replay=await requests(tx,input.requestId,"reorder",input);
        if(replay.replay)return replay.result;
        const ids=order.map(task=>task.id),idList=sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `);
        const found=await tx.execute(sql`select * from todos where user_id=${userId} and id in (${idList}) order by id for update`);
        if(found.rows.length!==2)throw new AppError(404,"One or more tasks are unavailable.");
        const rows=new Map<string,Record<string,any>>(found.rows.map((row:Record<string,any>)=>[String(row.id),row]));
        const first=rows.get(input.tasks[0].id)!,second=rows.get(input.tasks[1].id)!;
        if(Number(first.revision)!==input.tasks[0].revision||Number(second.revision)!==input.tasks[1].revision)throw new AppError(409,"One or more tasks changed elsewhere. Reload before reordering.");
        if(first.trashed_at||second.trashed_at)throw new AppError(409,"Restore tasks from Trash before reordering.");
        if(first.project_id!==second.project_id||first.list_id!==second.list_id)throw new AppError(409,"Reorder tasks from the same list and workspace.");
        await project(tx,first.project_id as string|null,true);
        for(const task of input.tasks)await tx.execute(sql`update todos set position=${task.position},revision=revision+1,updated_at=now() where id=${task.id} and user_id=${userId}`);
        await touchProjects(tx, [first.project_id as string | null]);
        const items=[];
        for(const task of input.tasks)items.push(await get(task.id,tx));
        await saveRequest(tx,input.requestId,"reorder",replay.fingerprint,null,items);
        return items;
      });
      return {todos:result};
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
        await projects(tx, [row.project_id as string|null, projectId], true); await requireList(tx,listId,projectId,true);
        const deadlineDate = input.deadlineDate !== undefined ? input.deadlineDate : input.deadlineAt !== undefined ? null : row.deadline_date;
        const deadlineAt = input.deadlineAt !== undefined ? input.deadlineAt : input.deadlineDate !== undefined ? null : row.deadline_at;
        const state = input.state ?? row.state;
        if(row.recurrence_id&&state==="done"&&row.state!=="done")throw new AppError(409,"Complete this recurring task through its completion action so the next occurrence is recorded.");
        if(state==='done'&&row.state!=='done') {
          const incomplete=await tx.execute(sql`select 1 from todo_subtasks where todo_id=${id} and user_id=${userId} and completed_at is null limit 1`);
          if(incomplete.rows.length)throw new AppError(409,"Complete the unfinished subtasks or use the completion action to finish the task.");
        }
        await tx.execute(sql`update todos set project_id=${projectId},list_id=${listId},title=${input.title ?? row.title},description=${input.description ?? row.description},state=${state},priority=${input.priority ?? row.priority},planned_date=${input.plannedDate === undefined ? row.planned_date : input.plannedDate},deadline_date=${deadlineDate},deadline_at=${deadlineAt},timezone=${input.timezone ?? row.timezone},position=${input.position ?? row.position},completed_at=${state==='done' ? row.completed_at || new Date() : null},revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
        if(row.recurrence_id&&projectId!==row.project_id)await tx.execute(sql`update todo_recurrences set project_id=${projectId},updated_at=now() where id=${row.recurrence_id} and user_id=${userId}`);
        if(state==='done')await tx.execute(sql`update todo_reminders set status='cancelled',lease_until=null,updated_at=now() where todo_id=${id} and user_id=${userId} and status in ('pending','sending')`);
        await touchProjects(tx, [row.project_id as string|null, projectId]);
      });
      return get(id);
    },
    async setRecurrence(id:string,raw:unknown){
      const input=todoRecurrenceInput.parse(raw);validTimezone(input.timezone);
      const outcome=await db.transaction(async tx=>{
        await active(tx);
        const replay=await requests(tx,input.requestId,"recurrence_start",{id,...input});
        if(replay.replay)return replay.result;
        const result=await tx.execute(sql`select * from todos where id=${id} and user_id=${userId} for update`),row=result.rows[0];
        if(!row)throw new AppError(404,"Task not found.");
        if(row.trashed_at||row.state==="done")throw new AppError(409,"Restore or reopen this task before repeating it.");
        if(Number(row.revision)!==input.revision)throw new AppError(409,"This task changed elsewhere. Reload before scheduling recurrence.");
        if(row.recurrence_id)throw new AppError(409,"This task already belongs to a repeating series.");
        await project(tx,row.project_id as string|null,true);
        const anchor=input.anchorDate??(row.planned_date?String(row.planned_date).slice(0,10):row.deadline_date?String(row.deadline_date).slice(0,10):row.deadline_at?utcToLocalDateTime(stamp(row.deadline_at)!,input.timezone).slice(0,10):localDateAt(new Date(),input.timezone));
        const localTime=input.localTime===undefined?(row.deadline_at?utcToLocalDateTime(stamp(row.deadline_at)!,input.timezone).slice(11,16):null):input.localTime;
        if(input.endsOn&&input.endsOn<anchor)throw new AppError(400,"Choose an end date on or after the first occurrence.");
        const inserted=await tx.execute(sql`insert into todo_recurrences(user_id,project_id,rule,timezone,anchor_date,local_time,ends_on,remaining_count) values(${userId},${row.project_id},${JSON.stringify(input.rule)}::jsonb,${input.timezone},${anchor},${localTime},${input.endsOn??null},${input.count??null}) returning id`);
        const recurrenceId=String(inserted.rows[0].id);
        const task=await tx.execute(sql`update todos set recurrence_id=${recurrenceId},planned_date=coalesce(planned_date,${anchor}),timezone=${input.timezone},revision=revision+1,updated_at=now() where id=${id} and user_id=${userId} returning id`);
        await tx.execute(sql`insert into todo_occurrences(user_id,recurrence_id,todo_id,occurrence_number,scheduled_date) values(${userId},${recurrenceId},${id},1,${anchor})`);
        await tx.execute(sql`update todo_recurrences set current_todo_id=${id},updated_at=now() where id=${recurrenceId} and user_id=${userId}`);
        const todo=await get(String(task.rows[0].id),tx);
        const response={todo,recurrence:{id:recurrenceId,rule:input.rule,timezone:input.timezone,anchorDate:anchor,localTime,endsOn:input.endsOn??null,remainingCount:input.count??null,active:true}};
        await saveRequest(tx,input.requestId,"recurrence_start",replay.fingerprint,id,response);
        await touchProjects(tx, [row.project_id as string|null]);
        return response;
      });
      return outcome;
    },
    async stopRecurrence(id:string,raw:unknown){
      const input=todoRecurrenceStopInput.parse(raw);
      return db.transaction(async tx=>{
        await active(tx);
        const replay=await requests(tx,input.requestId,"recurrence_stop",{id,...input});
        if(replay.replay)return replay.result;
        const result=await tx.execute(sql`select t.revision,t.recurrence_id as "recurrenceId",t.project_id as "projectId",r.active,r.rule,r.timezone,r.anchor_date as "anchorDate",r.local_time as "localTime",r.ends_on as "endsOn",r.remaining_count as "remainingCount" from todos t join todo_recurrences r on r.id=t.recurrence_id and r.user_id=t.user_id where t.id=${id} and t.user_id=${userId} for update of t,r`),row=result.rows[0];
        if(!row)throw new AppError(404,"Repeating task not found.");
        if(Number(row.revision)!==input.revision)throw new AppError(409,"This task changed elsewhere. Reload before stopping recurrence.");
        await project(tx,row.projectId as string|null,true);
        await tx.execute(sql`update todo_recurrences set active=false,current_todo_id=null,updated_at=now() where id=${row.recurrenceId} and user_id=${userId}`);
        const response={id:row.recurrenceId,active:false,rule:row.rule,timezone:row.timezone,anchorDate:row.anchorDate,localTime:row.localTime,endsOn:row.endsOn,remainingCount:row.remainingCount};
        await saveRequest(tx,input.requestId,"recurrence_stop",replay.fingerprint,id,response);
        await touchProjects(tx, [row.projectId as string|null]);
        return response;
      });
    },
    async bulk(raw: unknown) {
      const input = todoBulkInput.parse(raw);
      const action = `bulk_${input.action}`;
      const outcome = await db.transaction(async tx => {
        await active(tx);
        const replay = await requests(tx,input.requestId,action,input);
        if(replay.replay)return replay.result;
        const ids = input.tasks.map(task=>task.id).sort();
        const idList = sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `);
        const found = await tx.execute(sql`select * from todos where user_id=${userId} and id in (${idList}) order by id for update`);
        if(found.rows.length!==input.tasks.length)throw new AppError(404,"One or more tasks are unavailable.");
        if(input.action==="complete"&&found.rows.some((row:Record<string,any>)=>row.recurrence_id))throw new AppError(409,"Complete repeating tasks individually so each next occurrence is recorded.");
        const expected = new Map(input.tasks.map(task=>[task.id,task.revision]));
        for(const row of found.rows){
          if(Number(row.revision)!==expected.get(String(row.id)))throw new AppError(409,"One or more tasks changed elsewhere. Reload before continuing.");
          if(row.trashed_at)throw new AppError(409,"Restore trashed tasks before changing them.");
        }
        await projects(tx, [...found.rows.map((row:Record<string,any>)=>row.project_id as string|null), ...(input.action==="move"?[input.projectId!]:[])], true);
        if(input.action==="move"){
          await requireList(tx,input.listId!,input.projectId!,true);
        }
        const projectActivity = new Set<string>();
        for(const row of found.rows){
          const id=String(row.id);
          if(input.action==="complete"){
            if(row.state==="done")continue;
            const incomplete=await tx.execute(sql`select 1 from todo_subtasks where todo_id=${id} and user_id=${userId} and completed_at is null limit 1`);
            if(incomplete.rows.length&&!input.subtasks)throw new AppError(409,"Choose whether to complete unfinished subtasks before applying this bulk action.");
            if(incomplete.rows.length&&input.subtasks==="complete_all")await tx.execute(sql`update todo_subtasks set completed_at=now(),revision=revision+1,updated_at=now() where todo_id=${id} and user_id=${userId} and completed_at is null`);
            await tx.execute(sql`update todos set state='done',completed_at=coalesce(completed_at,now()),revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
            await tx.execute(sql`update todo_reminders set status='cancelled',lease_until=null,updated_at=now() where todo_id=${id} and user_id=${userId} and status in ('pending','sending')`);
            if(row.project_id)projectActivity.add(String(row.project_id));
          }else if(input.action==="trash"){
            await tx.execute(sql`update todos set trashed_at=now(),revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
            await tx.execute(sql`update todo_reminders set status='cancelled',lease_until=null,updated_at=now() where todo_id=${id} and user_id=${userId} and status in ('pending','sending')`);
            if(row.project_id)projectActivity.add(String(row.project_id));
          }else{
            await tx.execute(sql`update todos set project_id=${input.projectId!},list_id=${input.listId!},position=coalesce((select max(position)+1 from todos where user_id=${userId} and project_id is not distinct from ${input.projectId!} and list_id is not distinct from ${input.listId!} and trashed_at is null),0),revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
            if(row.recurrence_id)await tx.execute(sql`update todo_recurrences set project_id=${input.projectId!},updated_at=now() where id=${row.recurrence_id} and user_id=${userId}`);
            if(row.project_id)projectActivity.add(String(row.project_id));
            projectActivity.add(input.projectId!);
          }
        }
        await touchProjects(tx, [...projectActivity]);
        const items=[];
        for(const task of input.tasks)items.push(await get(task.id,tx,input.action==="trash"));
        await saveRequest(tx,input.requestId,action,replay.fingerprint,null,items);
        return items;
      });
      return { todos: outcome };
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
        await touchProjects(tx, [row.project_id as string|null]);
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
        await touchProjects(tx, [row.project_id as string|null]);
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
        await touchProjects(tx, [row.project_id as string|null]);
      });
      return (await get(id)).subtasks.find((item: {id:string})=>item.id===subtaskId);
    },
    async removeSubtask(id: string, subtaskId: string, revision: number) {
      await db.transaction(async tx=>{
        await active(tx); const task=await tx.execute(sql`select project_id,trashed_at from todos where id=${id} and user_id=${userId} for update`); const row=task.rows[0]; if(!row)throw new AppError(404,"Task not found."); if(row.trashed_at)throw new AppError(409,"Restore this task before editing it."); await project(tx,row.project_id as string|null,true);
        const result=await tx.execute(sql`delete from todo_subtasks where id=${subtaskId} and todo_id=${id} and user_id=${userId} and revision=${revision} returning id`); if(!result.rows.length){const exists=await tx.execute(sql`select id from todo_subtasks where id=${subtaskId} and todo_id=${id} and user_id=${userId}`);if(!exists.rows.length)throw new AppError(404,"Subtask not found.");throw new AppError(409,"This subtask changed elsewhere. Reload before deleting.");}
        await tx.execute(sql`update todos set revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
        await touchProjects(tx, [row.project_id as string|null]);
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
        if(action==="delete") { if(!row.trashed_at)throw new AppError(409,"Move this task to Trash before permanently deleting it."); await tx.execute(sql`delete from todos where id=${id} and user_id=${userId}`); await touchProjects(tx,[row.project_id as string|null]); return; }
        if(action==="trash"&&row.trashed_at)return;
        if(action==="restore"&&!row.trashed_at)return;
        await project(tx,row.project_id as string|null,true);
        if(action==="reopen"&&row.recurrence_id){
          const seriesResult=await tx.execute(sql`select * from todo_recurrences where id=${row.recurrence_id} and user_id=${userId} for update`),series=seriesResult.rows[0];
          const occurrence=await tx.execute(sql`select occurrence_number from todo_occurrences where recurrence_id=${row.recurrence_id} and todo_id=${id} and user_id=${userId} for update`),currentNumber=Number(occurrence.rows[0]?.occurrence_number);
          if(!series||!currentNumber)throw new AppError(409,"This repeating occurrence is no longer available.");
          const maximum=await tx.execute(sql`select coalesce(max(occurrence_number),0)::int as n from todo_occurrences where recurrence_id=${row.recurrence_id} and user_id=${userId}`);
          if(series.active&&series.current_todo_id!==id){
            if(Number(maximum.rows[0].n)!==currentNumber+1||series.current_todo_id===null)throw new AppError(409,"Only the most recent repeating completion can be undone.");
            const next=await tx.execute(sql`select revision from todos where id=${series.current_todo_id} and user_id=${userId} for update`);
            const reminders=await tx.execute(sql`select 1 from todo_reminders where todo_id=${series.current_todo_id} and user_id=${userId} limit 1`);
            if(Number(next.rows[0]?.revision)!==1||reminders.rows.length)throw new AppError(409,"The next occurrence has changed, so this completion cannot be undone safely.");
            await tx.execute(sql`delete from todos where id=${series.current_todo_id} and user_id=${userId}`);
            await tx.execute(sql`update todo_occurrences set completed_at=null where recurrence_id=${row.recurrence_id} and todo_id=${id} and user_id=${userId}`);
            await tx.execute(sql`update todo_recurrences set current_todo_id=${id},completed_count=greatest(completed_count-1,0),remaining_count=case when remaining_count is null then null else remaining_count+1 end,updated_at=now() where id=${row.recurrence_id} and user_id=${userId}`);
          }else if(!series.active&&Number(maximum.rows[0].n)>currentNumber){
            throw new AppError(409,"Only the most recent repeating completion can be reopened.");
          }else{
            await tx.execute(sql`update todo_occurrences set completed_at=null where recurrence_id=${row.recurrence_id} and todo_id=${id} and user_id=${userId}`);
            if(!series.active)await tx.execute(sql`update todo_recurrences set completed_count=greatest(completed_count-1,0),updated_at=now() where id=${row.recurrence_id} and user_id=${userId}`);
          }
        }
        if(action==="complete") {
          const incomplete=await tx.execute(sql`select 1 from todo_subtasks where todo_id=${id} and user_id=${userId} and completed_at is null limit 1`);
          if(incomplete.rows.length&&!subtaskMode)throw new AppError(409,"Choose whether to complete the unfinished subtasks too.");
          if(incomplete.rows.length&&subtaskMode==="complete_all")await tx.execute(sql`update todo_subtasks set completed_at=now(),revision=revision+1,updated_at=now() where todo_id=${id} and user_id=${userId} and completed_at is null`);
        }
        const nextState=action==="complete"?"done":action==="reopen"?"todo":row.state;
        await tx.execute(sql`update todos set state=${nextState},completed_at=${action==="complete"?row.completed_at||new Date():action==="reopen"?null:row.completed_at},trashed_at=${action==="trash"?new Date():action==="restore"?null:row.trashed_at},revision=revision+1,updated_at=now() where id=${id} and user_id=${userId}`);
        if(action==="trash"||action==="complete")await tx.execute(sql`update todo_reminders set status='cancelled',lease_until=null,updated_at=now() where todo_id=${id} and user_id=${userId} and status in ('pending','sending')`);
        await touchProjects(tx, [row.project_id as string|null]);
        if(action==="complete"&&row.recurrence_id){
          const recurrence=await tx.execute(sql`select * from todo_recurrences where id=${row.recurrence_id} and user_id=${userId} for update`),series=recurrence.rows[0];
          if(series){
            const occurrence=await tx.execute(sql`select scheduled_date from todo_occurrences where todo_id=${id} and recurrence_id=${series.id} and user_id=${userId} for update`);
            await tx.execute(sql`update todo_occurrences set completed_at=coalesce(completed_at,now()) where todo_id=${id} and recurrence_id=${series.id} and user_id=${userId}`);
            if(series.active&&series.current_todo_id===id){
            const scheduled=occurrence.rows[0]?String(occurrence.rows[0].scheduled_date).slice(0,10):String(series.anchor_date).slice(0,10);
            const completedCount=Number(series.completed_count)+1,remaining=series.remaining_count===null?null:Number(series.remaining_count);
            const rule=series.rule as {frequency:"daily"|"weekly"|"monthly";interval:number;weekdays?:number[]};
            const nextDate=remaining!==null&&remaining<=1?null:nextTodoOccurrenceDate(String(series.anchor_date).slice(0,10),scheduled,localDateAt(new Date(),series.timezone),rule,series.ends_on?String(series.ends_on).slice(0,10):null);
            if(nextDate){
              const localTime=series.local_time?String(series.local_time).slice(0,5):row.deadline_at?utcToLocalDateTime(stamp(row.deadline_at)!,series.timezone).slice(11,16):null;
              const deadlineAt=row.deadline_at&&localTime?localDateTimeToUtc(`${nextDate}T${localTime}`,series.timezone):null;
              const inserted=await tx.execute(sql`insert into todos(user_id,project_id,list_id,recurrence_id,title,description,state,priority,planned_date,deadline_date,deadline_at,timezone,position) values(${userId},${row.project_id},${row.list_id},${series.id},${row.title},${row.description},'todo',${row.priority},${nextDate},${row.deadline_date?nextDate:null},${deadlineAt},${series.timezone},coalesce((select max(position)+1 from todos where user_id=${userId} and project_id is not distinct from ${row.project_id} and list_id is not distinct from ${row.list_id} and trashed_at is null),0)) returning id`);
              const nextId=String(inserted.rows[0].id);
              await tx.execute(sql`insert into todo_subtasks(user_id,todo_id,title,position) select user_id,${nextId},title,position from todo_subtasks where todo_id=${id} and user_id=${userId} order by position,id`);
              await tx.execute(sql`insert into todo_sources(user_id,todo_id,resource_id) select user_id,${nextId},resource_id from todo_sources where todo_id=${id} and user_id=${userId}`);
              await tx.execute(sql`insert into todo_occurrences(user_id,recurrence_id,todo_id,occurrence_number,scheduled_date) values(${userId},${series.id},${nextId},${completedCount+1},${nextDate})`);
              await tx.execute(sql`update todo_recurrences set current_todo_id=${nextId},completed_count=${completedCount},remaining_count=${remaining===null?null:remaining-1},updated_at=now() where id=${series.id} and user_id=${userId}`);
            }else{
              await tx.execute(sql`update todo_recurrences set active=false,current_todo_id=null,completed_count=${completedCount},remaining_count=${remaining===null?null:0},updated_at=now() where id=${series.id} and user_id=${userId}`);
            }
            }else{
              await tx.execute(sql`update todo_recurrences set completed_count=completed_count+1,updated_at=now() where id=${series.id} and user_id=${userId}`);
            }
          }
        }
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
