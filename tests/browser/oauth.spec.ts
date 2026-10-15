import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readdir, readFile, mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import {
  auth,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("OAuth SDK discovery, browser signup/verification/consent, MCP save/retrieve and dashboard revocation", async ({
  page,
}) => {
  const endpoint = new URL("http://127.0.0.1:4100/mcp");
  let information: OAuthClientInformationMixed | undefined,
    tokens: OAuthTokens | undefined,
    verifier = "",
    authorize: URL | undefined;
  const provider: OAuthClientProvider = {
    redirectUrl: "http://127.0.0.1:9999/callback",
    clientMetadata: {
      client_name: "Browser OAuth",
      redirect_uris: ["http://127.0.0.1:9999/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    clientInformation: () => information,
    saveClientInformation: (info) => {
      information = info;
    },
    tokens: () => tokens,
    saveTokens: (value) => {
      tokens = value;
    },
    codeVerifier: () => verifier,
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    redirectToAuthorization: (url) => {
      authorize = url;
    },
    state: () => "browser-state",
  };
  expect(
    await auth(provider, {
      serverUrl: endpoint,
      scope: "stash:read stash:write",
    }),
  ).toBe("REDIRECT");
  await page.goto(authorize!.toString());
  await expect(page).toHaveURL(/\/signin\?next=/);
  await page.getByRole("link", { name: "Sign up", exact: true }).click();
  await expect(page).toHaveURL(/\/signup\?next=/);
  const email = `oauth-${randomUUID()}@example.test`;
  await page.getByLabel("Your name").fill("OAuth Researcher");
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/oauth\/consent\?request=/);
  const consentUrl = page.url();
  await expect(
    page.getByRole("button", { name: "Allow access" }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Also save and delete resources"),
  ).not.toBeChecked();
  const messages = await Promise.all(
    (await readdir(".data/verification-mail")).map(async (file) =>
      JSON.parse(await readFile(`.data/verification-mail/${file}`, "utf8")),
    ),
  );
  const message = messages
    .filter((m) => m.to === email && m.subject.toLowerCase().includes("verify"))
    .at(-1);
  const token = new URL(
    message.text.match(/https?:\/\/\S+/)[0],
  ).searchParams.get("verify")!;
  await page.goto(`/?verify=${token}`);
  await page.getByRole("button", { name: "Verify my email" }).click();
  await expect(page.getByText("Your email is verified.")).toBeVisible();
  await page.goto(consentUrl);
  await expect(
    page.getByRole("button", { name: "Allow access" }),
  ).toBeEnabled();
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await page.getByLabel("Also save and delete resources").check();
  await mkdir("docs/evidence/browser", { recursive: true });
  await page.screenshot({
    path: "docs/evidence/browser/oauth-consent.png",
    fullPage: true,
  });
  await page.route("http://127.0.0.1:9999/callback**", (route) =>
    route.fulfill({ body: "Connection approved", contentType: "text/plain" }),
  );
  await page.getByRole("button", { name: "Allow access" }).click();
  await expect(page).toHaveURL(/9999\/callback\?/);
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe("browser-state");
  expect(
    await auth(provider, {
      serverUrl: endpoint,
      authorizationCode: callback.searchParams.get("code")!,
    }),
  ).toBe("AUTHORIZED");
  const client = new Client({ name: "browser-oauth-sdk", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, { authProvider: provider }),
    );
    const result = await client.callTool({
      name: "save_resource",
      arguments: {
        url: "https://example.test/oauth-resource",
        title: "OAuth saved article",
        notes: "Saved through the OAuth connection",
      },
    });
    expect(result.isError).not.toBe(true);
    const found = await client.callTool({
      name: "search_resources",
      arguments: { q: "OAuth saved article" },
    });
    expect(JSON.stringify(found)).toContain(
      "Saved through the OAuth connection",
    );
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: "OAuth saved article" }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Agent connections", exact: true })
      .click();
    await expect(
      page.getByText("Browser OAuth", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".key-row small")).toContainText("OAuth");
    await page.screenshot({
      path: "docs/evidence/browser/oauth-connections.png",
      fullPage: true,
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revoke Browser OAuth" }).click();
    await expect(page.getByText("Browser OAuth", { exact: true })).toHaveCount(
      0,
    );
    const revoked = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens!.access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(revoked.status).toBe(401);
  } finally {
    await client.close();
  }
});
