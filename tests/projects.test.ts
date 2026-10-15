import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers.js";

test("Projects isolate research, URLs and long documents with owned archive and append rules", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(),
      b = await f.signup();
    const created = await f.request(
      "POST",
      "/api/projects",
      {
        name: "Stash research",
        repositoryUrl: "https://github.com/example/stash",
      },
      a.cookie,
    );
    assert.equal(created.statusCode, 200, created.body);
    const p = created.json().project;
    assert.equal(
      (await f.request("GET", `/api/projects/${p.id}`, undefined, b.cookie))
        .statusCode,
      404,
    );
    const save = (body: unknown, cookie = a.cookie) =>
      f.request("POST", "/api/items", body, cookie);
    const research = await save({
      kind: "note",
      title: "Working research",
      body: "Findings ".repeat(12000),
      projectId: p.id,
    });
    assert.equal(research.statusCode, 200, research.body);
    const item = research.json().item;
    assert.equal(
      (await save({ kind: "note", body: "x".repeat(50001) })).statusCode,
      400,
    );
    assert.equal(
      (await save({ kind: "note", body: "Private", projectId: p.id }, b.cookie))
        .statusCode,
      404,
    );
    for (const projectId of [undefined, p.id])
      assert.equal(
        (
          await save({
            kind: "link",
            title: "Same source",
            url: "https://example.test/same",
            projectId,
          })
        ).statusCode,
        200,
      );
    assert.equal(
      (await f.request("GET", "/api/items", undefined, a.cookie)).json().total,
      1,
    );
    assert.equal(
      (await f.request("GET", "/api/resources", undefined, a.cookie)).json()
        .total,
      1,
    );
    assert.equal(
      (
        await f.request(
          "GET",
          `/api/items?projectId=${p.id}`,
          undefined,
          a.cookie,
        )
      ).json().total,
      2,
    );
    assert.equal(
      (
        await f.request("GET", "/api/items?q=Findings", undefined, a.cookie)
      ).json().total,
      0,
    );
    assert.equal(
      (
        await f.request(
          "GET",
          "/api/items?q=Findings&includeProjects=true",
          undefined,
          a.cookie,
        )
      ).json().total,
      1,
    );
    const append = {
      revision: item.revision,
      requestId: randomUUID(),
      body: "A useful next finding",
    };
    const responses = await Promise.all(
      [1, 2].map(() =>
        f.request("POST", `/api/items/${item.id}/append`, append, a.cookie),
      ),
    );
    for (const r of responses) assert.equal(r.statusCode, 200, r.body);
    let full = (
      await f.request("GET", `/api/items/${item.id}`, undefined, a.cookie)
    ).json().item;
    assert.equal(full.body.split("A useful next finding").length, 2);
    assert.equal(full.revision, 2);
    assert.equal(
      (
        await f.request(
          "POST",
          `/api/items/${item.id}/append`,
          { ...append, requestId: randomUUID() },
          a.cookie,
        )
      ).statusCode,
      409,
    );
    const history = await f.request(
      "GET",
      `/api/items/${item.id}/history`,
      undefined,
      a.cookie,
    );
    assert.equal(history.json().items.length, 1);
    assert.equal(
      (
        await f.request(
          "GET",
          `/api/items/${item.id}/history?revision=1`,
          undefined,
          b.cookie,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.request(
          "POST",
          `/api/items/${item.id}/promote`,
          { requestId: randomUUID() },
          a.cookie,
        )
      ).statusCode,
      400,
    );
    const promoted = await f.request(
      "POST",
      `/api/items/${item.id}/promote`,
      { requestId: randomUUID(), body: "A settled finding" },
      a.cookie,
    );
    assert.equal(promoted.statusCode, 200, promoted.body);
    assert.equal(promoted.json().item.projectId, null);
    assert.equal(promoted.json().item.projectSourceId, item.id);
    const archived = await f.request(
      "PATCH",
      `/api/projects/${p.id}`,
      { revision: p.revision, archived: true },
      a.cookie,
    );
    assert.equal(archived.statusCode, 200, archived.body);
    assert.equal(
      (await save({ kind: "idea", body: "Later", projectId: p.id })).statusCode,
      409,
    );
    assert.equal(
      (
        await f.request(
          "PATCH",
          `/api/items/${item.id}`,
          { revision: full.revision, body: "Overwrite" },
          a.cookie,
        )
      ).statusCode,
      409,
    );
    assert.equal(
      (await f.request("GET", `/api/items/${item.id}`, undefined, a.cookie))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await f.request(
          "PATCH",
          `/api/projects/${p.id}`,
          { revision: 1, name: "Stale" },
          a.cookie,
        )
      ).statusCode,
      409,
    );
  } finally {
    await f.close();
  }
});

