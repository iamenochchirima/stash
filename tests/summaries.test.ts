import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { queueSummary, summaryStatus, cancelSummary } from "@stash/core";
import type { SummarySnapshot } from "@stash/shared";
import { fixture } from "./helpers.js";
import { articleText, summarySource } from "../apps/server/src/summary-source.js";
import { openRouterProvider, validateSummary, SummaryProviderError, type SummaryProvider } from "../apps/server/src/summary-provider.js";
import { processSummaryJob } from "../apps/server/src/summary-worker.js";
const fact = "The research team tested twelve filters over six weeks and found that paper filters removed more sediment.";
const snapshot: SummarySnapshot = { kind: "pdf", sources: [{ id: "s1", label: "Page 1", page: 1, text: fact }], partial: false, totalCharacters: fact.length, includedCharacters: fact.length };
const result = { overview: { text: "The team compared filters over six weeks.", sourceIds: ["s1"], quote: "tested twelve filters over six weeks" }, points: [{ text: "Paper filters removed more sediment.", sourceIds: ["s1"], quote: "paper filters removed more sediment" }] };
const provider = (generate?: SummaryProvider["generate"]): SummaryProvider => ({ model: "synthetic/model:free", async preflight() {}, generate: generate || (async () => ({ result, model: "synthetic/model:free", tokens: 200, cost: 0 })) });
async function savedPdf(f: Awaited<ReturnType<typeof fixture>>, userId: string) {
  const added = await f.db.execute(sql`insert into resources(user_id,kind,title,url,notes) values(${userId},'pdf','Synthetic source',null,'Private author notes must stay untouched') returning id,revision`);
  const id = String(added.rows[0].id);
  await f.db.execute(sql`insert into attachments(user_id,resource_id,storage_key,filename,byte_size,state,pages,page_count,upload_expires_at) values(${userId},${id},${userId+"/"+id+".pdf"},'Synthetic.pdf',500,'ready',${JSON.stringify([{page:1,text:fact}])}::jsonb,1,now())`);
  return { id, revision: 1 };
}

test("Summary source extraction blocks private redirects/paywalls and strips executable and navigation text", async () => {
  const body = `<html><body><nav>SECRET NAVIGATION</nav><article><h1>Filter research</h1><p>${fact.repeat(4)}</p><script>steal_credentials()</script></article></body></html>`;
  const boundary = { resolver: async () => [{ address: "93.184.216.34", family: 4 }], request: async () => ({ status: 200, contentType: "text/html", body }) };
  const article = await articleText("https://example.test/research", boundary);
  assert.match(article.text, /paper filters/); assert.doesNotMatch(article.text, /SECRET|steal_credentials/);
  await assert.rejects(articleText("https://example.test/private", { ...boundary, request: async () => ({ status: 302, location: "http://127.0.0.1/private", contentType: "", body: "" }) }));
  await assert.rejects(articleText("https://example.test/paywall", { ...boundary, request: async () => ({ status: 200, contentType: "text/html", body: `<script type="application/ld+json">{"isAccessibleForFree":false}</script>${body}` }) }), /source_unavailable/);
  assert.throws(() => validateSummary({ ...result, points: [{...result.points[0],sourceIds:["s9"]}] },snapshot));
  assert.throws(() => validateSummary({ ...result, overview: {...result.overview,quote:"This quote was invented"} },snapshot));
});

test("OpenRouter adapter enforces free pricing, routing, bounded structured citations and usage", async () => {
  let dispatched = 0;
  const p = openRouterProvider({ apiKey: "synthetic-not-a-key", model: "synthetic/model:free", fetch: async (url, init) => {
    if (String(url).endsWith("/models")) return Response.json({ data: [{id:"synthetic/model:free",pricing:{prompt:"0",completion:"0"}}] });
    dispatched++; const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.provider.max_price,{prompt:0,completion:0,request:0,image:0});
    assert.equal(body.provider.allow_fallbacks,false); assert.equal(body.provider.data_collection,"deny");
    assert.equal(body.tools,undefined); assert.doesNotMatch(JSON.stringify(body.messages),/Private author notes|synthetic-not-a-key/);
    return Response.json({model:"synthetic/model:free",choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:100,cost:0}});
  } });
  await p.preflight(new AbortController().signal);
  assert.equal((await p.generate(snapshot,new AbortController().signal)).tokens,200); assert.equal(dispatched,1);
  const paid = openRouterProvider({apiKey:"synthetic",model:"synthetic/model:free",fetch:async()=>Response.json({data:[{id:"synthetic/model:free",pricing:{prompt:"0.1",completion:"0"}}]})});
  await assert.rejects(paid.preflight(new AbortController().signal),/free_model_unavailable/);
  assert.throws(()=>openRouterProvider({apiKey:"synthetic",model:"paid/model"}));
});

