import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const webPort = Number(process.env.VERIFY_WEB_PORT ?? 3100);
const adminPort = Number(process.env.VERIFY_ADMIN_PORT ?? 3101);

for (const [port, app, name] of [[webPort, "web", "Stash"], [adminPort, "admin", "Stash Admin"]] as const) {
  test(`${name} installs separately and keeps offline storage public`, async ({ page, context }) => {
    const origin = `http://127.0.0.1:${port}`;
    await page.goto(`${origin}/offline.html`);
    await page.evaluate(async (prefix) => {
      await caches.open(`${prefix}obsolete`);
      await caches.open("unrelated-public-cache");
    }, `stash-${app}-public-`);
    await page.goto(origin);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
    });
    const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute("href");
    const manifest = await (await page.request.get(`${origin}${manifestUrl}`)).json();
    expect(manifest).toMatchObject({ name, id: "/", start_url: "/", scope: "/", display: "standalone" });
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      const response = await page.request.get(`${origin}${icon.src}`);
      expect(response.ok()).toBe(true);
      const size = await sharp(await response.body()).metadata();
      expect(`${size.width}x${size.height}`).toBe(icon.sizes);
    }
    const worker = await page.request.get(`${origin}/sw.js`);
    expect(worker.headers()["cache-control"]).toContain("no-store");
    expect(worker.headers()["content-type"]).toContain("javascript");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
    const install = page.getByRole("button", { name: `Install ${name}`, exact: true });
    await install.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(install).toBeFocused();
    // Exercise a native install event without installing software on the test host.
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, { prompt: async () => { document.documentElement.dataset.installPrompted = "yes"; }, userChoice: Promise.resolve({ outcome: "dismissed" }) });
      window.dispatchEvent(event);
    });
    await install.click();
    await expect(page.locator("html")).toHaveAttribute("data-install-prompted", "yes");
    const privatePath = app === "web" ? "/api/me" : "/admin-api/me";
    await page.evaluate(async path => { await fetch(path); }, privatePath);
    const cacheState = await page.evaluate(async () => ({ names: await caches.keys(), urls: await Promise.all((await caches.keys()).filter(name => name.startsWith("stash-")).map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname))) }));
    expect(cacheState.names).toContain("unrelated-public-cache");
    expect(cacheState.names).not.toContain(`stash-${app}-public-obsolete`);
    expect(cacheState.urls.flat().sort()).toEqual(["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"].sort());
    await context.setOffline(true);
    expect(await page.evaluate(async path => { try { await fetch(path); return true; } catch { return false; } }, privatePath)).toBe(false);
    await page.goto(`${origin}/signin?returnTo=%2Fprivate`);
    await expect(page.getByRole("heading", { name: "You’re offline." })).toBeVisible();
    expect(await page.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir("docs/evidence/pwa", { recursive: true });
    await page.screenshot({ path: `docs/evidence/pwa/${app}-offline.png` });
    await context.setOffline(false);
    await page.getByRole("link", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "You’re offline." })).toHaveCount(0);
    await expect(install).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(install).toHaveCount(0);
  });
}

test("Signed-in library responses never enter offline storage", async ({ page, context }) => {
  const headers = { origin: `http://127.0.0.1:${webPort}` };
  const signup = await page.request.post("/api/auth/signup", { headers, data: { name: "Offline researcher", email: `pwa-${crypto.randomUUID()}@example.test`, password: "Research123" } });
  expect(signup.status()).toBe(201);
  const saved = await page.request.post("/api/items", { headers, data: { kind: "note", title: "Private offline sentinel", body: "This content must stay out of CacheStorage." } });
  expect(saved.status()).toBe(200);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Private offline sentinel", exact: true })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.getByRole("link", { name: "Private offline sentinel", exact: true }).click();
  await expect(page.getByText("This content must stay out of CacheStorage.", { exact: true })).toBeVisible();
  await page.reload();
  await page.goto("/todos");
  await page.getByLabel("New task").fill("Private Todo offline sentinel");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Task details" })).toBeVisible();
  await page.getByLabel("Notes", { exact: true }).fill("Private task notes must stay out of CacheStorage.");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.locator(".todo-row")).toContainText("Private Todo offline sentinel");
  const stored = await page.evaluate(async () => Promise.all((await caches.keys()).map(async name => {
    const cache = await caches.open(name);
    return Promise.all((await cache.keys()).map(async request => ({ url: request.url, body: request.url.endsWith(".html") ? await (await cache.match(request))!.text() : "" })));
  })));
  expect(JSON.stringify(stored)).not.toContain("Private offline sentinel");
  expect(JSON.stringify(stored)).not.toContain("Private Todo offline sentinel");
  expect(JSON.stringify(stored)).not.toContain("Private task notes must stay out of CacheStorage.");
  expect(stored.flat().every(entry => /^\/(icons\/[^/]+\.png|offline\.html)$/.test(new URL(entry.url).pathname))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "You’re offline." })).toBeVisible();
  await expect(page.getByText("Private offline sentinel", { exact: true })).toHaveCount(0);
});
