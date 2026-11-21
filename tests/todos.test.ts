import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { fixture } from "./helpers.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../apps/server/src/app.js";
import { createServer } from "node:net";
import { once } from "node:events";
import { maintainTodos } from "../apps/server/src/todo-maintenance.js";

async function freePort(){const server=createServer().listen(0,"127.0.0.1");await once(server,"listening");const port=(server.address() as any).port;await new Promise<void>(resolve=>server.close(()=>resolve()));return port;}
const data=(result:any)=>JSON.parse(result.content[0].text).data;

test("Todos are private task records with owned projects, lists, sources and retry-safe capture", async () => {
  const f=await fixture();
  try {
    const a=await f.signup(),b=await f.signup();
    const initialPreferences=(await f.request("GET","/api/todo-preferences",undefined,a.cookie)).json().preferences;
    assert.equal(initialPreferences.configured,false);
    const savedPreferences=await f.request("PUT","/api/todo-preferences",{timezone:"Europe/London"},a.cookie);
    assert.equal(savedPreferences.statusCode,200,savedPreferences.body);
    assert.equal(savedPreferences.json().preferences.timezone,"Europe/London");
    assert.equal((await f.request("GET","/api/todo-preferences",undefined,b.cookie)).json().preferences.configured,false,"timezone preferences are private to each account");
    const preferenceTask=(await f.request("POST","/api/todos",{title:"Use my saved timezone",requestId:randomUUID()},a.cookie)).json().todo;
    assert.equal(preferenceTask.timezone,"Europe/London","new tasks use the saved timezone when none is sent");
    const project=(await f.request("POST","/api/projects",{name:"Reading project"},a.cookie)).json().project;
    const saved=(await f.request("POST","/api/items",{kind:"link",url:"https://example.test/read-later",title:"A useful article"},a.cookie)).json().item;
    const foreign=(await f.request("POST","/api/items",{kind:"note",title:"Private",body:"Do not expose"},b.cookie)).json().item;
    const list=(await f.request("POST","/api/todo-lists",{name:"Read next",projectId:project.id},a.cookie)).json().list;
    const input={title:"Read the article",description:"Compare it with the other source",projectId:project.id,listId:list.id,sourceIds:[saved.id],requestId:randomUUID()};
    const created=await f.request("POST","/api/todos",input,a.cookie);
    assert.equal(created.statusCode,200,created.body);
    const todo=created.json().todo;
    assert.equal(todo.title,input.title); assert.equal(todo.projectId,project.id); assert.equal(todo.listId,list.id);
    assert.equal(todo.sources[0].resourceId,saved.id);
    const replay=await f.request("POST","/api/todos",input,a.cookie);
    assert.equal(replay.statusCode,200,replay.body); assert.equal(replay.json().todo.id,todo.id);
    assert.equal((await f.request("POST","/api/todos",{...input,title:"Changed content"},a.cookie)).statusCode,409);
    assert.equal((await f.request("GET","/api/todos",undefined,b.cookie)).json().total,0);
    assert.equal((await f.request("GET",`/api/todos/${todo.id}`,undefined,b.cookie)).statusCode,404);
    assert.equal((await f.request("GET","/api/todo-lists",undefined,b.cookie)).json().items.length,0);
    assert.equal((await f.request("GET","/api/resources",undefined,a.cookie)).json().total,1,"tasks stay out of the saved-resource library");
    assert.equal((await f.request("PUT","/api/todo-preferences",{timezone:"Not/AZone"},a.cookie)).statusCode,400);

    const personal=(await f.request("POST","/api/todo-lists",{name:"Personal"},a.cookie)).json().list;
    const secondTask=(await f.request("POST","/api/todos",{title:"Another follow-up",requestId:randomUUID()},a.cookie)).json().todo;
    await f.request("POST",`/api/todos/${preferenceTask.id}/subtasks`,{title:"Check the source"},a.cookie);
    const bulkTaskA=(await f.request("GET",`/api/todos/${preferenceTask.id}`,undefined,a.cookie)).json().todo;
    const bulkMoveInput={action:"move",tasks:[{id:bulkTaskA.id,revision:bulkTaskA.revision},{id:secondTask.id,revision:secondTask.revision}],requestId:randomUUID(),projectId:project.id,listId:list.id};
    const bulkMoved=await f.request("POST","/api/todos/bulk",bulkMoveInput,a.cookie);
    assert.equal(bulkMoved.statusCode,200,bulkMoved.body);assert.ok(bulkMoved.json().todos.every((task:any)=>task.projectId===project.id&&task.listId===list.id));
    const bulkMoveReplay=await f.request("POST","/api/todos/bulk",bulkMoveInput,a.cookie);
    assert.equal(bulkMoveReplay.statusCode,200,bulkMoveReplay.body);assert.equal(bulkMoveReplay.json().todos[0].revision,bulkMoved.json().todos[0].revision,"bulk move retries return their original result");
    const beforeOrder=bulkMoved.json().todos;
    const orderedBefore=[...beforeOrder].sort((a:any,b:any)=>a.position-b.position);
    const reorderInput={tasks:[{id:orderedBefore[0].id,revision:orderedBefore[0].revision,position:orderedBefore[1].position},{id:orderedBefore[1].id,revision:orderedBefore[1].revision,position:orderedBefore[0].position}],requestId:randomUUID()};
    const reordered=await f.request("POST","/api/todos/reorder",reorderInput,a.cookie);
    assert.equal(reordered.statusCode,200,reordered.body);
    const manual=(await f.request("GET",`/api/todos?sort=manual&projectId=${project.id}&listId=${list.id}`,undefined,a.cookie)).json().items;
    assert.ok(manual.findIndex((task:any)=>task.id===orderedBefore[1].id)<manual.findIndex((task:any)=>task.id===orderedBefore[0].id),`manual view applies saved positions: ${JSON.stringify({before:beforeOrder.map((task:any)=>({id:task.id,title:task.title,position:task.position})),requested:reorderInput.tasks,reordered:reordered.json().todos.map((task:any)=>({id:task.id,title:task.title,position:task.position})),manual:manual.map((task:any)=>({id:task.id,title:task.title,position:task.position}))})}`);
    assert.equal((await f.request("POST","/api/todos/reorder",reorderInput,a.cookie)).json().todos[0].revision,reordered.json().todos[0].revision,"reorder retries return their original result");
    const orderedTasks=reordered.json().todos;
    const unfinished=orderedTasks.find((task:any)=>task.id===preferenceTask.id);
    const bulkCompleteInput={action:"complete",tasks:orderedTasks.map((task:any)=>({id:task.id,revision:task.revision})),requestId:randomUUID()};
    assert.equal((await f.request("POST","/api/todos/bulk",bulkCompleteInput,a.cookie)).statusCode,409,"bulk completion must make unfinished-subtask behavior explicit");
    const bulkCompleted=await f.request("POST","/api/todos/bulk",{...bulkCompleteInput,subtasks:"complete_all"},a.cookie);
    assert.equal(bulkCompleted.statusCode,200,bulkCompleted.body);assert.ok(bulkCompleted.json().todos.every((task:any)=>task.state==="done"));assert.ok(bulkCompleted.json().todos.find((task:any)=>task.id===preferenceTask.id).subtasks[0].completedAt);
    assert.equal((await f.request("POST","/api/todos/bulk",{...bulkCompleteInput,subtasks:"parent_only"},a.cookie)).statusCode,409,"bulk request IDs reject changed payloads");
    assert.ok(unfinished);
    assert.equal((await f.request("POST","/api/todos",{...input,requestId:randomUUID(),listId:personal.id},a.cookie)).statusCode,409,"list and project scope must match");
    assert.equal((await f.request("POST","/api/todos",{...input,requestId:randomUUID(),sourceIds:[foreign.id]},a.cookie)).statusCode,404,"foreign sources cannot be linked");
    assert.equal((await f.request("GET",`/api/todo-lists`,undefined,b.cookie)).json().items.some((item:any)=>item.id===list.id),false);

    const sub=(await f.request("POST",`/api/todos/${todo.id}/subtasks`,{title:"Check the references"},a.cookie)).json().subtask;
    const conflict=await f.request("POST",`/api/todos/${todo.id}/complete`,{revision:todo.revision+1,requestId:randomUUID()},a.cookie);
    assert.equal(conflict.statusCode,409,"subtask changes advance the parent revision and prevent stale completion");
    const current=(await f.request("GET",`/api/todos/${todo.id}`,undefined,a.cookie)).json().todo;
    const blocked=await f.request("POST",`/api/todos/${todo.id}/complete`,{revision:current.revision,requestId:randomUUID()},a.cookie);
    assert.equal(blocked.statusCode,409,"completion must ask what to do with unfinished subtasks");
    const completionRequestId=randomUUID();
    const parentOnly=await f.request("POST",`/api/todos/${todo.id}/complete`,{revision:current.revision,requestId:completionRequestId,subtasks:"parent_only"},a.cookie);
    assert.equal(parentOnly.statusCode,200,parentOnly.body); assert.equal(parentOnly.json().todo.state,"done"); assert.equal(parentOnly.json().todo.subtasks[0].completedAt,null);
    const completionReplay=await f.request("POST",`/api/todos/${todo.id}/complete`,{revision:current.revision,requestId:completionRequestId,subtasks:"parent_only"},a.cookie);
    assert.equal(completionReplay.statusCode,200,completionReplay.body); assert.equal(completionReplay.json().todo.revision,parentOnly.json().todo.revision);
    const reopened=await f.request("POST",`/api/todos/${todo.id}/reopen`,{revision:parentOnly.json().todo.revision},a.cookie);
    const finished=await f.request("POST",`/api/todos/${todo.id}/complete`,{revision:reopened.json().todo.revision,requestId:randomUUID(),subtasks:"complete_all"},a.cookie);
    assert.equal(finished.statusCode,200,finished.body); assert.ok(finished.json().todo.subtasks[0].completedAt);
    assert.equal(finished.json().todo.subtasks[0].id,sub.id);

    const moved=await f.request("DELETE",`/api/todo-lists/${list.id}`,{revision:list.revision},a.cookie);
    assert.equal(moved.statusCode,200,moved.body); assert.equal(moved.json().movedToInbox,true);
    const afterMove=(await f.request("GET",`/api/todos/${todo.id}`,undefined,a.cookie)).json().todo;
    const trashed=await f.request("POST",`/api/todos/${todo.id}/trash`,{revision:afterMove.revision},a.cookie);
    assert.equal(trashed.statusCode,200,trashed.body);
    assert.equal((await f.request("GET","/api/todos?view=trash",undefined,a.cookie)).json().total,1);
    assert.equal((await f.request("DELETE",`/api/todos/${todo.id}`,{revision:trashed.json().todo.revision,confirmation:"no"},a.cookie)).statusCode,400);
    const restored=await f.request("POST",`/api/todos/${todo.id}/restore`,{revision:trashed.json().todo.revision},a.cookie);
    assert.equal(restored.statusCode,200,restored.body);
    const trashedForProjectDelete=await f.request("POST",`/api/todos/${todo.id}/trash`,{revision:restored.json().todo.revision},a.cookie);
    assert.equal(trashedForProjectDelete.statusCode,200,trashedForProjectDelete.body);

    const archived=await f.request("PATCH",`/api/projects/${project.id}`,{revision:project.revision,archived:true},a.cookie);
    assert.equal(archived.statusCode,200,archived.body);
    assert.equal((await f.request("PATCH",`/api/todos/${todo.id}`,{revision:trashedForProjectDelete.json().todo.revision,title:"Changed"},a.cookie)).statusCode,409);
    const latestProject=(await f.request("GET",`/api/projects/${project.id}`,undefined,a.cookie)).json().project;
    const removed=await f.request("DELETE",`/api/projects/${project.id}`,{revision:latestProject.revision,confirmation:"DELETE"},a.cookie);
    assert.equal(removed.statusCode,409,"project tasks and lists continue to block project deletion");
  } finally { await f.close(); }
});