test("Summary jobs deduplicate, preserve notes and previous results, reconcile usage and mark stale revisions", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(), b = await f.signup(), item = await savedPdf(f,a.user.id), requestId = randomUUID();
    const jobs = await Promise.all([1,2].map(()=>queueSummary(f.db,a.user.id,item.id,{revision:1,requestId},true)));
    assert.equal(jobs[0].id,jobs[1].id);
    await assert.rejects(queueSummary(f.db,b.user.id,item.id,{revision:1,requestId:randomUUID()},true));
    const aliasId=randomUUID();
    assert.equal((await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:aliasId},true)).id,jobs[0].id);
    await processSummaryJob(f.db,provider());
    assert.equal((await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:aliasId},true)).state,"succeeded");
    let status = await summaryStatus(f.db,a.user.id,item.id,true);
    assert.equal(status.job?.state,"succeeded"); assert.equal(status.saved?.result.overview.text,result.overview.text);
    assert.equal(status.usage.reservedTokensToday,200);
    const detail = (await f.request("GET",`/api/items/${item.id}`,undefined,a.cookie)).json().item;
    assert.equal(detail.notes,"Private author notes must stay untouched"); assert.equal(detail.revision,1);
    assert.equal((await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId},true)).state,"succeeded");
    await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true);
    await processSummaryJob(f.db,provider(async()=>{throw new SummaryProviderError("provider_invalid_response",false,{tokens:100,cost:0});}));
    status = await summaryStatus(f.db,a.user.id,item.id,true);
    assert.equal(status.job?.state,"failed"); assert.ok(status.saved); assert.equal(status.usage.reservedTokensToday,300);
    await f.request("PATCH",`/api/items/${item.id}`,{revision:1,notes:"Developed context"},a.cookie);
    assert.equal((await summaryStatus(f.db,a.user.id,item.id,true)).saved?.stale,false);
    await f.db.execute(sql`update resources set source_revision=source_revision+1 where id=${item.id}`);
    assert.equal((await summaryStatus(f.db,a.user.id,item.id,true)).saved?.stale,true);
    await assert.rejects(queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true),/changed/);
    await assert.rejects(summaryStatus(f.db,b.user.id,item.id,true),/not found/);
  } finally { await f.close(); }
});

test("Atomic summary quota reservations do not overspend across concurrent items", async () => {
  const f = await fixture();
  try {
    const a=await f.signup(), entries=await Promise.all(Array.from({length:6},()=>savedPdf(f,a.user.id)));
    const reservations=await Promise.allSettled(entries.map(item=>queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true)));
    assert.equal(reservations.filter(r=>r.status==="fulfilled").length,5); assert.equal(reservations.filter(r=>r.status==="rejected").length,1);
    const usage=await f.db.execute(sql`select count(*)::int as total,sum(reserved_tokens)::int as tokens from summary_usage`);
    assert.equal(usage.rows[0].total,5); assert.equal(usage.rows[0].tokens,300000);
    await cancelSummary(f.db,a.user.id,entries[0].id);
    assert.equal((await f.db.execute(sql`select state from item_jobs where resource_id=${entries[0].id}`)).rows[0].state,"cancelled");
  } finally { await f.close(); }
});

