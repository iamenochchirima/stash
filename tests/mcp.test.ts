import { test } from "node:test";
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import { createApp } from "../apps/server/src/app.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "node:net";
import { once } from "node:events";
async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as any).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
const data = (result: any) => JSON.parse(result.content[0].text).data;
test("T13/E03 MCP SDK lifecycle, scopes, errors, revocation, and persisted retrieval milestones", async () => {
  const f = await fixture();
  let server: any;
  const clients: Client[] = [];
  try {
    const a = await f.signup(),
      b = await f.signup();
    await f.request("POST", "/api/auth/verify", {
      token: f.token("verify", a.email),
    });
    const key = (
        await f.request(
          "POST",
          "/api/keys",
          { name: "Writer", scope: "write" },
          a.cookie,
        )
      ).json(),
      read = (
        await f.request(
          "POST",
          "/api/keys",
          { name: "Reader", scope: "read" },
          a.cookie,
        )
      ).json();
    const port = await freePort(),
      endpoint = `http://127.0.0.1:${port}`;
    server = await createApp(f.db, {
      publicApiUrl: endpoint,
      mailer: { async send() {} },
    });
    await server.listen({ port, host: "127.0.0.1" });
    async function connect(token: string) {
      const client = new Client({
        name: "stash-test-client",
        version: "1.0.0",
      });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      clients.push(client);
      return client;
    }
    const writer = await connect(key.token),
      reader = await connect(read.token);
    assert.ok(
      (await writer.listTools()).tools.some((t) => t.name === "save_resource"),
    );
    assert.ok(
      !(await reader.listTools()).tools.some((t) => t.name === "save_resource"),
    );
    const saved = data(
      await writer.callTool({
        name: "save_resource",
        arguments: {
          url: "https://example.test/mcp",
          title: "Protocol research",
          notes: "Saved by one agent",
        },
      }),
    ).item;
    assert.equal(
      data(
        await reader.callTool({
          name: "get_resource",
          arguments: { id: saved.id },
        }),
      ).notes,
      "Saved by one agent",
    );
    assert.equal(
      (
        await reader.callTool({
          name: "save_resource",
          arguments: { url: "https://example.test/denied", title: "bad" },
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await writer.callTool({
          name: "get_resource",
          arguments: { id: "not-an-id" },
        })
      ).isError,
      true,
    );
    const foreign = (
      await f.request(
        "POST",
        "/api/resources",
        { url: "https://example.test/foreign", title: "Foreign private" },
        b.cookie,
      )
    ).json().item;
    assert.equal(
      (
        await writer.callTool({
          name: "get_resource",
          arguments: { id: foreign.id },
        })
      ).isError,
      true,
    );
    const me = (await f.request("GET", "/api/me", undefined, a.cookie)).json()
      .user;
    assert.equal(me.onboarding.connected, true);
    assert.equal(me.onboarding.retrieved, true);
    assert.equal(
      (await f.request("DELETE", `/api/keys/${key.id}`, {}, b.cookie))
        .statusCode,
      404,
    );
    await f.request("DELETE", `/api/keys/${read.id}`, {}, a.cookie);
    await assert.rejects(reader.listTools());
    await assert.rejects(connect("invalid"));
    assert.equal(
      (
        await server.inject({
          method: "GET",
          url: "/mcp",
          headers: { host: `127.0.0.1:${port}` },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/mcp?x=1",
          headers: { host: "evil.test", authorization: `Bearer ${key.token}` },
          payload: {},
        })
      ).statusCode,
      403,
    );
    const removed = await writer.callTool({
      name: "delete_resource",
      arguments: { id: saved.id },
    });
    assert.equal(data(removed).deleted, true);
  } finally {
    for (const client of clients) await client.close();
    if (server) await server.close();
    await f.close();
  }
});

test("Mixed-item MCP sharing, editing conflicts, lifecycle and read-only boundaries", async () => {
  const f = await fixture(); let server: any; const clients: Client[] = [];
  try {
    const a = await f.signup(), b = await f.signup();
    await f.request("POST", "/api/auth/verify", { token: f.token("verify", a.email) });
    const tokens = [];
    for (const scope of ["write", "write", "read"]) tokens.push((await f.request("POST", "/api/keys", { name: `Agent ${tokens.length}`, scope }, a.cookie)).json().token);
    const port = await freePort(), endpoint = `http://127.0.0.1:${port}`;
    server = await createApp(f.db, { publicApiUrl: endpoint, mailer: { async send() {} } });
    await server.listen({ port, host: "127.0.0.1" });
    for (const token of tokens) {
      const client = new Client({ name: "items-test", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })); clients.push(client);
    }
    const [writer, other, reader] = clients;
    const tools = (await reader.listTools()).tools.map(t => t.name);
    assert.ok(tools.includes("get_item")); assert.ok(!tools.includes("update_item"));
    const idea = data(await writer.callTool({ name: "save_item", arguments: { kind: "idea", body: "A shared research idea", notes: "Original thought" } })).item;
    assert.equal(data(await other.callTool({ name: "get_item", arguments: { id: idea.id } })).body, "A shared research idea");
    const updated = data(await other.callTool({ name: "update_item", arguments: { id: idea.id, revision: idea.revision, body: "Developed across agents" } }));
    assert.equal(updated.body, "Developed across agents");
    assert.ok((await writer.callTool({ name: "update_item", arguments: { id: idea.id, revision: idea.revision, body: "Stale overwrite" } })).isError);
    assert.equal(data(await reader.callTool({ name: "search_items", arguments: { q: "developed" } })).total, 1);
    assert.equal(data(await reader.callTool({ name: "list_resources", arguments: {} })).total, 0);
    const foreign = (await f.request("POST", "/api/items", { kind: "note", body: "Private foreign account" }, b.cookie)).json().item;
    assert.ok((await reader.callTool({ name: "get_item", arguments: { id: foreign.id } })).isError);
    await writer.callTool({ name: "archive_item", arguments: { id: idea.id, archived: true } });
    assert.equal(data(await reader.callTool({ name: "list_items", arguments: {} })).total, 0);
    assert.equal(data(await reader.callTool({ name: "list_items", arguments: { location: "archive" } })).total, 1);
    await writer.callTool({ name: "trash_item", arguments: { id: idea.id } });
    assert.ok((await reader.callTool({ name: "get_item", arguments: { id: idea.id } })).isError);
    await writer.callTool({ name: "restore_item", arguments: { id: idea.id } });
    assert.equal(data(await reader.callTool({ name: "get_item", arguments: { id: idea.id } })).body, "Developed across agents");
    assert.ok((await reader.callTool({ name: "save_item", arguments: { kind: "note", body: "Not allowed" } })).isError);
  } finally { for (const client of clients) await client.close(); if (server) await server.close(); await f.close(); }
});


test("PDF MCP reads are bounded and retain account and Trash checks", async () => {
  const f = await fixture(); let server: Awaited<ReturnType<typeof createApp>> | undefined;
  const clients: Client[] = [];
  try {
    const a = await f.signup(), b = await f.signup();
    for (const account of [a, b]) await f.request("POST", "/api/auth/verify", { token: f.token("verify", account.email) });
    const inserted = await f.db.execute(sql`insert into resources(user_id,kind,title,url) values(${a.user.id},'pdf','Synthetic PDF',null) returning id`);
    const id = String(inserted.rows[0].id);
    await f.db.execute(sql`insert into attachments(user_id,resource_id,storage_key,filename,byte_size,state,pages,page_count,upload_expires_at)
      values(${a.user.id},${id},${a.user.id+"/"+id+".pdf"},'Synthetic.pdf',100,'ready',${JSON.stringify(Array.from({length:6},(_,i)=>({page:i+1,text:"Reference ".repeat(5000)})))}::jsonb,6,now())`);
    const port = await freePort(), endpoint = `http://127.0.0.1:${port}`;
    server = await createApp(f.db, { publicApiUrl: endpoint, mailer: { async send() {} } });
    await server.listen({ port, host: "127.0.0.1" });
    async function reader(cookie: string) {
      const key = (await f.request("POST", "/api/keys", { name: "PDF reader", scope: "read" }, cookie)).json();
      const client = new Client({ name: "pdf-reader-test", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key.token}` } } }));
      clients.push(client); return client;
    }
    const own = await reader(a.cookie), foreign = await reader(b.cookie);
    assert.ok((await own.listTools()).tools.some(t=>t.name==="read_pdf"));
    const first = data(await own.callTool({ name: "read_pdf", arguments: { id } }));
    assert.equal(first.pages.length, 5); assert.equal(first.pages.reduce((n:number,p:{text:string})=>n+p.text.length,0),30000);
    assert.ok(first.pages[0].truncated);
    assert.equal(data(await own.callTool({ name: "read_pdf", arguments: { id, from: 6 } })).pages[0].page, 6);
    assert.ok((await foreign.callTool({ name: "read_pdf", arguments: { id } })).isError);
    await f.request("POST", `/api/items/${id}/lifecycle`, { action: "trash" }, a.cookie);
    assert.ok((await own.callTool({ name: "read_pdf", arguments: { id } })).isError);
  } finally { for(const client of clients) await client.close(); if(server)await server.close(); await f.close(); }
});

test("MCP summaries require write scope, deduplicate across clients and retain account isolation",async()=>{
 const f=await fixture(),clients:Client[]=[];let server:Awaited<ReturnType<typeof createApp>>|undefined,calls=0;
 try{
  const a=await f.signup(),b=await f.signup();for(const account of[a,b])await f.request("POST","/api/auth/verify",{token:f.token("verify",account.email)});
  const keys=[];for(const[scope,cookie]of[["write",a.cookie],["read",a.cookie],["read",b.cookie]]as const)keys.push((await f.request("POST","/api/keys",{name:"Summary test",scope},cookie)).json());
  const added=await f.db.execute(sql`insert into resources(user_id,kind,title,url,notes) values(${a.user.id},'pdf','Synthetic summary source',null,'Private notes stay separate') returning id`),id=String(added.rows[0].id);
  const text="Researchers tested twelve filters over six weeks. Paper filters removed more sediment.";
  await f.db.execute(sql`insert into attachments(user_id,resource_id,storage_key,filename,byte_size,state,pages,page_count,upload_expires_at) values(${a.user.id},${id},${a.user.id+'/'+id+'.pdf'},'Synthetic.pdf',100,'ready',${JSON.stringify([{page:1,text}])}::jsonb,1,now())`);
  const port=await freePort(),endpoint=`http://127.0.0.1:${port}`;
  server=await createApp(f.db,{publicApiUrl:endpoint,mailer:{async send(){}},summaryProvider:{model:"verification/provider:free",async preflight(){},async generate(){calls++;return{model:"verification/provider:free",tokens:200,cost:0,result:{overview:{text:"The trial compared filters over six weeks.",sourceIds:["s1"],quote:"Researchers tested twelve filters over six weeks."},points:[{text:"Paper filters removed more sediment.",sourceIds:["s1"],quote:"Paper filters removed more sediment."}]}};}}});
  await server.listen({port,host:"127.0.0.1"});
  for(const key of keys){const client=new Client({name:"summary-test",version:"1"});await client.connect(new StreamableHTTPClientTransport(new URL(`${endpoint}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${key.token}`}}}));clients.push(client);}
  const[writer,reader,foreign]=clients;
  assert.ok((await writer.listTools()).tools.some(t=>t.name==="summarise_item"));assert.ok(!(await reader.listTools()).tools.some(t=>t.name==="summarise_item"));
  assert.ok((await reader.callTool({name:"summarise_item",arguments:{id,revision:1,requestId:crypto.randomUUID()}})).isError);
  const identity=crypto.randomUUID(),first=data(await writer.callTool({name:"summarise_item",arguments:{id,revision:1,requestId:identity}}));
  const alias=crypto.randomUUID(),second=data(await writer.callTool({name:"summarise_item",arguments:{id,revision:1,requestId:alias}}));assert.equal(first.id,second.id);
  const deadline=Date.now()+15000;let status;
  do{status=data(await reader.callTool({name:"get_summary",arguments:{id}}));if(status.saved)break;await new Promise(r=>setTimeout(r,300));}while(Date.now()<deadline);
  assert.equal(status.job.state,"succeeded");assert.equal(calls,1);assert.ok(status.saved);assert.equal(status.saved.sources[0].page,1);
  assert.equal(data(await writer.callTool({name:"summarise_item",arguments:{id,revision:1,requestId:alias}})).state,"succeeded");assert.equal(calls,1);
  assert.ok((await foreign.callTool({name:"get_summary",arguments:{id}})).isError);
  assert.equal((await f.db.execute(sql`select key_id from item_jobs where id=${first.id}`)).rows[0].key_id,keys[0].id);
  await writer.callTool({name:"summarise_item",arguments:{id,revision:1,requestId:crypto.randomUUID()}});
  await writer.callTool({name:"cancel_summary",arguments:{id}});
  const cancelled=data(await reader.callTool({name:"get_summary",arguments:{id}}));assert.equal(cancelled.job.state,"cancelled");assert.ok(cancelled.saved);
 }finally{for(const client of clients)await client.close();if(server)await server.close();await f.close();}
});
