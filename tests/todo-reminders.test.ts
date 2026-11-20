import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
