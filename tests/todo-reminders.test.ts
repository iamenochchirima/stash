import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { fixture } from "./helpers.js";
import { processTodoReminder } from "../apps/server/src/todo-reminder-worker.js";

test("Todo reminders deliver in-app, snooze/read/dismiss and send private verified email",async()=>{
  const f=await fixture();
  try{
    const account=await f.signup(),task=(await f.request("POST","/api/todos",{title:"Compare the saved studies",requestId:randomUUID()},account.cookie)).json().todo;
    const due=new Date(Date.now()+60_000),schedule={requestId:randomUUID(),scheduledAt:due.toISOString(),channels:["in_app"]};
    const created=await f.request("POST",`/api/todos/${task.id}/reminders`,schedule,account.cookie);
    assert.equal(created.statusCode,200,created.body);assert.equal(created.json().reminders.length,1);
    assert.deepEqual((await f.request("POST",`/api/todos/${task.id}/reminders`,schedule,account.cookie)).json(),created.json(),"schedule retries return the same reminder");
    assert.equal((await f.request("GET","/api/todo-reminders?unreadOnly=true",undefined,account.cookie)).json().items.length,0);
    const mail:any[]=[];
    await processTodoReminder(f.db,{async send(message){mail.push(message);}},"https://stash.example",{emailEnabled:true,now:new Date(due.getTime()+1000)});
    let inbox=(await f.request("GET","/api/todo-reminders?unreadOnly=true",undefined,account.cookie)).json().items;
    assert.equal(inbox.length,1);assert.equal(inbox[0].status,"sent");assert.equal(inbox[0].title,task.title);
    const snoozeAt=new Date(due.getTime()+2*60*60_000);
    const snoozed=await f.request("POST",`/api/todo-reminders/${inbox[0].id}/action`,{action:"snooze",scheduledAt:snoozeAt.toISOString()},account.cookie);
    assert.equal(snoozed.statusCode,200,snoozed.body);assert.equal((await f.request("GET","/api/todo-reminders?unreadOnly=true",undefined,account.cookie)).json().items.length,0);
    await processTodoReminder(f.db,{async send(message){mail.push(message);}},"https://stash.example",{emailEnabled:true,now:new Date(snoozeAt.getTime()+1000)});
    inbox=(await f.request("GET","/api/todo-reminders?unreadOnly=true",undefined,account.cookie)).json().items;
    await f.request("POST",`/api/todo-reminders/${inbox[0].id}/action`,{action:"read"},account.cookie);
    assert.equal((await f.request("GET","/api/todo-reminders?unreadOnly=true",undefined,account.cookie)).json().items.length,0);
    await f.request("POST",`/api/todo-reminders/${inbox[0].id}/action`,{action:"dismiss"},account.cookie);
    assert.equal((await f.request("GET","/api/todo-reminders",undefined,account.cookie)).json().items[0].status,"dismissed");

    assert.equal((await f.request("PUT","/api/todo-preferences",{timezone:"Africa/Johannesburg",emailReminders:true},account.cookie)).statusCode,409,"email reminders require a verified address");
    await f.request("POST","/api/auth/verify",{token:f.token("verify",account.email)});
    const prefs=await f.request("PUT","/api/todo-preferences",{timezone:"Africa/Johannesburg",emailReminders:true},account.cookie);
    assert.equal(prefs.statusCode,200,prefs.body);assert.equal(prefs.json().preferences.emailReminders,true);
    const emailDue=new Date(Date.now()+90_000),emailReminder=await f.request("POST",`/api/todos/${task.id}/reminders`,{requestId:randomUUID(),scheduledAt:emailDue.toISOString(),channels:["email"]},account.cookie);
    assert.equal(emailReminder.statusCode,200,emailReminder.body);
    await processTodoReminder(f.db,{async send(message){mail.push(message);}},"https://stash.example",{emailEnabled:true,now:new Date(emailDue.getTime()+1000)});
    const delivered=mail.at(-1);assert.equal(delivered.to,account.email);assert.match(delivered.idempotencyKey,/^stash-todo-reminder-/);assert.match(delivered.text,/taskId=/);assert.equal(delivered.text.includes(task.title),false,"email leaves task details behind sign-in");
    const emailId=emailReminder.json().reminders[0].id;
    const row=await f.db.execute((await import("drizzle-orm")).sql`select status from todo_reminders where id=${emailId}`);
    assert.equal(row.rows[0].status,"sent");
  }finally{await f.close();}
});

test("disabled Todo reminders reject new schedules and skip worker processing",async()=>{
  const f=await fixture({todoRemindersEnabled:false});
  try{
    const account=await f.signup(),task=(await f.request("POST","/api/todos",{title:"Schedule only when enabled",requestId:randomUUID()},account.cookie)).json().todo;
    const preferences=await f.request("GET","/api/todo-preferences",undefined,account.cookie);
    assert.equal(preferences.json().preferences.remindersEnabled,false);
    const due=new Date(Date.now()+60_000);
    const denied=await f.request("POST",`/api/todos/${task.id}/reminders`,{requestId:randomUUID(),scheduledAt:due.toISOString(),channels:["in_app"]},account.cookie);
    assert.equal(denied.statusCode,503);
    const count=await f.db.execute(sql`select count(*)::int as count from todo_reminders where user_id=${account.user.id}`);
    assert.equal(count.rows[0].count,0);
    assert.equal(await processTodoReminder(f.db,{async send(){throw new Error("worker must not deliver");}},"https://stash.example",{emailEnabled:true,remindersEnabled:false}),false);
  }finally{await f.close();}
});

