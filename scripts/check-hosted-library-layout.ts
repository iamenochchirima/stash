import { chromium, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
if (process.env.STASH_HOSTED_ACCEPTANCE !== "true") throw Error("Explicit hosted acceptance flag required");
const origin = "https://stash.kasitek.co.za", headers = { origin }, password = randomBytes(24).toString("base64url");
const browser = await chromium.launch(), context = await browser.newContext({ hasTouch: true }), page = await context.newPage();
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), passed: false };
let created = false, stage = "signup";
async function json(response: any, status = 200) { expect(response.status()).toBe(status); return response.json(); }
try {
  await json(await context.request.post(`${origin}/api/auth/signup`, { headers, data: { name: "Hosted library reader", email: `delivered+stash-layout-${randomUUID()}@resend.dev`, password } }), 201);
  created = true;
  const ids: string[] = [];
  const titles = ["Reading workflow", "Research questions", "Architecture reference", "Field notes", "Design handbook", "A longer reference title for checking compact layout and wrapping"];
  for (const [index, title] of titles.entries()) {
    stage = "capture";
    const { item } = await json(await context.request.post(`${origin}/api/items`, { headers, data: {
      kind: index === 0 ? "note" : index === 1 ? "idea" : "link", title,
      ...(index > 1 ? { url: `https://example.com/layout-reference-${index}` } : { body: "Collect useful sources and keep enough context for later." }),
      notes: index > 1 ? "A useful reference with enough context to identify the source quickly." : "",
      tags: ["research", "reading", "reference", "ideas"],
    } })); ids.push(item.id);
  }
  const list = page.locator(".library-items"), card = (title: string) => page.locator(".resource-card").filter({ has: page.getByRole("link", { name: title, exact: true }) });
  await mkdir("docs/evidence/compact-library", { recursive: true });
  for (const width of [1440, 375]) {
    stage = `layout ${width}px`;
    await page.setViewportSize({ width, height: 1000 }); await page.goto(origin + "/library");
    await expect(list).toHaveAttribute("data-view", "list"); await expect(page.locator(".resource-card")).toHaveCount(6);
    expect((await card(titles[0]).boundingBox())!.height).toBeLessThan(width === 1440 ? 110 : 160);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `docs/evidence/compact-library/hosted-list-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Grid", exact: true }).click(); await page.reload();
    await expect(list).toHaveAttribute("data-view", "grid"); await expect(page.locator(".resource-card")).toHaveCount(6);
    expect((await card(titles[5]).boundingBox())!.height).toBeLessThan(210);
    await expect(card(titles[0]).getByLabel("2 more tags")).toHaveText("+2");
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `docs/evidence/compact-library/hosted-grid-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "List", exact: true }).click();
    stage = `menu ${width}px`;
    if (width === 375) {
      const target = card(titles[0]).locator(".resource-title"); await target.scrollIntoViewIfNeeded();
      const bounds = await target.boundingBox(), cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bounds!.x + 8, y: bounds!.y + 8 }] });
      await page.waitForTimeout(650); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await cdp.detach();
    } else await card(titles[0]).getByRole("link", { name: titles[0], exact: true }).click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await page.getByRole("menuitem", { name: "Select item", exact: true }).click();
    await page.getByRole("checkbox", { name: `Select ${titles[1]}`, exact: true }).check();
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
    await page.screenshot({ path: `docs/evidence/compact-library/hosted-selection-${width}.png`, fullPage: true });
    stage = `bulk trash ${width}px`;
    await page.getByRole("button", { name: "Move selected to Trash", exact: true }).click();
    await expect(page.locator(".resource-card")).toHaveCount(4);
    expect((await context.request.get(`${origin}/api/items/${ids[0]}`)).status()).toBe(404);
    expect((await context.request.get(`${origin}/api/items/${ids[1]}?trash=true`)).status()).toBe(200);
    await page.getByRole("link", { name: "Trash", exact: true }).click(); await expect(page).toHaveURL(/\/library\/trash$/);
    await expect(page.locator(".resource-card")).toHaveCount(2);
    await page.getByRole("button", { name: "Select items", exact: true }).click(); await page.getByRole("checkbox", { name: "Select all items on this page" }).check();
    await page.getByRole("button", { name: "Restore selected", exact: true }).click(); await expect(page.locator(".resource-card")).toHaveCount(0);
    expect((await context.request.get(`${origin}/api/items/${ids[0]}`)).status()).toBe(200);
    await page.getByRole("link", { name: /All items/ }).click(); await expect(page.locator(".resource-card")).toHaveCount(6);
    report[`${width}px`] = "Compact list/grid, saved preference, menu, two-item Trash and restore, persistence, no overflow and axe passed";
  }
  report.passed = true;
} catch (error) { report.failedAt = stage; report.errorType = (error as Error).name; process.exitCode = 1; }
finally {
  if (created) {
    try { report.disposableAccountDeleted = (await context.request.delete(`${origin}/api/me`, { headers, data: { password, confirmation: "DELETE" } })).status() === 200; }
    catch { report.disposableAccountDeleted = false; }
  }
  await context.close(); await browser.close();
  await mkdir("docs/evidence/compact-library", { recursive: true });
  await writeFile("docs/evidence/compact-library/hosted.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
  if (!report.disposableAccountDeleted) process.exitCode = 1;
}