test("Project account exports round-trip scope, history and archive state without leaking foreign projects", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(),
      b = await f.signup();
    const p = (
      await f.request(
        "POST",
        "/api/projects",
        { name: "Research archive" },
        a.cookie,
      )
    ).json().project;
    const item = (
      await f.request(
        "POST",
        "/api/items",
        {
          kind: "idea",
          title: "Research",
          body: "Initial exploration",
          projectId: p.id,
        },
        a.cookie,
      )
    ).json().item;
    await f.request(
      "PATCH",
      `/api/items/${item.id}`,
      { revision: 1, body: "Developed findings" },
      a.cookie,
    );
    await f.request(
      "PATCH",
      `/api/projects/${p.id}`,
      { revision: 1, archived: true },
      a.cookie,
    );
    const exported = (
      await f.request("GET", "/api/items/export", undefined, a.cookie)
    ).json();
    assert.equal(exported.projects.length, 1);
    assert.equal(exported.items[0].history.length, 1);
    const input = { format: "json", content: JSON.stringify(exported) };
    const imported = await f.request(
      "POST",
      "/api/items/import",
      input,
      b.cookie,
    );
    assert.equal(imported.statusCode, 200, imported.body);
    assert.equal(imported.json().saved, 1, imported.body);
    assert.equal(
      (await f.request("GET", "/api/items", undefined, b.cookie)).json().total,
      0,
    );
    const projects = (
      await f.request("GET", "/api/projects?archived=true", undefined, b.cookie)
    ).json().items;
    assert.equal(projects.length, 1);
    assert.notEqual(projects[0].id, p.id);
    const restored = (
      await f.request(
        "GET",
        `/api/items?projectId=${projects[0].id}`,
        undefined,
        b.cookie,
      )
    ).json().items[0];
    assert.equal(restored.body, "Developed findings");
    assert.equal(
      (
        await f.request(
          "GET",
          `/api/items/${restored.id}/history`,
          undefined,
          b.cookie,
        )
      ).json().items.length,
      1,
    );
    assert.equal(
      (await f.request("POST", "/api/items/import", input, b.cookie)).json()
        .duplicates,
      1,
    );
    const broken = { ...exported, projects: [] };
    const rejected = await f.request(
      "POST",
      "/api/items/import",
      { format: "json", content: JSON.stringify(broken) },
      b.cookie,
    );
    assert.equal(rejected.json().rejected.length, 1);
    assert.equal(
      (await f.request("GET", "/api/items", undefined, b.cookie)).json().total,
      0,
    );
    const deletion = await f.request(
      "DELETE",
      "/api/me",
      { password: "correct horse battery staple", confirmation: "DELETE" },
      b.cookie,
    );
    assert.equal(deletion.statusCode, 200, deletion.body);
  } finally {
    await f.close();
  }
});