test("Concurrent project archive and source trash win before task moves or links",async()=>{
  const f=await fixture();
  try{
    const account=await f.signup();
    const first=(await f.request("POST","/api/projects",{name:"Current project"},account.cookie)).json().project;
    const destination=(await f.request("POST","/api/projects",{name:"Archive race destination"},account.cookie)).json().project;
    const task=(await f.request("POST","/api/todos",{title:"Move only into an open project",projectId:first.id,requestId:randomUUID()},account.cookie)).json().todo;
    let archivePromise:Promise<any>|undefined,movePromise:Promise<any>|undefined;
    await f.db.transaction(async tx=>{
      await tx.execute(sql`select id from projects where id=${destination.id} for update`);
      archivePromise=f.request("PATCH",`/api/projects/${destination.id}`,{revision:destination.revision,archived:true},account.cookie);
      await new Promise(resolve=>setTimeout(resolve,40));
      movePromise=f.request("POST",`/api/todos/${task.id}/move`,{revision:task.revision,projectId:destination.id,listId:null},account.cookie);
      await new Promise(resolve=>setTimeout(resolve,40));
    });
    assert.equal((await archivePromise!).statusCode,200);
    assert.equal((await movePromise!).statusCode,409,"a queued move rechecks the archived destination after acquiring its row lock");
    assert.equal((await f.request("GET",`/api/todos/${task.id}`,undefined,account.cookie)).json().todo.projectId,first.id);

    const source=(await f.request("POST","/api/items",{kind:"link",url:"https://example.test/source-race",title:"Source being trashed"},account.cookie)).json().item;
    let trashPromise:Promise<any>|undefined,createPromise:Promise<any>|undefined;
    await f.db.transaction(async tx=>{
      await tx.execute(sql`select id from resources where id=${source.id} for update`);
      trashPromise=f.request("POST",`/api/items/${source.id}/lifecycle`,{action:"trash"},account.cookie);
      await new Promise(resolve=>setTimeout(resolve,40));
      createPromise=f.request("POST","/api/todos",{title:"Link only an active source",sourceIds:[source.id],requestId:randomUUID()},account.cookie);
      await new Promise(resolve=>setTimeout(resolve,40));
    });
    assert.equal((await trashPromise!).statusCode,200);
    assert.equal((await createPromise!).statusCode,404,"a queued link rechecks source availability after the trash operation");
    assert.equal((await f.request("GET","/api/todos?view=all&q=Link%20only%20an%20active%20source",undefined,account.cookie)).json().total,0);
  }finally{await f.close();}
});