test("Todo reminder worker cancels ineligible tasks and marks old reminders missed",async()=>{
  const f=await fixture();
  try{
    const account=await f.signup(),task=(await f.request("POST","/api/todos",{title:"Follow up privately",requestId:randomUUID()},account.cookie)).json().todo,oldTask=(await f.request("POST","/api/todos",{title:"Older reminder",requestId:randomUUID()},account.cookie)).json().todo;
    const oldAt=new Date(Date.now()+60_000),oldReminder=await f.request("POST",`/api/todos/${oldTask.id}/reminders`,{requestId:randomUUID(),scheduledAt:oldAt.toISOString(),channels:["in_app"]},account.cookie);
    const futureAt=new Date(Date.now()+2*60_000),cancelled=await f.request("POST",`/api/todos/${task.id}/reminders`,{requestId:randomUUID(),scheduledAt:futureAt.toISOString(),channels:["in_app"]},account.cookie);
    await f.request("POST",`/api/todos/${task.id}/complete`,{revision:task.revision,requestId:randomUUID()},account.cookie);
    await processTodoReminder(f.db,{async send(){}},"https://stash.example",{emailEnabled:true,now:new Date(oldAt.getTime()+2*24*60*60_000)});
    const inbox=(await f.request("GET","/api/todo-reminders",undefined,account.cookie)).json().items;
    assert.equal(inbox.length,1);assert.equal(inbox[0].id,oldReminder.json().reminders[0].id);assert.equal(inbox[0].status,"missed");
    const states=await f.db.execute((await import("drizzle-orm")).sql`select id,status from todo_reminders where id in (${oldReminder.json().reminders[0].id}::uuid,${cancelled.json().reminders[0].id}::uuid)`);
    assert.equal(states.rows.find((row:any)=>row.id===oldReminder.json().reminders[0].id).status,"missed");assert.equal(states.rows.find((row:any)=>row.id===cancelled.json().reminders[0].id).status,"cancelled");
  }finally{await f.close();}
});

test("Email reminders retry with one stable delivery key and stop after three attempts",async()=>{
  const f=await fixture();
  try{
    const account=await f.signup();await f.request("POST","/api/auth/verify",{token:f.token("verify",account.email)});
    await f.request("PUT","/api/todo-preferences",{timezone:"UTC",emailReminders:true},account.cookie);
    const task=(await f.request("POST","/api/todos",{title:"Send a private reminder",requestId:randomUUID()},account.cookie)).json().todo,due=new Date(Date.now()+60_000);
    const reminder=await f.request("POST",`/api/todos/${task.id}/reminders`,{requestId:randomUUID(),scheduledAt:due.toISOString(),channels:["email"]},account.cookie);
    assert.equal(reminder.statusCode,200,reminder.body);
    const messages:any[]=[];
    for(let attempt=0;attempt<3;attempt++)await processTodoReminder(f.db,{async send(message){messages.push(message);throw new Error("provider timeout");}},"https://stash.example",{emailEnabled:true,now:new Date(due.getTime()+(attempt*61_000)+1000)});
    assert.equal(messages.length,3);assert.equal(new Set(messages.map(message=>message.idempotencyKey)).size,1);
    const state=await f.db.execute((await import("drizzle-orm")).sql`select status,attempts,last_error from todo_reminders where id=${reminder.json().reminders[0].id}`);
    assert.equal(state.rows[0].status,"failed");assert.equal(Number(state.rows[0].attempts),3);assert.equal(state.rows[0].last_error,"email_delivery_failed");
    assert.equal(messages.some(message=>message.text.includes(task.title)),false);
  }finally{await f.close();}
});

