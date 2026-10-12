import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchMetadata,
  resolveTarget,
  publicAddress,
  requestPage,
} from "../apps/server/src/metadata.js";
import http from "node:http";
import { once } from "node:events";
test("T18 block private IPv4/IPv6, credentials, unsafe ports, mixed DNS results, and redirects before fetching", async () => {
  for (const value of [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "168.63.129.16",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "0.0.0.0",
    "224.0.0.1",
  ])
    assert.equal(publicAddress(value), false, value);
  assert.equal(publicAddress("93.184.216.34"), true);
  for (const value of [
    "http://localhost",
    "http://127.0.0.1",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "https://user:pass@example.test",
    "https://example.test:8080",
    "file:///tmp/file",
  ])
    await assert.rejects(
      resolveTarget(value, async () => [{ address: "127.0.0.1", family: 4 }]),
    );
  await assert.rejects(
    resolveTarget("https://example.test", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]),
  );
  let requests = 0;
  const result = await fetchMetadata("https://example.test", {
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async () => {
      requests++;
      return {
        status: 302,
        location: "http://169.254.169.254/latest/meta-data",
        body: "",
        contentType: "text/html",
      };
    },
  });
  assert.equal(result.metadataStatus, "unavailable");
  assert.equal(requests, 1);
});
test("T18 metadata extraction, bounded redirects, DNS changes, non-HTML/oversize/failure fallback", async () => {
  const resolver = async () => [{ address: "93.184.216.34", family: 4 }];
  const result = await fetchMetadata("https://example.test", {
    resolver,
    request: async () => ({
      status: 200,
      contentType: "text/html",
      body: '<title>Research &amp; design</title><meta name="description" content="Useful context">',
    }),
  });
  assert.equal(result.metadataStatus, "extracted");
  assert.equal("title" in result && result.title, "Research & design");
  assert.equal(result.description, "Useful context");
  let requests = 0;
  const redirects = await fetchMetadata("https://example.test", {
    resolver,
    request: async () => {
      requests++;
      return {
        status: 302,
        location: "/again",
        contentType: "text/html",
        body: "",
      };
    },
  });
  assert.equal(redirects.metadataStatus, "unavailable");
  assert.equal(requests, 4);
  let dns = 0;
  requests = 0;
  await fetchMetadata("https://example.test", {
    resolver: async () => [
      { address: ++dns === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 },
    ],
    request: async () => {
      requests++;
      return {
        status: 302,
        location: "/next",
        contentType: "text/html",
        body: "",
      };
    },
  });
  assert.equal(requests, 1);
  for (const request of [
    async () => ({ status: 200, contentType: "application/json", body: "{}" }),
    async () => ({
      status: 200,
      contentType: "text/html",
      body: "x".repeat(524289),
    }),
    async () => {
      throw new Error("timeout");
    },
  ])
    assert.equal(
      (await fetchMetadata("https://example.test", { resolver, request }))
        .metadataStatus,
      "unavailable",
    );
});
test("T18 actual HTTP reader enforces response size and absolute socket deadline", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    if (req.url === "/large") res.end("x".repeat(524289));
    else if (req.url === "/slow") {
      res.write("<title>");
    } else res.end("<title>Good</title>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as any).port;
  try {
    const good = await requestPage(
      new URL(`http://localhost:${port}/good`),
      { address: "127.0.0.1", family: 4 },
      1000,
    );
    assert.equal(good.status, 200);
    await assert.rejects(
      requestPage(
        new URL(`http://localhost:${port}/large`),
        { address: "127.0.0.1", family: 4 },
        1000,
      ),
    );
    await assert.rejects(
      requestPage(
        new URL(`http://localhost:${port}/slow`),
        { address: "127.0.0.1", family: 4 },
        30,
      ),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("T18 stalled DNS respects the total five-second metadata deadline", async () => {
  const started = Date.now();
  let requests = 0;
  const result = await fetchMetadata("https://stall.example.test", {
    resolver: () => new Promise(() => {}),
    request: async () => {
      requests++;
      return { status: 200, contentType: "text/html", body: "" };
    },
  });
  assert.equal(result.metadataStatus, "unavailable");
  assert.equal(requests, 0);
  assert.ok(Date.now() - started < 6000);
});