test("Task account limits include Trash and list creation stops at its account cap",async()=>{
  const f=await fixture();
  try{
    const account=await f.signup();
    await f.db.execute(sql`insert into todos(user_id,title,trashed_at) select ${account.user.id},'Trashed limit fixture',now() from generate_series(1,10000)`);
    const task=await f.request("POST","/api/todos",{title:"One task over the limit",requestId:randomUUID()},account.cookie);
    assert.equal(task.statusCode,409,task.body);
    await f.db.execute(sql`insert into todo_lists(user_id,name) select ${account.user.id},'List '||n from generate_series(1,100) as n`);
    const list=await f.request("POST","/api/todo-lists",{name:"One list over the limit"},account.cookie);
    assert.equal(list.statusCode,409,list.body);
  }finally{await f.close();}
});

test("Recurring tasks keep history, create one next occurrence and stop at their count",async()=>{
  const f=await fixture();
  try{
    const account=await f.signup();
    const source=(await f.request("POST","/api/items",{kind:"link",url:"https://example.test/repeating-source",title:"Recurring source"},account.cookie)).json().item;
    const task=(await f.request("POST","/api/todos",{title:"Review this source",timezone:"Africa/Johannesburg",plannedDate:"2026-11-20",sourceIds:[source.id],requestId:randomUUID()},account.cookie)).json().todo;
    await f.request("POST",`/api/todos/${task.id}/subtasks`,{title:"Check the citations"},account.cookie);
    const current=(await f.request("GET",`/api/todos/${task.id}`,undefined,account.cookie)).json().todo;
    const schedule={revision:current.revision,requestId:randomUUID(),rule:{frequency:"daily",interval:2},timezone:"Africa/Johannesburg",anchorDate:"2026-11-20",count:3,endsOn:"2026-12-10"};
    const started=await f.request("PUT",`/api/todos/${task.id}/recurrence`,schedule,account.cookie);
    assert.equal(started.statusCode,200,started.body);assert.equal(started.json().recurrence.remainingCount,3);
    assert.equal((await f.request("PATCH",`/api/todos/${task.id}`,{revision:started.json().todo.revision,state:"done"},account.cookie)).statusCode,409,"recurring completion must record an occurrence");
    const bulk=await f.request("POST","/api/todos/bulk",{action:"complete",tasks:[{id:task.id,revision:started.json().todo.revision}],requestId:randomUUID()},account.cookie);
    assert.equal(bulk.statusCode,409,"bulk completion cannot skip recurrence history");
    const firstCompletion={revision:started.json().todo.revision,requestId:randomUUID(),subtasks:"parent_only"};
    const first=await f.request("POST",`/api/todos/${task.id}/complete`,firstCompletion,account.cookie);
    assert.equal(first.statusCode,200,first.body);
    const firstReplay=await f.request("POST",`/api/todos/${task.id}/complete`,firstCompletion,account.cookie);
    assert.equal(firstReplay.json().todo.revision,first.json().todo.revision,"retry does not create a duplicate occurrence");
    let recurrence=(await f.request("GET",`/api/todos/${task.id}/recurrence`,undefined,account.cookie)).json().recurrence;
    assert.equal(recurrence.history.length,2);assert.equal(recurrence.history[0].scheduledDate,"2026-11-22");
    let next=(await f.request("GET","/api/todos?view=all",undefined,account.cookie)).json().items.find((item:any)=>item.recurrenceId===recurrence.id);
    assert.equal(next.plannedDate,"2026-11-22");
    let full=(await f.request("GET",`/api/todos/${next.id}`,undefined,account.cookie)).json().todo;
    assert.equal(full.sources[0].resourceId,source.id);assert.equal(full.subtasks[0].completedAt,null);
    await f.request("POST",`/api/todos/${next.id}/complete`,{revision:next.revision,requestId:randomUUID(),subtasks:"parent_only"},account.cookie);
    recurrence=(await f.request("GET",`/api/todos/${task.id}/recurrence`,undefined,account.cookie)).json().recurrence;
    next=(await f.request("GET","/api/todos?view=all",undefined,account.cookie)).json().items.find((item:any)=>item.recurrenceId===recurrence.id);
    assert.equal(next.plannedDate,"2026-11-24");
    const finalCompletion=await f.request("POST",`/api/todos/${next.id}/complete`,{revision:next.revision,requestId:randomUUID(),subtasks:"parent_only"},account.cookie);
    assert.equal(finalCompletion.statusCode,200,finalCompletion.body);
    recurrence=(await f.request("GET",`/api/todos/${task.id}/recurrence`,undefined,account.cookie)).json().recurrence;
    assert.equal(recurrence.active,false,JSON.stringify(recurrence));assert.equal(recurrence.currentTodoId,null);assert.equal(recurrence.remainingCount,0);assert.equal(recurrence.history.length,3);
    assert.equal((await f.request("GET","/api/todos?view=all",undefined,account.cookie)).json().total,0,"a finished series has no open task");
  }finally{await f.close();}
});

