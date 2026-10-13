import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { apiKeys } from "@stash/db";
import { fixture } from "./helpers.js";
const resource = "http://127.0.0.1:4000/mcp";
const verifier = () => randomBytes(32).toString("base64url");
const challenge = (v: string) =>
  createHash("sha256").update(v).digest("base64url");
async function setup(f: Awaited<ReturnType<typeof fixture>>) {
  const user = await f.signup();
  await f.request("POST", "/api/auth/verify", {
    token: f.token("verify", user.email),
  });
  const registered = await f.request("POST", "/oauth/register", {
    client_name: "OAuth test",
    redirect_uris: ["https://client.example/callback"],
    token_endpoint_auth_method: "none",
  });
  assert.equal(registered.statusCode, 201);
  return { ...user, client: registered.json().client_id };
}
async function grant(
  f: Awaited<ReturnType<typeof fixture>>,
  u: Awaited<ReturnType<typeof setup>>,
  write = false,
  expectedName = "OAuth test",
) {
  const v = verifier();
  const params = {
    response_type: "code",
    client_id: u.client,
    redirect_uri: "https://client.example/callback",
    resource,
    scope: write ? "stash:read stash:write" : "stash:read",
    state: "state-to-preserve",
    code_challenge: challenge(v),
    code_challenge_method: "S256",
  };
  const start = await f.request(
    "GET",
    `/oauth/authorize?${new URLSearchParams(params)}`,
  );
  assert.equal(start.statusCode, 302, start.body);
  const nonce = new URL(start.headers.location!).searchParams.get("request")!;
  const info = await f.request(
    "GET",
    `/api/oauth/requests/${nonce}`,
    undefined,
    u.cookie,
  );
  assert.equal(info.json().clientName, expectedName);
  const consent = await f.request(
    "POST",
    `/api/oauth/requests/${nonce}`,
    { approve: true, write },
    u.cookie,
  );
  assert.equal(consent.statusCode, 200, consent.body);
  const callback = new URL(consent.json().redirect);
  assert.equal(callback.searchParams.get("state"), params.state);
  assert.equal(callback.searchParams.get("iss"), "http://127.0.0.1:4000");
  const exchange = {
    grant_type: "authorization_code",
    client_id: u.client,
    redirect_uri: params.redirect_uri,
    resource,
    code_verifier: v,
    code: callback.searchParams.get("code")!,
  };
  return { exchange, nonce };
}
test("OAuth discovery, PKCE, consent, expiry, scope, rotation/reuse and both credential types", async () => {
  const f = await fixture();
  try {
    const u = await setup(f);
    const discovery = (
      await f.request("GET", "/.well-known/oauth-protected-resource/mcp")
    ).json();
    assert.equal(discovery.resource, resource);
    const missing = await f.request("POST", "/mcp", {}, undefined, {
      host: "127.0.0.1:4000",
    });
    assert.equal(missing.statusCode, 401);
    assert.match(
      String(missing.headers["www-authenticate"]),
      /resource_metadata/,
    );
    const { exchange } = await grant(f, u, true);
    const wrong = await f.request("POST", "/oauth/token", {
      ...exchange,
      code_verifier: verifier(),
    });
    assert.equal(wrong.json().error, "invalid_grant");
    const issued = await f.request("POST", "/oauth/token", exchange);
    assert.equal(issued.statusCode, 200, issued.body);
    const token = issued.json();
    assert.equal(token.scope, "stash:read stash:write");
    assert.equal(
      (await f.request("POST", "/oauth/token", exchange)).json().error,
      "invalid_grant",
    );
    const keys = (
      await f.request("GET", "/api/keys", undefined, u.cookie)
    ).json().items;
    assert.equal(keys[0].authentication, "oauth");
    const regular = (
      await f.request(
        "POST",
        "/api/keys",
        { name: "Manual", scope: "read" },
        u.cookie,
      )
    ).json();
    const call = (access: string) =>
      f.request(
        "POST",
        "/mcp",
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        undefined,
        {
          host: "127.0.0.1:4000",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${access}`,
        },
      );
    assert.equal((await call(regular.token)).statusCode, 200);
    const toolList = (await call(token.access_token)).json().result.tools;
    assert.ok(toolList.some((t: any) => t.name === "save_resource"));
    assert.deepEqual(toolList[0].securitySchemes, [
      { type: "oauth2", scopes: ["stash:read"] },
    ]);
    await f.db
      .update(apiKeys)
      .set({ oauthResource: "https://wrong.example/mcp" })
      .where(eq(apiKeys.id, keys[0].id));
    assert.equal((await call(token.access_token)).statusCode, 401);
    await f.db
      .update(apiKeys)
      .set({ oauthResource: resource })
      .where(eq(apiKeys.id, keys[0].id));
    await f.db
      .update(apiKeys)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(apiKeys.id, keys[0].id));
    assert.equal((await call(token.access_token)).statusCode, 401);
    const refreshed = await f.request("POST", "/oauth/token", {
      grant_type: "refresh_token",
      client_id: u.client,
      resource,
      refresh_token: token.refresh_token,
      scope: "stash:read",
    });
    assert.equal(refreshed.statusCode, 200, refreshed.body);
    assert.ok(
      !(await call(refreshed.json().access_token))
        .json()
        .result.tools.some((t: any) => t.name === "save_resource"),
    );
    const escalation = await f.request("POST", "/oauth/token", {
      grant_type: "refresh_token",
      client_id: u.client,
      resource,
      refresh_token: refreshed.json().refresh_token,
      scope: "stash:read stash:write",
    });
    assert.equal(escalation.json().error, "invalid_scope");
    const replay = await f.request("POST", "/oauth/token", {
      grant_type: "refresh_token",
      client_id: u.client,
      resource,
      refresh_token: token.refresh_token,
    });
    assert.equal(replay.json().error, "invalid_grant");
    assert.equal((await call(refreshed.json().access_token)).statusCode, 401);
    assert.equal((await call(regular.token)).statusCode, 200);
  } finally {
    await f.close();
  }
});
test("OAuth rejects redirect/resource/scope/CSRF attacks, binds consent to user, and revokes on reset", async () => {
  const f = await fixture();
  try {
    const u = await setup(f),
      other = await f.signup();
    await f.request("POST", "/api/auth/verify", {
      token: f.token("verify", other.email),
    });
    assert.equal(
      (
        await f.request("POST", "/oauth/register", {
          redirect_uris: ["https://safe.example/#fragment"],
        })
      ).statusCode,
      400,
    );
    const v = verifier(),
      p = {
        response_type: "code",
        client_id: u.client,
        redirect_uri: "https://evil.example/",
        resource,
        code_challenge: challenge(v),
        code_challenge_method: "S256",
      };
    assert.equal(
      (await f.request("GET", `/oauth/authorize?${new URLSearchParams(p)}`))
        .statusCode,
      400,
    );
    p.redirect_uri = "https://client.example/callback";
    p.resource = "https://another.example/mcp";
    assert.equal(
      (await f.request("GET", `/oauth/authorize?${new URLSearchParams(p)}`))
        .statusCode,
      400,
    );
    const { exchange, nonce } = await grant(f, u);
    assert.equal(
      (
        await f.request(
          "POST",
          `/api/oauth/requests/${nonce}`,
          { approve: true },
          other.cookie,
        )
      ).statusCode,
      400,
    );
    const issued = (await f.request("POST", "/oauth/token", exchange)).json();
    const pendingBeforeReset = await grant(f, u);
    await f.request("POST", "/api/auth/forgot", { email: u.email });
    await f.request("POST", "/api/auth/reset", {
      token: f.token("reset", u.email),
      password: "a new secure password",
    });
    assert.equal(
      (
        await f.request("POST", "/oauth/token", {
          grant_type: "refresh_token",
          client_id: u.client,
          resource,
          refresh_token: issued.refresh_token,
        })
      ).json().error,
      "invalid_grant",
    );
    assert.equal(
      (
        await f.request("POST", "/oauth/token", pendingBeforeReset.exchange)
      ).json().error,
      "invalid_grant",
    );
    assert.equal(
      (
        await f.request(
          "GET",
          "/api/oauth/requests/" + verifier(),
          undefined,
          other.cookie,
          { origin: "https://evil.example" },
        )
      ).statusCode,
      403,
    );
  } finally {
    await f.close();
  }
});
test("OAuth consent isolation/denial, racing code exchanges, revocation and refresh client binding", async () => {
  const f = await fixture();
  try {
    const u = await setup(f),
      other = await setup(f);
    const v = verifier();
    const params = {
      response_type: "code",
      client_id: u.client,
      redirect_uri: "https://client.example/callback",
      resource,
      scope: "stash:read stash:write",
      state: "denial-state",
      code_challenge: challenge(v),
      code_challenge_method: "S256",
    };
    const start = await f.request(
      "GET",
      `/oauth/authorize?${new URLSearchParams(params)}`,
    );
    const nonce = new URL(start.headers.location!).searchParams.get("request")!;
    const path = `/api/oauth/requests/${nonce}`;
    assert.equal(
      (await f.request("GET", path, undefined, u.cookie)).statusCode,
      200,
    );
    assert.equal(
      (await f.request("GET", path, undefined, other.cookie)).statusCode,
      400,
    );
    assert.equal(
      (
        await f.request("POST", path, { approve: true }, u.cookie, {
          origin: "https://evil.example",
        })
      ).statusCode,
      403,
    );
    const denied = await f.request("POST", path, { approve: false }, u.cookie);
    const callback = new URL(denied.json().redirect);
    assert.equal(callback.searchParams.get("error"), "access_denied");
    assert.equal(callback.searchParams.get("state"), "denial-state");
    assert.equal(callback.searchParams.has("code"), false);
    const { exchange } = await grant(f, u);
    const race = await Promise.all([
      f.request("POST", "/oauth/token", exchange),
      f.request("POST", "/oauth/token", exchange),
    ]);
    assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 400]);
    const issued = race.find((r) => r.statusCode === 200)!.json();
    assert.equal(
      (
        await f.request("POST", "/oauth/token", {
          grant_type: "refresh_token",
          client_id: other.client,
          resource,
          refresh_token: issued.refresh_token,
        })
      ).json().error,
      "invalid_grant",
    );
    const refresh = await f.request("POST", "/oauth/token", {
      grant_type: "refresh_token",
      client_id: u.client,
      resource,
      refresh_token: issued.refresh_token,
    });
    assert.equal(refresh.statusCode, 200);
    assert.equal(
      (
        await f.request("POST", "/oauth/revoke", {
          client_id: u.client,
          token: refresh.json().refresh_token,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.request("POST", "/oauth/token", {
          grant_type: "refresh_token",
          client_id: u.client,
          resource,
          refresh_token: refresh.json().refresh_token,
        })
      ).json().error,
      "invalid_grant",
    );
  } finally {
    await f.close();
  }
});

test("OAuth exchange racing a password reset cannot deadlock or leave a usable grant", async () => {
  const f = await fixture();
  const gate = await f.admin.connect();
  try {
    const u = await setup(f);
    const { exchange } = await grant(f, u, true);
    await f.request("POST", "/api/auth/forgot", { email: u.email });
    await gate.query("BEGIN");
    await gate.query(`SELECT id FROM "${f.schema}".users WHERE id=$1 FOR UPDATE`, [u.user.id]);
    const reset = f.request("POST", "/api/auth/reset", { token: f.token("reset", u.email), password: "reset while authorizing" });
    await new Promise(resolve => setTimeout(resolve, 1000));
    const token = f.request("POST", "/oauth/token", exchange);
    await new Promise(resolve => setTimeout(resolve, 100));
    await gate.query("COMMIT");
    const [resetResult, tokenResult] = await Promise.all([reset, token]);
    assert.equal(resetResult.statusCode, 200);
    assert.ok([200, 400].includes(tokenResult.statusCode));
    if (tokenResult.statusCode === 200) {
      const issued = tokenResult.json();
      assert.equal((await f.request("POST", "/oauth/token", {grant_type:"refresh_token",client_id:u.client,resource,refresh_token:issued.refresh_token})).json().error, "invalid_grant");
    }
  } finally {
    await gate.query("ROLLBACK").catch(() => {});
    gate.release();
    await f.close();
  }
});

test("Connecting a second OAuth assistant preserves both connections and their access", async () => {
  const f = await fixture();
  try {
    const u = await setup(f);
    const connections = [];
    for (const name of ["ChatGPT", "Claude"]) {
      const registration = await f.request("POST", "/oauth/register", {
        client_name: name,
        redirect_uris: ["https://client.example/callback"],
        token_endpoint_auth_method: "none",
      });
      const client = registration.json().client_id;
      const { exchange } = await grant(f, { ...u, client }, false, name);
      const response = await f.request("POST", "/oauth/token", exchange);
      assert.equal(response.statusCode, 200);
      connections.push({ client, token: response.json() });
    }
    const list = () => f.request("GET", "/api/keys", undefined, u.cookie);
    assert.deepEqual((await list()).json().items.map((k: any) => k.name).sort(), ["ChatGPT", "Claude"]);
    for (const connection of connections) {
      const refreshed = await f.request("POST", "/oauth/token", {
        grant_type: "refresh_token", client_id: connection.client, resource,
        refresh_token: connection.token.refresh_token,
      });
      assert.equal(refreshed.statusCode, 200);
      const call = await f.request("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }, undefined, {
        host: "127.0.0.1:4000", accept: "application/json, text/event-stream",
        authorization: `Bearer ${refreshed.json().access_token}`,
      });
      assert.equal(call.statusCode, 200);
    }
    assert.deepEqual((await list()).json().items.map((k: any) => k.name).sort(), ["ChatGPT", "Claude"]);
    const revoked = await f.request("POST", "/oauth/revoke", {
      client_id: connections[0].client,
      token: connections[0].token.refresh_token,
    });
    assert.equal(revoked.statusCode, 200);
    assert.deepEqual((await list()).json().items.map((k: any) => k.name), ["Claude"]);
  } finally { await f.close(); }
});