test("Ambiguous generation is not retried and a reported charge halts already queued work", async () => {
  const f=await fixture();
  try {
    const a=await f.signup(), item=await savedPdf(f,a.user.id), requestId=randomUUID(); let calls=0;
    await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId},true);
    const p=provider(async()=>{calls++;throw new SummaryProviderError("provider_outcome_unknown",true);});
    await processSummaryJob(f.db,p); assert.equal((await summaryStatus(f.db,a.user.id,item.id,true)).job?.state,"unknown");
    assert.equal(await processSummaryJob(f.db,p),false); assert.equal(calls,1);
    assert.equal((await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId},true)).state,"unknown");
    const second=await savedPdf(f,a.user.id),third=await savedPdf(f,a.user.id);
    await queueSummary(f.db,a.user.id,second.id,{revision:1,requestId:randomUUID()},true);
    await queueSummary(f.db,a.user.id,third.id,{revision:1,requestId:randomUUID()},true);
    const unexpected=provider(async()=>{calls++;throw new SummaryProviderError("provider_budget_violation",true,{tokens:100,cost:0.0000000001});});
    await processSummaryJob(f.db,unexpected); await processSummaryJob(f.db,unexpected);
    assert.equal(calls,2);
    assert.equal((await summaryStatus(f.db,a.user.id,third.id,true)).job?.errorCode,"provider_budget_locked");
    await assert.rejects(queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true),/usage limit/);
  } finally { await f.close(); }
});

test("Account deletion aborts in-flight generation and removes source snapshots and summaries", async () => {
  const f=await fixture();
  try {
    const a=await f.signup(),item=await savedPdf(f,a.user.id);
    await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true);
    let started!:()=>void; const entered=new Promise<void>(r=>{started=r;});
    const work=processSummaryJob(f.db,provider(async(_source,signal)=>{started();return new Promise((_r,reject)=>{signal.addEventListener("abort",()=>reject(new SummaryProviderError("generation_cancelled",true)),{once:true});});}));
    await entered;
    const deleted=await f.request("DELETE","/api/me",{password:"correct horse battery staple",confirmation:"DELETE"},a.cookie);
    assert.equal(deleted.statusCode,200,deleted.body); await work;
    assert.equal((await f.db.execute(sql`select * from item_jobs where user_id=${a.user.id}`)).rows.length,0);
    assert.equal((await f.db.execute(sql`select * from item_summaries where user_id=${a.user.id}`)).rows.length,0);
    const usage=await f.db.execute(sql`select * from summary_usage`); assert.equal(usage.rows.length,1);
    assert.deepEqual(Object.keys(usage.rows[0]).sort(),["actual_tokens","cost_usd","created_at","job_id","outcome","reserved_tokens","user_id"]);
  } finally { await f.close(); }
});

test("Revoked connections and suspended accounts stop queued summaries; unconfigured API stays honest", async () => {
  const f=await fixture();
  try {
    const a=await f.signup(),item=await savedPdf(f,a.user.id);
    assert.equal((await f.request("GET",`/api/items/${item.id}/summary`,undefined,a.cookie)).json().available,false);
    assert.equal((await f.request("POST",`/api/items/${item.id}/summary`,{revision:1,requestId:randomUUID()},a.cookie)).statusCode,503);
    await f.request("POST","/api/auth/verify",{token:f.token("verify",a.email)});
    const key=(await f.request("POST","/api/keys",{name:"Summary writer",scope:"write"},a.cookie)).json();
    await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true,key.id);
    await f.request("DELETE",`/api/keys/${key.id}`,{},a.cookie);
    let calls=0; await processSummaryJob(f.db,provider(async()=>{calls++;throw new Error("Must not call");}));
    assert.equal(calls,0); assert.equal((await summaryStatus(f.db,a.user.id,item.id,true)).job?.state,"cancelled");
    const other=await savedPdf(f,a.user.id);
    await queueSummary(f.db,a.user.id,other.id,{revision:1,requestId:randomUUID()},true);
    await f.db.execute(sql`update users set suspended_at=now() where id=${a.user.id}`);
    await processSummaryJob(f.db,provider());
    assert.equal((await f.db.execute(sql`select state from item_jobs where resource_id=${other.id}`)).rows[0].state,"cancelled");
  } finally { await f.close(); }
});