test("Recurring completion undo removes only an untouched next occurrence",async()=>{
  const f=await fixture();
  try{
    const account=await f.signup();
    const task=(await f.request("POST","/api/todos",{title:"Review weekly findings",plannedDate:"2026-11-20",timezone:"Africa/Johannesburg",requestId:randomUUID()},account.cookie)).json().todo;
    const schedule=await f.request("PUT",`/api/todos/${task.id}/recurrence`,{revision:task.revision,requestId:randomUUID(),rule:{frequency:"daily",interval:1},timezone:"Africa/Johannesburg",anchorDate:"2026-11-20",count:4},account.cookie);
    assert.equal(schedule.statusCode,200,schedule.body);
    const firstDone=await f.request("POST",`/api/todos/${task.id}/complete`,{revision:schedule.json().todo.revision,requestId:randomUUID()},account.cookie);
    assert.equal(firstDone.statusCode,200,firstDone.body);
    const next=(await f.request("GET","/api/todos?view=all",undefined,account.cookie)).json().items.find((item:any)=>item.recurrenceId===schedule.json().recurrence.id);
    const undone=await f.request("POST",`/api/todos/${task.id}/reopen`,{revision:firstDone.json().todo.revision},account.cookie);
    assert.equal(undone.statusCode,200,undone.body);
    let recurrence=(await f.request("GET",`/api/todos/${task.id}/recurrence`,undefined,account.cookie)).json().recurrence;
    assert.equal(recurrence.currentTodoId,task.id);assert.equal(recurrence.completedCount,0);assert.equal(recurrence.remainingCount,4);
    assert.equal(recurrence.history.length,1);assert.equal(recurrence.history[0].completedAt,null);
    let active=(await f.request("GET","/api/todos?view=all",undefined,account.cookie)).json().items.filter((item:any)=>item.recurrenceId===recurrence.id);
    assert.deepEqual(active.map((item:any)=>item.id),[task.id],"undo deletes only the untouched generated occurrence");

    const completedAgain=await f.request("POST",`/api/todos/${task.id}/complete`,{revision:undone.json().todo.revision,requestId:randomUUID()},account.cookie);
    assert.equal(completedAgain.statusCode,200,completedAgain.body);
    const createdNext=(await f.request("GET","/api/todos?view=all",undefined,account.cookie)).json().items.find((item:any)=>item.id!==task.id&&item.recurrenceId===recurrence.id);
    const editedNext=await f.request("PATCH",`/api/todos/${createdNext.id}`,{revision:createdNext.revision,title:"Keep this edited occurrence"},account.cookie);
    assert.equal(editedNext.statusCode,200,editedNext.body);
    const unsafeUndo=await f.request("POST",`/api/todos/${task.id}/reopen`,{revision:completedAgain.json().todo.revision},account.cookie);
    assert.equal(unsafeUndo.statusCode,409,"undo must not delete edits made to the next occurrence");
    assert.equal((await f.request("GET",`/api/todos/${createdNext.id}`,undefined,account.cookie)).json().todo.title,"Keep this edited occurrence");

    const stopped=await f.request("POST",`/api/todos/${createdNext.id}/recurrence/stop`,{revision:editedNext.json().todo.revision,requestId:randomUUID()},account.cookie);
    assert.equal(stopped.statusCode,200,stopped.body);
    const finished=await f.request("POST",`/api/todos/${createdNext.id}/complete`,{revision:editedNext.json().todo.revision,requestId:randomUUID()},account.cookie);
    assert.equal(finished.statusCode,200,finished.body);
    recurrence=(await f.request("GET",`/api/todos/${task.id}/recurrence`,undefined,account.cookie)).json().recurrence;
    assert.equal(recurrence.active,false);assert.equal(recurrence.history.filter((item:any)=>item.completedAt).length,2);
    active=(await f.request("GET","/api/todos?view=all",undefined,account.cookie)).json().items.filter((item:any)=>item.recurrenceId===recurrence.id);
    assert.equal(active.length,0,"stopping a series never creates another occurrence");
  }finally{await f.close();}
});