test("Project MCP supports bounded research reads and write-scoped, retry-safe appends", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js"),
    { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    ),
    { createServer } = await import("node:net"),
    { once } = await import("node:events"),
    { createApp } = await import("../apps/server/src/app.js");
  const f = await fixture();
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  const clients: InstanceType<typeof Client>[] = [];
  const data = (r: any) => JSON.parse(r.content[0].text).data;
  try {
    const a = await f.signup(),
      b = await f.signup();
    for (const u of [a, b])
      await f.request("POST", "/api/auth/verify", {
        token: f.token("verify", u.email),
      });
    const socket = createServer().listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = (socket.address() as any).port;
    await new Promise<void>((r) => socket.close(() => r()));
    app = await createApp(f.db, {
      publicApiUrl: `http://127.0.0.1:${port}`,
      mailer: { async send() {} },
    });
    await app.listen({ port, host: "127.0.0.1" });
    async function connect(cookie: string, scope: string) {
      const key = (
        await f.request(
          "POST",
          "/api/keys",
          { name: "Research agent", scope },
          cookie,
        )
      ).json();
      const client = new Client({ name: "project-sdk", version: "1" });
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${port}/mcp`),
          {
            requestInit: { headers: { Authorization: `Bearer ${key.token}` } },
          },
        ),
      );
      clients.push(client);
      return client;
    }
    const writer = await connect(a.cookie, "write"),
      reader = await connect(a.cookie, "read"),
      foreign = await connect(b.cookie, "read");
    const p = data(
      await writer.callTool({
        name: "create_project",
        arguments: { name: "Agent research" },
      }),
    );
    assert.ok(
      !(await reader.listTools()).tools.some(
        (t) => t.name === "create_project",
      ),
    );
    assert.equal(
      data(await foreign.callTool({ name: "list_projects", arguments: {} }))
        .items.length,
      0,
    );
    const item = data(
      await writer.callTool({
        name: "save_item",
        arguments: {
          projectId: p.id,
          kind: "note",
          body: "Research ".repeat(8000),
          title: "Large research",
        },
      }),
    ).item;
    assert.equal(
      data(await reader.callTool({ name: "list_items", arguments: {} })).total,
      0,
    );
    assert.equal(
      data(
        await reader.callTool({
          name: "list_items",
          arguments: { projectId: p.id },
        }),
      ).total,
      1,
    );
    const first = data(
      await reader.callTool({
        name: "read_project_document",
        arguments: { id: item.id },
      }),
    );
    assert.equal(first.body.length, 30000);
    assert.equal(first.nextOffset, 30000);
    assert.ok(
      (
        await foreign.callTool({
          name: "read_project_document",
          arguments: { id: item.id },
        })
      ).isError,
    );
    const append = {
      id: item.id,
      revision: 1,
      requestId: randomUUID(),
      body: "A final source-backed finding.",
    };
    assert.ok(
      !(
        await writer.callTool({
          name: "append_project_document",
          arguments: append,
        })
      ).isError,
    );
    assert.ok(
      !(
        await writer.callTool({
          name: "append_project_document",
          arguments: append,
        })
      ).isError,
    );
    const full = (
      await f.request("GET", `/api/items/${item.id}`, undefined, a.cookie)
    ).json().item;
    assert.equal(full.revision, 2);
    assert.equal(full.body.split("A final source-backed finding.").length, 2);
    assert.equal(
      data(
        await reader.callTool({ name: "get_item", arguments: { id: item.id } }),
      ).body.length,
      50000,
    );
    assert.ok(
      (
        await reader.callTool({
          name: "append_project_document",
          arguments: { ...append, requestId: randomUUID(), revision: 2 },
        })
      ).isError,
    );
  } finally {
    for (const client of clients) await client.close();
    if (app) await app.close();
    await f.close();
  }
});

test("Project document history retains 20 revisions and rejects unsafe repository URLs", async () => {
  const f = await fixture();
  try {
    const a = await f.signup();
    assert.equal(
      (
        await f.request(
          "POST",
          "/api/projects",
          { name: "Unsafe", repositoryUrl: "javascript:alert(1)" },
          a.cookie,
        )
      ).statusCode,
      400,
    );
    const p = (
      await f.request(
        "POST",
        "/api/projects",
        { name: "Revision research" },
        a.cookie,
      )
    ).json().project;
    const item = (
      await f.request(
        "POST",
        "/api/items",
        { kind: "note", body: "Revision 1", projectId: p.id },
        a.cookie,
      )
    ).json().item;
    for (let revision = 1; revision <= 22; revision++) {
      const r = await f.request(
        "PATCH",
        `/api/items/${item.id}`,
        { revision, body: `Revision ${revision + 1}` },
        a.cookie,
      );
      assert.equal(r.statusCode, 200, r.body);
    }
    const history = (
      await f.request(
        "GET",
        `/api/items/${item.id}/history`,
        undefined,
        a.cookie,
      )
    ).json().items;
    assert.equal(history.length, 20);
    assert.equal(history[0].revision, 22);
    assert.equal(history.at(-1).revision, 3);
    assert.equal(
      (
        await f.request(
          "GET",
          `/api/items/${item.id}/history?revision=1`,
          undefined,
          a.cookie,
        )
      ).statusCode,
      404,
    );
  } finally {
    await f.close();
  }
});

test("PDF capture stays inside its project and an archive during upload prevents finalisation", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path"),
    { localFileStore } = await import("../apps/server/src/file-store.js"),
    { pdf } = await import("./pdf-fixture.js"),
    { sql } = await import("drizzle-orm");
  const dir = await mkdtemp(join(tmpdir(), "stash-project-pdf-")),
    local = localFileStore(dir);
  let pause = false,
    release: () => void = () => {},
    reached: () => void = () => {};
  const waiting = new Promise<void>((r) => {
      release = r;
    }),
    started = new Promise<void>((r) => {
      reached = r;
    });
  const f = await fixture({
    fileStore: {
      ...local,
      async put(key, content) {
        await local.put(key, content);
        if (pause) {
          reached();
          await waiting;
        }
      },
    },
  });
  try {
    const a = await f.signup(),
      p = (
        await f.request(
          "POST",
          "/api/projects",
          { name: "PDF research" },
          a.cookie,
        )
      ).json().project,
      content = pdf();
    async function ticket(filename: string) {
      const r = await f.request(
        "POST",
        "/api/items/uploads",
        { projectId: p.id, filename, byteSize: content.length },
        a.cookie,
      );
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    }
    const first = await ticket("Source.pdf");
    const saved = await f.request(
      "POST",
      `/uploads/${first.id}`,
      content,
      undefined,
      {
        authorization: `Bearer ${first.token}`,
        "content-type": "application/pdf",
      },
    );
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().item.projectId, p.id);
    assert.equal(
      (await f.request("GET", "/api/items", undefined, a.cookie)).json().total,
      0,
    );
    pause = true;
    const second = await ticket("Late source.pdf");
    const upload = f.request(
      "POST",
      `/uploads/${second.id}`,
      content,
      undefined,
      {
        authorization: `Bearer ${second.token}`,
        "content-type": "application/pdf",
      },
    );
    await started;
    const archived = await f.request(
      "PATCH",
      `/api/projects/${p.id}`,
      { revision: p.revision, archived: true },
      a.cookie,
    );
    assert.equal(archived.statusCode, 200, archived.body);
    release();
    assert.equal((await upload).statusCode, 409);
    assert.equal(
      (
        await f.db.execute(
          sql`select id from attachments where id=${second.id}`,
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await f.db.execute(sql`select id from blob_cleanup`)).rows.length,
      1,
    );
  } finally {
    release();
    await f.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Project text quota includes archived research and retained history", async () => {
  const { sql } = await import("drizzle-orm");
  const f = await fixture();
  try {
    const a = await f.signup();
    const p = (await f.request("POST", "/api/projects", { name: "Quota research" }, a.cookie)).json().project;
    const seeded = await f.db.execute(sql`insert into resources(user_id,project_id,kind,title,body,revision,archived_at) select ${a.user.id},${p.id},'note','Synthetic quota fixture',repeat('x',500000),2,now() from generate_series(1,208) returning id`);
    await f.db.execute(sql`insert into project_item_history(user_id,resource_id,revision,body,actor) values(${a.user.id},${seeded.rows[0].id},1,repeat('y',500000),'synthetic')`);
    const denied = await f.request("POST", "/api/items", { kind: "note", projectId: p.id, body: "z".repeat(500000) }, a.cookie);
    assert.equal(denied.statusCode, 409, denied.body);
    const allowed = await f.request("POST", "/api/items", { kind: "note", projectId: p.id, body: "A small remaining note" }, a.cookie);
    assert.equal(allowed.statusCode, 200, allowed.body);
  } finally { await f.close(); }
});
