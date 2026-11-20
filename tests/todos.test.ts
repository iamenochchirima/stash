import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../apps/server/src/app.js";
import { createServer } from "node:net";
import { once } from "node:events";

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

    const archived=await f.request("PATCH",`/api/projects/${project.id}`,{revision:project.revision,archived:true},a.cookie);
    assert.equal(archived.statusCode,200,archived.body);
    assert.equal((await f.request("PATCH",`/api/todos/${todo.id}`,{revision:restored.json().todo.revision,title:"Changed"},a.cookie)).statusCode,409);
    const latestProject=(await f.request("GET",`/api/projects/${project.id}`,undefined,a.cookie)).json().project;
    const removed=await f.request("DELETE",`/api/projects/${project.id}`,{revision:latestProject.revision,confirmation:"DELETE"},a.cookie);
    assert.equal(removed.statusCode,409,"project tasks and lists continue to block project deletion");
  } finally { await f.close(); }
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
    const readNames=(await reader.listTools()).tools.map(tool=>tool.name);
    assert.ok(readNames.includes("list_todos"));assert.ok(readNames.includes("get_todo"));assert.ok(!readNames.includes("create_todo"));
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
  }finally{for(const client of clients)await client.close();if(app)await app.close();await f.close();}
});