test("Email reminder worker recovers expired leases and permanently stops exhausted jobs",async()=>{
  const f=await fixture();
  try{
    const account=await f.signup();await f.request("POST","/api/auth/verify",{token:f.token("verify",account.email)});
    await f.request("PUT","/api/todo-preferences",{timezone:"UTC",emailReminders:true},account.cookie);
    const task=(await f.request("POST","/api/todos",{title:"Recover interrupted delivery",requestId:randomUUID()},account.cookie)).json().todo;
    const now=new Date(),due=new Date(now.getTime()+60_000);
    const retry=(await f.request("POST",`/api/todos/${task.id}/reminders`,{requestId:randomUUID(),scheduledAt:due.toISOString(),channels:["email"]},account.cookie)).json().reminders[0];
    const exhausted=(await f.request("POST",`/api/todos/${task.id}/reminders`,{requestId:randomUUID(),scheduledAt:due.toISOString(),channels:["email"]},account.cookie)).json().reminders[0];
    await f.db.execute(sql`update todo_reminders set status='sending',attempts=1,lease_until=${new Date(now.getTime()-1_000)} where id=${retry.id}`);
    await f.db.execute(sql`update todo_reminders set status='sending',attempts=3,lease_until=${new Date(now.getTime()-1_000)} where id=${exhausted.id}`);
    const sent:any[]=[];
    await processTodoReminder(f.db,{async send(message){sent.push(message);}} ,"https://stash.example",{emailEnabled:true,now});
    const first=await f.db.execute(sql`select status,attempts,lease_until,scheduled_at from todo_reminders where id=${retry.id}`);
    const terminal=await f.db.execute(sql`select status,attempts,lease_until,last_error from todo_reminders where id=${exhausted.id}`);
    assert.equal(first.rows[0].status,"pending");assert.equal(Number(first.rows[0].attempts),1);assert.equal(first.rows[0].lease_until,null);assert.ok(new Date(first.rows[0].scheduled_at as string).getTime()>now.getTime());
    assert.equal(terminal.rows[0].status,"failed");assert.equal(Number(terminal.rows[0].attempts),3);assert.equal(terminal.rows[0].lease_until,null);assert.equal(terminal.rows[0].last_error,"email_delivery_failed");
    await processTodoReminder(f.db,{async send(message){sent.push(message);}} ,"https://stash.example",{emailEnabled:true,now:new Date(now.getTime()+61_000)});
    assert.equal(sent.length,1);assert.equal(sent[0].idempotencyKey,`stash-todo-reminder-${retry.id}`);
    const recovered=await f.db.execute(sql`select status,attempts from todo_reminders where id=${retry.id}`);
    assert.equal(recovered.rows[0].status,"sent");assert.equal(Number(recovered.rows[0].attempts),2);
    await processTodoReminder(f.db,{async send(message){sent.push(message);}} ,"https://stash.example",{emailEnabled:true,now:new Date(now.getTime()+62_000)});
    assert.equal(sent.length,1,"exhausted deliveries do not retry after recovery");
  }finally{await f.close();}
});

test("Account deletion removes Todo lists, recurrence, source links, history and reminders",async()=>{
  const f=await fixture();
  try{
    const account=await f.signup();
    const source=(await f.request("POST","/api/items",{kind:"link",url:"https://example.test/delete-with-account",title:"Private source"},account.cookie)).json().item;
    const project=(await f.request("POST","/api/projects",{name:"Project with private tasks"},account.cookie)).json().project;
    const list=(await f.request("POST","/api/todo-lists",{name:"Private list"},account.cookie)).json().list;
    const task=(await f.request("POST","/api/todos",{title:"Delete account with Todos",listId:list.id,sourceIds:[source.id],plannedDate:"2026-11-21",requestId:randomUUID()},account.cookie)).json().todo;
    await f.request("POST","/api/todos",{title:"Project task removed with owner",projectId:project.id,requestId:randomUUID()},account.cookie);
    await f.request("POST",`/api/todos/${task.id}/subtasks`,{title:"Private subtask"},account.cookie);
    const latest=(await f.request("GET",`/api/todos/${task.id}`,undefined,account.cookie)).json().todo;
    await f.request("PUT",`/api/todos/${task.id}/recurrence`,{revision:latest.revision,requestId:randomUUID(),rule:{frequency:"daily",interval:1},timezone:"UTC",anchorDate:"2026-11-21",count:3},account.cookie);
    await f.request("POST",`/api/todos/${task.id}/reminders`,{requestId:randomUUID(),scheduledAt:new Date(Date.now()+60_000).toISOString(),channels:["in_app"]},account.cookie);
    const deleted=await f.request("DELETE","/api/me",{password:"correct horse battery staple",confirmation:"DELETE"},account.cookie);
    assert.equal(deleted.statusCode,200,deleted.body);
    assert.equal((await f.request("GET","/api/me",undefined,account.cookie)).statusCode,401);
    const remaining=await f.db.execute(sql`select
      (select count(*)::int from todo_lists where user_id=${account.user.id}) as lists,
      (select count(*)::int from todos where user_id=${account.user.id}) as todos,
      (select count(*)::int from todo_subtasks where user_id=${account.user.id}) as subtasks,
      (select count(*)::int from todo_sources where user_id=${account.user.id}) as sources,
      (select count(*)::int from todo_recurrences where user_id=${account.user.id}) as recurrences,
      (select count(*)::int from todo_occurrences where user_id=${account.user.id}) as occurrences,
      (select count(*)::int from todo_reminders where user_id=${account.user.id}) as reminders,
      (select count(*)::int from todo_preferences where user_id=${account.user.id}) as preferences,
      (select count(*)::int from todo_requests where user_id=${account.user.id}) as requests`);
    assert.deepEqual(remaining.rows[0],{lists:0,todos:0,subtasks:0,sources:0,recurrences:0,occurrences:0,reminders:0,preferences:0,requests:0});
  }finally{await f.close();}
});