test("Editing notes during generation preserves the new notes without making the source summary stale",async()=>{
  const f=await fixture();
  try {
    const a=await f.signup(),item=await savedPdf(f,a.user.id);await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true);
    let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>{entered=r;}),resume=new Promise<void>(r=>{release=r;});
    const work=processSummaryJob(f.db,provider(async()=>{entered();await resume;return{result,model:"synthetic/model:free",tokens:200,cost:0};}));
    await started;const edit=await f.request("PATCH",`/api/items/${item.id}`,{revision:1,notes:"New context written during generation"},a.cookie);assert.equal(edit.statusCode,200,edit.body);
    release();await work;const status=await summaryStatus(f.db,a.user.id,item.id,true);assert.equal(status.job?.state,"succeeded");assert.equal(status.saved?.stale,false);
    assert.equal((await f.request("GET",`/api/items/${item.id}`,undefined,a.cookie)).json().item.notes,"New context written during generation");
  } finally {await f.close();}
});

test("Summary provider rejects rate limits, unknown outcomes and unexpected charges without paid fallback",async()=>{
 const signal=new AbortController().signal;
 const rate=openRouterProvider({apiKey:"synthetic",model:"synthetic/model:free",fetch:async()=>new Response("",{status:429})});
 await assert.rejects(rate.generate(snapshot,signal),(e:unknown)=>e instanceof SummaryProviderError&&e.code==="provider_rate_limit"&&!e.ambiguous);
 const timeout=openRouterProvider({apiKey:"synthetic",model:"synthetic/model:free",fetch:async()=>{throw new DOMException("Synthetic timeout","AbortError");}});
 await assert.rejects(timeout.generate(snapshot,signal),(e:unknown)=>e instanceof SummaryProviderError&&e.ambiguous);
 const charge=openRouterProvider({apiKey:"synthetic",model:"synthetic/model:free",fetch:async()=>Response.json({model:"synthetic/model:free",choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:100,cost:0.1}})});
 await assert.rejects(charge.generate(snapshot,signal),(e:unknown)=>e instanceof SummaryProviderError&&e.code==="provider_budget_violation"&&e.usage?.cost===0.1);
 const longText="A factual supporting sentence about this research source. ".repeat(10),longSnapshot={...snapshot,sources:[{id:"s1",label:"Page 1",text:longText}]};
 const bounded=validateSummary({...result,overview:{...result.overview,quote:longText},points:[{...result.points[0],quote:longText}]},longSnapshot);
 assert.ok(bounded.overview.quote.length<=300);assert.ok(longText.includes(bounded.overview.quote));
});

test("Summary workers serialize globally and never replay expired dispatched work",async()=>{
 const f=await fixture();
 try{
  const a=await f.signup(),first=await savedPdf(f,a.user.id),second=await savedPdf(f,a.user.id);let calls=0;
  await queueSummary(f.db,a.user.id,first.id,{revision:1,requestId:randomUUID()},true);
  await queueSummary(f.db,a.user.id,second.id,{revision:1,requestId:randomUUID()},true);
  let entered!:()=>void,release!:()=>void;const start=new Promise<void>(r=>{entered=r;}),resume=new Promise<void>(r=>{release=r;});
  const p=provider(async()=>{calls++;entered();await resume;return{result,model:"synthetic/model:free",tokens:200,cost:0};});
  const running=processSummaryJob(f.db,p);await start;assert.equal(await processSummaryJob(f.db,p),false);assert.equal(calls,1);release();await running;
  await f.db.execute(sql`update item_jobs set state='running',dispatched_at=now()-interval '5 minutes',lease_until=now()-interval '1 minute' where resource_id=${second.id}`);
  assert.equal(await processSummaryJob(f.db,p),false);assert.equal(calls,1);
  assert.equal((await summaryStatus(f.db,a.user.id,second.id,true)).job?.state,"unknown");
 }finally{await f.close();}
});

