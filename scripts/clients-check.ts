import { fixture } from "../tests/helpers.js";
import { createApp } from "../apps/server/src/app.js";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

const f = await fixture();
const title = `Stash cross-agent Todo ${randomUUID()}`;
const marker = `STASH-CROSS-AGENT-${randomUUID()}`;
const requestId = randomUUID();
const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const endpoint = `http://127.0.0.1:${port}`;
const app = await createApp(f.db, {
  publicApiUrl: endpoint,
  mailer: { async send() {} },
});
await app.listen({ port, host: "127.0.0.1" });
async function run(command: string, args: string[], token: string, extraEnv: Record<string, string> = {}) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, STASH_AGENT_KEY: token, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
    child.stdout.on("data", (bytes) => (output += bytes.toString()));
    child.stderr.on("data", (bytes) => (output += bytes.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output: output.split(token).join("[REDACTED]") });
    });
  });
}
try {
  const user = await f.signup("todo-client-acceptance@example.test");
  await f.request("POST", "/api/auth/verify", { token: f.token("verify", user.email) });
  const writer = (await f.request("POST", "/api/keys", { name: "Codex Todo acceptance", scope: "write" }, user.cookie)).json();
  const reader = (await f.request("POST", "/api/keys", { name: "OpenCode Todo acceptance", scope: "read" }, user.cookie)).json();

  const codex = await run("codex", [
    "exec", "--ignore-user-config", "--ephemeral", "--json", "--sandbox", "read-only",
    "-c", 'approval_policy="never"',
    "-c", 'mcp_servers.stash.tools.create_todo.approval_mode="approve"',
    "-c", `mcp_servers.stash.url="${endpoint}/mcp"`,
    "-c", 'mcp_servers.stash.bearer_token_env_var="STASH_AGENT_KEY"',
    `Use only the Stash MCP tool create_todo. Create one personal Todo with exactly this title: ${title}. Set the description to exactly: ${marker}. Use priority normal, no dates, and requestId ${requestId}. Do not use shell or any other tool. Report the created task ID and title.`,
  ], writer.token);
  if (codex.code !== 0) throw new Error(`Codex exited ${codex.code}: ${codex.output.slice(-1000)}`);

  const list = (await f.request("GET", `/api/todos?view=all&q=${encodeURIComponent(title)}`, undefined, user.cookie)).json().items;
  const todo = list.find((row: { title: string }) => row.title === title);
  if (!todo) throw new Error("Codex did not create the expected Todo through MCP.");
  const stored = (await f.request("GET", `/api/todos/${todo.id}`, undefined, user.cookie)).json().todo;
  if (stored.description !== marker) throw new Error("Codex Todo description did not persist.");

  const opencode = await run("opencode", [
    "run", "--standalone", "--format", "json", "--model", "openrouter/nvidia/nemotron-3.5-lightning:free",
    `Use only Stash MCP tools. Find the Todo with the exact title ${JSON.stringify(title)}, retrieve its full details, and report its title and description verbatim. Do not use any other tool.`,
  ], reader.token, {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      mcp: { stash: { type: "remote", url: `${endpoint}/mcp`, oauth: false, headers: { Authorization: "Bearer {env:STASH_AGENT_KEY}" } } },
      permission: { "*": "deny", "stash*": "allow" },
    }),
  });
  if (opencode.code !== 0) throw new Error(`OpenCode exited ${opencode.code}: ${opencode.output.slice(-1000)}`);
  if (!opencode.output.includes(title) || !opencode.output.includes(marker)) throw new Error("OpenCode did not report the Todo returned by MCP.");

  const profile = (await f.request("GET", "/api/me", undefined, user.cookie)).json().user;
  await f.request("DELETE", `/api/keys/${reader.id}`, {}, user.cookie);
  const revoked = await fetch(`${endpoint}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${reader.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const report = {
    passed: revoked.status === 401 && !!profile.onboarding.retrieved,
    clients: { writer: "Codex", reader: "OpenCode" },
    versions: {
      codex: spawnSync("codex", ["--version"], { encoding: "utf8" }).stdout.trim(),
      opencode: spawnSync("opencode", ["--version"], { encoding: "utf8" }).stdout.trim(),
    },
    todoCreated: true,
    todoRetrieved: true,
    readerKeyRevoked: revoked.status === 401,
    openCodeModel: "openrouter/nvidia/nemotron-3.5-lightning:free",
  };
  if (!report.passed) throw new Error("Cross-client Todo verification or reader-key revocation failed.");
  await mkdir("docs/evidence/todos", { recursive: true });
  await writeFile("docs/evidence/todos/native-clients.json", JSON.stringify(report, null, 2));
  console.log(report);
} finally {
  await app.close();
  await f.close();
}
