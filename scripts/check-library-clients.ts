import { fixture } from "../tests/helpers.js";
import { createApp } from "../apps/server/src/app.js";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
const clientDirectory = await mkdtemp("/tmp/stash-native-");
const f = await fixture();
const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = (reservation.address() as any).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const endpoint = `http://127.0.0.1:${port}`;
const app = await createApp(f.db, {
  publicApiUrl: endpoint,
  mailer: { async send() {} },
});
await app.listen({ port, host: "127.0.0.1" });
async function run(
  command: string,
  args: string[],
  token: string,
  extraEnv: Record<string, string> = {},
) {
  return new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        env: { ...process.env, STASH_AGENT_KEY: token, ...extraEnv },
        cwd: clientDirectory,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, 120000);
      child.stdout.on("data", (bytes) => (output += bytes.toString()));
      child.stderr.on("data", (bytes) => (output += bytes.toString()));
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, output: output.split(token).join("[REDACTED]") });
      });
    },
  );
}
try {
  const u = await f.signup("client-acceptance@example.test");
  await f.request("POST", "/api/auth/verify", {
    token: f.token("verify", u.email),
  });
  const writer = (
      await f.request(
        "POST",
        "/api/keys",
        { name: "Codex acceptance", scope: "write" },
        u.cookie,
      )
    ).json(),
    reader = (
      await f.request(
        "POST",
        "/api/keys",
        { name: "OpenCode acceptance", scope: "read" },
        u.cookie,
      )
    ).json();
  await mkdir(".data/client-check", { recursive: true });
  const codex = await run(
    "codex",
    [
      "exec",
      "--ignore-user-config",
      "--skip-git-repo-check",
      "--ephemeral",
      "--json",
      "--sandbox",
      "read-only",
      "-c",
      'approval_policy="never"',
      "-c",
      'mcp_servers.stash.tools.save_item.approval_mode="approve"',
      "-c",
      `mcp_servers.stash.url="${endpoint}/mcp"`,
      "-c",
      'mcp_servers.stash.bearer_token_env_var="STASH_AGENT_KEY"',
      'Use only the Stash MCP tools. Save a standalone idea with title "Cross-agent idea" and body "Acceptance marker STASH-MIXED-NATIVE-20261015. A quiet reading list for research." Use save_item with kind idea and no URL. Do not use shell or other tools. Report the saved item ID.', 
    ],
    writer.token,
  );
  await writeFile(".data/client-check/codex-v2-private.txt", codex.output);
  console.log(`Codex exited ${codex.code}.`);
  const opencode = await run(
    "opencode",
    [
      "run",
      "--pure",
      "--format",
      "json",
      'Use only the Stash MCP tools to find the standalone idea titled "Cross-agent idea" with list_items. Omit unused filters or pass null; never invent project or collection IDs. Retrieve its complete body with get_item and report it. Do not read files or use any other tools.',
    ],
    reader.token,
    {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        mcp: {
          stash: {
            type: "remote",
            url: `${endpoint}/mcp`,
            oauth: false,
            headers: { Authorization: "Bearer {env:STASH_AGENT_KEY}" },
          },
        },
        permission: { "*": "deny", "stash*": "allow" },
      }),
    },
  );
  await writeFile(".data/client-check/opencode-v2-private.txt", opencode.output);
  console.log(`OpenCode exited ${opencode.code}.`);
  const records = (
    await f.request("GET", "/api/items", undefined, u.cookie)
  ).json();
  const found = records.items.find((row: any) =>
    row.body.includes("STASH-MIXED-NATIVE-20261015"),
  );
  const profile = (
    await f.request("GET", "/api/me", undefined, u.cookie)
  ).json().user;
  const inbox = (
    await f.request("GET", "/api/collections", undefined, u.cookie)
  )
    .json()
    .items.find((c: any) => c.name === "Inbox");
  const passed =
    codex.code === 0 &&
    opencode.code === 0 &&
    !!found &&
    found.title === "Cross-agent idea" &&
    found.kind === "idea" && !found.url &&
    opencode.output.includes("STASH-MIXED-NATIVE-20261015") &&
    profile.onboarding.retrieved;
  await f.request("DELETE", `/api/keys/${reader.id}`, {}, u.cookie);
  const revoked = await fetch(`${endpoint}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${reader.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
  const report = {
    passed: passed && revoked.status === 401,
    clientVersions: {
      codex: spawnSync("codex", ["--version"], {
        encoding: "utf8",
      }).stdout.trim(),
      opencode: spawnSync("opencode", ["--version"], {
        encoding: "utf8",
      }).stdout.trim(),
    },
    codexExit: codex.code,
    opencodeExit: opencode.code,
    resourceSaved: !!found,
    retrieved: profile.onboarding.retrieved,
    revokedStatus: revoked.status,
  };
  await writeFile(
    "docs/evidence/library-v2/native-client-acceptance.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report);
  if (!report.passed) process.exitCode = 1;
} finally {
  await app.close();
  await f.close();
  await rm(clientDirectory, { recursive: true, force: true });
}