test("Todo MCP tools share records and preserve read-only and account boundaries",async()=>{
  const f=await fixture();let app:any;const clients:Client[]=[];
  try{
    const a=await f.signup(),b=await f.signup();
    for(const account of [a,b])await f.request("POST","/api/auth/verify",{token:f.token("verify",account.email)});
    const endpoint=`http://127.0.0.1:${await freePort()}`;
    app=await createApp(f.db,{publicApiUrl:endpoint,mailer:{async send(){}}});
    await app.listen({port:new URL(endpoint).port,host:"127.0.0.1"});
    for(const [cookie,scope] of [[a.cookie,"write"],[a.cookie,"read"],[b.cookie,"read"]]){
      const key=(await f.request("POST","/api/keys",{name:`Todo ${scope}`,scope},cookie)).json();
      const client=new Client({name:"todo-sdk",version:"1"});
      await client.connect(new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${key.token}`}}}));
      clients.push(client);
    }
    const [writer,reader,foreign]=clients;
    const readNames=(await reader.listTools()).tools.map(tool=>tool.name),writeNames=(await writer.listTools()).tools.map(tool=>tool.name);
    assert.ok(readNames.includes("list_todos"));assert.ok(readNames.includes("get_todo"));assert.ok(readNames.includes("list_todo_reminders"));assert.ok(!readNames.includes("create_todo"));assert.ok(!readNames.includes("schedule_todo_reminder"));
    assert.ok(writeNames.includes("schedule_todo_reminder"));assert.ok(writeNames.includes("act_on_todo_reminder"));assert.ok(writeNames.includes("update_todo_preferences"));
    const requestId=randomUUID();
    const created=data(await writer.callTool({name:"create_todo",arguments:{title:"Review the saved finding",description:"Keep the context",projectId:null,listId:null,priority:"normal",plannedDate:null,deadlineDate:null,deadlineAt:null,timezone:"Africa/Johannesburg",sourceIds:[],requestId}}));
    const readerList=data(await reader.callTool({name:"list_todos",arguments:{view:"all",q:null,projectId:null,listId:null,state:null,priority:null,offset:0,limit:50}}));
    assert.ok(readerList.items.some((item:any)=>item.id===created.id));
    assert.ok((await reader.callTool({name:"update_todo",arguments:{id:created.id,revision:1,title:"Forbidden"}})).isError);
    assert.equal(data(await reader.callTool({name:"get_todo",arguments:{id:created.id}})).title,"Review the saved finding");
    const completeId=randomUUID();
    const completed=data(await writer.callTool({name:"complete_todo",arguments:{id:created.id,revision:1,requestId:completeId}}));
    const repeated=data(await writer.callTool({name:"complete_todo",arguments:{id:created.id,revision:1,requestId:completeId}}));
    assert.equal(repeated.revision,completed.revision,"completion retries return the same recorded outcome");
    assert.equal(data(await writer.callTool({name:"trash_todo",arguments:{id:created.id,revision:completed.revision}})).state,"done");
    assert.ok((await reader.callTool({name:"get_todo",arguments:{id:created.id}})).isError);
    assert.equal(data(await reader.callTool({name:"get_todo",arguments:{id:created.id,trash:true}})).trashedAt!==null,true);
    assert.equal(data(await foreign.callTool({name:"list_todos",arguments:{view:"all",q:null,projectId:null,listId:null,state:null,priority:null,offset:0,limit:50}})).total,0);
    assert.ok((await foreign.callTool({name:"get_todo",arguments:{id:created.id,trash:true}})).isError);
    const bulkA=data(await writer.callTool({name:"create_todo",arguments:{title:"Bulk follow-up A",description:"",projectId:null,listId:null,priority:"normal",plannedDate:null,deadlineDate:null,deadlineAt:null,timezone:"UTC",sourceIds:[],requestId:randomUUID()}}));
    const bulkB=data(await writer.callTool({name:"create_todo",arguments:{title:"Bulk follow-up B",description:"",projectId:null,listId:null,priority:"normal",plannedDate:null,deadlineDate:null,deadlineAt:null,timezone:"UTC",sourceIds:[],requestId:randomUUID()}}));
    const reordered=data(await writer.callTool({name:"reorder_todos",arguments:{tasks:[{id:bulkA.id,revision:bulkA.revision,position:1},{id:bulkB.id,revision:bulkB.revision,position:0}],requestId:randomUUID()}}));
    assert.equal(reordered.todos.length,2);
    const manual=data(await writer.callTool({name:"list_todos",arguments:{view:"all",sort:"manual",q:null,projectId:null,listId:null,state:null,priority:null,offset:0,limit:50}}));
    assert.ok(manual.items.findIndex((item:any)=>item.id===bulkB.id)<manual.items.findIndex((item:any)=>item.id===bulkA.id));
    const bulkRequestId=randomUUID(),bulkArgs={action:"complete",tasks:reordered.todos.map((task:any)=>({id:task.id,revision:task.revision})),requestId:bulkRequestId};
    const bulkCompleted=data(await writer.callTool({name:"bulk_update_todos",arguments:bulkArgs}));
    assert.ok(bulkCompleted.todos.every((todo:any)=>todo.state==="done"));
    const bulkReplay=data(await writer.callTool({name:"bulk_update_todos",arguments:bulkArgs}));
    assert.deepEqual(bulkReplay.todos.map((todo:any)=>todo.revision),bulkCompleted.todos.map((todo:any)=>todo.revision));
    const recurring=data(await writer.callTool({name:"create_todo",arguments:{title:"Weekly review",description:"",projectId:null,listId:null,priority:"normal",plannedDate:"2026-11-20",deadlineDate:null,deadlineAt:null,timezone:"Africa/Johannesburg",sourceIds:[],requestId:randomUUID()}}));
    const schedule=data(await writer.callTool({name:"set_todo_recurrence",arguments:{id:recurring.id,revision:recurring.revision,requestId:randomUUID(),rule:{frequency:"weekly",interval:1,weekdays:[1,3,5]},timezone:"Africa/Johannesburg",anchorDate:"2026-11-20",count:4}}));
    assert.equal(schedule.recurrence.active,true);
    const recurrenceInfo=data(await reader.callTool({name:"get_todo_recurrence",arguments:{id:recurring.id}}));
    assert.equal(recurrenceInfo.rule.frequency,"weekly");
    const stopped=data(await writer.callTool({name:"stop_todo_recurrence",arguments:{id:recurring.id,revision:schedule.todo.revision,requestId:randomUUID()}}));
    assert.equal(stopped.active,false);
    const reminderTask=data(await writer.callTool({name:"create_todo",arguments:{title:"Read this tomorrow",description:"",projectId:null,listId:null,priority:"normal",plannedDate:null,deadlineDate:null,deadlineAt:null,timezone:"UTC",sourceIds:[],requestId:randomUUID()}}));
    const reminderArgs={id:reminderTask.id,requestId:randomUUID(),scheduledAt:new Date(Date.now()+60*60_000).toISOString(),channels:["in_app"]};
    const reminder=data(await writer.callTool({name:"schedule_todo_reminder",arguments:reminderArgs}));
    const reminderReplay=data(await writer.callTool({name:"schedule_todo_reminder",arguments:reminderArgs}));
    assert.equal(reminder.reminders[0].id,reminderReplay.reminders[0].id,"MCP reminder retries preserve one scheduled delivery");
  }finally{for(const client of clients)await client.close();if(app)await app.close();await f.close();}
});

test("Todo maintenance purges expired Trash, preserves live history and removes only terminal bookkeeping",async()=>{
  const f=await fixture();
  try{
    const account=await f.signup();
    const task=(await f.request("POST","/api/todos",{title:"Expired repeating task",requestId:randomUUID()},account.cookie)).json().todo;
    const schedule=await f.request("PUT",`/api/todos/${task.id}/recurrence`,{revision:task.revision,requestId:randomUUID(),rule:{frequency:"daily",interval:1},timezone:"UTC",anchorDate:"2026-11-21"},account.cookie);
    assert.equal(schedule.statusCode,200,schedule.body);
    const trashed=await f.request("POST",`/api/todos/${task.id}/trash`,{revision:schedule.json().todo.revision},account.cookie);
    assert.equal(trashed.statusCode,200,trashed.body);
    const reminderTask=(await f.request("POST","/api/todos",{title:"Keep this task",requestId:randomUUID()},account.cookie)).json().todo;
    await f.db.execute(sql`update todos set trashed_at=now()-interval '31 days' where id=${task.id} and user_id=${account.user.id}`);
    await f.db.execute(sql`insert into todo_reminders(user_id,todo_id,channel,status,scheduled_at,idempotency_key,updated_at) values
      (${account.user.id},${task.id},'in_app','pending',now()-interval '40 days','expired-pending',now()-interval '40 days'),
      (${account.user.id},${reminderTask.id},'in_app','read',now()-interval '100 days','expired-terminal',now()-interval '100 days')`);
    await f.db.execute(sql`update todo_requests set created_at=now()-interval '100 days' where user_id=${account.user.id}`);

    const historyTask=(await f.request("POST","/api/todos",{title:"Long running series",requestId:randomUUID()},account.cookie)).json().todo;
    const historySchedule=await f.request("PUT",`/api/todos/${historyTask.id}/recurrence`,{revision:historyTask.revision,requestId:randomUUID(),rule:{frequency:"daily",interval:1},timezone:"UTC",anchorDate:"2026-11-21"},account.cookie);
    assert.equal(historySchedule.statusCode,200,historySchedule.body);
    const recurrenceId=historySchedule.json().recurrence.id;
    await f.db.execute(sql`with inserted as (
      insert into todos(user_id,recurrence_id,title,state,completed_at,position)
      select ${account.user.id},${recurrenceId},'Old occurrence '||n,'done',now()-interval '400 days',n
      from generate_series(1,102) n returning id,position
    )
    insert into todo_occurrences(user_id,recurrence_id,todo_id,occurrence_number,scheduled_date,completed_at)
    select ${account.user.id},${recurrenceId},id,position+1,date '2020-01-01'+position,now()-interval '400 days' from inserted`);

    const result=await maintainTodos(f.db);
    assert.equal(result.purged,1);
    assert.equal(result.terminalReminders,1);
    assert.ok(result.requests>=1);
    assert.equal(result.orphanedSeries,1,"an inactive recurrence with no remaining tasks or history is removed");
    assert.equal(Number((await f.db.execute(sql`select count(*)::int as count from todo_recurrences where id=${schedule.json().recurrence.id}`)).rows[0].count),0,"purging the trashed current occurrence stops and removes its empty schedule");
    assert.equal(Number((await f.db.execute(sql`select count(*)::int as count from todo_reminders where idempotency_key='expired-pending'`)).rows[0].count),0,"pending reminders cascade with purged tasks instead of becoming orphaned jobs");
    assert.equal(Number((await f.db.execute(sql`select count(*)::int as count from todo_reminders where idempotency_key='expired-terminal'`)).rows[0].count),0);
    assert.equal(Number((await f.db.execute(sql`select count(*)::int as count from todo_occurrences where recurrence_id=${recurrenceId} and completed_at is not null`)).rows[0].count),102,"old history remains available while its completed tasks are retained");
  }finally{await f.close();}
});
