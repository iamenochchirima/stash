import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

for (const width of [1440, 375]) test.describe(`Compact library at ${width}px`, () => {
  test.use({ viewport: { width, height: 1000 }, hasTouch: width === 375 });
  test("List/grid preferences, item menus, selection and recoverable deletion", async ({ page, context }) => {
    test.setTimeout(120000);
    const headers = { origin: "http://127.0.0.1:3100" };
    const signup = await page.request.post("/api/auth/signup", { headers, data: { name: "Library reader", email: `layout-${randomUUID()}@example.test`, password: "Layout123" } });
    expect(signup.status()).toBe(201);
    const collection = await page.request.post("/api/collections", { headers, data: { name: "Reading list" } });
    expect(collection.status()).toBe(200);
    const group = (await collection.json()).item;
    const inbox = (await (await page.request.get("/api/collections")).json()).items.find((c: any) => c.name === "Inbox");
    const fixtures = ["Reading workflow", "Research questions", "Architecture reference", "Field notes", "Design handbook", "A longer resource title to check wrapping and compact grid sizing"];
    const ids: string[] = [];
    for (const [index, title] of fixtures.entries()) {
      const response = await page.request.post("/api/items", { headers, data: {
        kind: index === 0 ? "note" : index === 1 ? "idea" : "link", title,
        ...(index > 1 ? { url: `https://example.test/reference-${index}` } : {}),
        body: index < 2 ? "Explore a calmer way to collect sources and keep useful context for later." : undefined,
        notes: index > 1 ? "A useful reference with enough context to identify the source quickly." : "",
        tags: ["research", "reading", "reference", "ideas"], collectionIds: [inbox.id, group.id],
      } });
      expect(response.status()).toBe(200); ids.push((await response.json()).item.id);
    }
    await page.goto("/library");
    const list = page.locator(".library-items"), card = (title: string) => page.locator(".resource-card").filter({ has: page.getByRole("link", { name: title, exact: true }) });
    await expect(list).toHaveAttribute("data-view", "list");
    await expect(page.locator(".resource-card")).toHaveCount(6);
    await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect((await card(fixtures[0]).boundingBox())!.height).toBeLessThan(width === 1440 ? 110 : 160);
    await expect(card(fixtures[0]).locator(".resource-collection")).toHaveText("Inbox, Reading list");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await mkdir("docs/evidence/compact-library", { recursive: true });
    await page.screenshot({ path: `docs/evidence/compact-library/list-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await expect(list).toHaveAttribute("data-view", "grid");
    await expect(card(fixtures[0]).locator(".tags span")).toHaveCount(3);
    await expect(card(fixtures[0]).getByLabel("2 more tags")).toHaveText("+2");
    expect((await card(fixtures[5]).boundingBox())!.height).toBeLessThan(210);
    await page.reload(); await expect(list).toHaveAttribute("data-view", "grid");
    await expect(page.locator(".resource-card")).toHaveCount(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `docs/evidence/compact-library/grid-${width}.png`, fullPage: true });
    await card(fixtures[2]).getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card(fixtures[2]).getByRole("link", { name: "Open source" })).toHaveAttribute("href", "https://example.test/reference-2");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(list).toHaveAttribute("data-view", "list");
    await card(fixtures[0]).getByRole("link", { name: fixtures[0], exact: true }).click();
    await expect(page).toHaveURL(/\/items\//, { timeout: 20000 });
    await page.getByRole("link", { name: "Back to library" }).click();
    await expect(list).toHaveAttribute("data-view", "list");

    const target = card(fixtures[0]);
    if (width === 375) {
      await target.scrollIntoViewIfNeeded();
      const cdp = await context.newCDPSession(page);
      const start = await target.locator(".resource-title").boundingBox();
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start!.x + 8, y: start!.y + 8 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start!.x + 38, y: start!.y - 28 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(650);
      await expect(page.getByRole("menu")).toHaveCount(0);
      const bounds = await target.locator(".resource-title").boundingBox();
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bounds!.x + 8, y: bounds!.y + 8 }] });
      await page.waitForTimeout(650);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    } else await target.getByRole("link", { name: fixtures[0], exact: true }).click({ button: "right" });
    await expect(page.getByRole("menu", { name: `Actions for ${fixtures[0]}` })).toBeVisible();
    await expect(page).toHaveURL(/\/library$/);
    await page.screenshot({ path: `docs/evidence/compact-library/menu-${width}.png`, fullPage: false });
    await page.keyboard.press("Escape");
    await expect(target.getByRole("button", { name: `More actions for ${fixtures[0]}` })).toBeFocused();
    await target.getByRole("button", { name: `More actions for ${fixtures[0]}` }).click();
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: "Move to Trash" })).toBeFocused();
    await page.getByRole("menuitem", { name: "Select item", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: `Select ${fixtures[0]}`, exact: true })).toBeChecked();
    await page.getByRole("checkbox", { name: `Select ${fixtures[1]}`, exact: true }).check();
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `docs/evidence/compact-library/selection-${width}.png`, fullPage: true });
    const failedPath = `**/api/items/${ids[1]}/lifecycle`;
    await page.route(failedPath, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary failure" }) }));
    await page.getByRole("button", { name: "Move selected to Trash", exact: true }).click();
    await expect(card(fixtures[0])).toHaveCount(0);
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: `Select ${fixtures[1]}`, exact: true })).toBeChecked();
    expect((await page.request.get(`/api/items/${ids[0]}`)).status()).toBe(404);
    expect((await page.request.get(`/api/items/${ids[0]}?trash=true`)).status()).toBe(200);
    await page.unroute(failedPath);
    await page.getByRole("button", { name: "Move selected to Trash", exact: true }).click();
    await expect(card(fixtures[1])).toHaveCount(0);
    await page.getByRole("link", { name: "Trash", exact: true }).click();
    await expect(page).toHaveURL(/\/library\/trash$/);
    await expect(page.locator(".resource-card")).toHaveCount(2);
    await page.getByRole("button", { name: "Select items", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select all items on this page" }).check();
    await page.getByRole("button", { name: "Restore selected", exact: true }).click();
    await expect(page.locator(".resource-card")).toHaveCount(0);
    expect((await page.request.get(`/api/items/${ids[0]}`)).status()).toBe(200);
    expect((await page.request.get(`/api/items/${ids[1]}`)).status()).toBe(200);
    await page.getByRole("link", { name: /All items/ }).click();
    await expect(page.locator(".resource-card")).toHaveCount(6);
    await card(fixtures[0]).getByRole("button", { name: `More actions for ${fixtures[0]}` }).click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await expect(card(fixtures[0])).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(card(fixtures[0])).toBeVisible();
    await page.getByRole("button", { name: "Select items", exact: true }).click();
    await page.getByRole("checkbox", { name: `Select ${fixtures[0]}`, exact: true }).check();
    await page.getByLabel("Search your library").fill("Architecture");
    await expect(page.getByRole("group", { name: "Selected items", exact: true })).toHaveCount(0);
    await expect(page.locator(".resource-card")).toHaveCount(1);
    await expect(page.getByLabel("Search your library")).toHaveValue("Architecture");
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await expect(page.getByLabel("Search your library")).toHaveValue("Architecture");
    await context.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("Storage unavailable"); }; });
    await page.reload();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(list).toHaveAttribute("data-view", "list");
  });
});