test("Global summary request limits are reserved atomically across deleted-account usage",async()=>{
 const f=await fixture();
 try{
  const a=await f.signup(),item=await savedPdf(f,a.user.id);
  await f.db.execute(sql`insert into summary_usage(job_id,user_id,reserved_tokens) select gen_random_uuid(),gen_random_uuid(),0 from generate_series(1,100)`);
  await assert.rejects(queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true),/usage limit/);
  await f.db.execute(sql`update summary_usage set created_at=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'`);
  await f.db.execute(sql`insert into summary_usage(job_id,user_id,reserved_tokens,created_at) select gen_random_uuid(),gen_random_uuid(),0,date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' from generate_series(1,900)`);
  await assert.rejects(queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true),/usage limit/);
 }finally{await f.close();}
});


test("Summary reference excerpts come from the server and partial PDF coverage is explicit",async()=>{
 const claim={text:"The trial compared filters.",sourceIds:["s1"]};const validated=validateSummary({overview:claim,points:[claim]},snapshot);
 assert.ok(snapshot.sources[0].text.includes(validated.overview.quote));
 const f=await fixture();
 try{
  const a=await f.signup(),item=await savedPdf(f,a.user.id),pages=Array.from({length:30},(_,i)=>({page:i+1,text:fact.repeat(10)}));
  await f.db.execute(sql`update attachments set pages=${JSON.stringify(pages)}::jsonb,page_count=30 where resource_id=${item.id}`);
  const material=await summarySource(f.db,a.user.id,item.id,1);
  assert.equal(material.snapshot.partial,true);assert.ok(material.snapshot.includedCharacters<=12000);assert.ok(material.snapshot.sources.length<=40);assert.equal(material.snapshot.sources[0].page,1);
  assert.ok(material.snapshot.sources.every(s=>s.text.length<=600));
 }finally{await f.close();}
});

test("User cancellation aborts in-flight generation and never stores the arriving result",async()=>{
 const f=await fixture();
 try{
  const a=await f.signup(),item=await savedPdf(f,a.user.id);await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true);
  let entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});
  const work=processSummaryJob(f.db,provider(async(_snapshot,signal)=>{entered();return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(new SummaryProviderError("generation_cancelled",true)),{once:true}));}));
  await started;await cancelSummary(f.db,a.user.id,item.id);await work;
  const status=await summaryStatus(f.db,a.user.id,item.id,true);assert.equal(status.job?.state,"cancelled");assert.equal(status.saved,null);
  const job=(await f.db.execute(sql`select source_snapshot from item_jobs where resource_id=${item.id}`)).rows[0];assert.equal(job.source_snapshot,null);
 }finally{await f.close();}
});

test("A changed article stays marked stale even when regeneration fails before dispatch",async()=>{
 const f=await fixture();
 try{
  const a=await f.signup(),item=(await f.request("POST","/api/items",{kind:"link",url:"https://example.test/article",title:"Article"},a.cookie)).json().item;
  const first={...snapshot,kind:"link" as const},second={...first,sources:[{...first.sources[0],text:fact+" The article now includes additional context."}]};
  await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true);
  await processSummaryJob(f.db,provider(),async()=>({snapshot:first,hash:"a".repeat(64)}));
  assert.equal((await summaryStatus(f.db,a.user.id,item.id,true)).saved?.stale,false);
  await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true);
  await processSummaryJob(f.db,{...provider(),async preflight(){throw new SummaryProviderError("provider_unavailable");}},async()=>({snapshot:second,hash:"b".repeat(64)}));
  const failed=await summaryStatus(f.db,a.user.id,item.id,true);assert.equal(failed.job?.state,"failed");assert.equal(failed.saved?.stale,true);assert.equal(failed.saved?.sourceHash,"a".repeat(64));
  await queueSummary(f.db,a.user.id,item.id,{revision:1,requestId:randomUUID()},true);
  await processSummaryJob(f.db,provider(),async(_db,_user,_id,revision)=>{assert.equal(revision,2);return{snapshot:second,hash:"b".repeat(64)};});
  assert.equal((await summaryStatus(f.db,a.user.id,item.id,true)).saved?.stale,false);
  const detail=(await f.request("GET",`/api/items/${item.id}`,undefined,a.cookie)).json().item;assert.equal(detail.knownSourceHash,undefined);assert.equal(detail.revision,1);
 }finally{await f.close();}
});
