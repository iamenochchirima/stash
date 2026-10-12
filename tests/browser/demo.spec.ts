import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("Agent save demo types, shows its preview, and adds a card without player chrome", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  const demo = page.locator(".save-demo");
  await demo.scrollIntoViewIfNeeded();
  await expect(page.locator(".demo-existing-card")).toHaveCount(2);
  await expect(page.getByText("2 resources", { exact: true })).toBeVisible();
  await expect(page.locator(".demo-player, .demo-chapters, .demo-caption")).toHaveCount(0);
  await mkdir("docs/evidence/browser", { recursive: true });
  await demo.screenshot({ path: "docs/evidence/browser/demo-ask-stage.png", animations: "disabled" });
  await expect(page.getByLabel("Example message being typed")).toContainText("Stash", { timeout: 7000 });
  await expect(page.getByRole("button", { name: "Confirm example save" })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Pause demo" }).click();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: "docs/evidence/browser/demo-confirm-desktop.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Confirm example save" }).click();
  await expect(page.getByText("Saved to Design", { exact: true })).toBeVisible();
  await expect(page.getByText("3 resources", { exact: true })).toBeVisible();
  await expect(page.locator(".demo-existing-card")).toHaveCount(2);
  await expect(page.locator(".demo-saved-note")).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await expect(page.locator(".demo-play")).toHaveCSS("opacity", "0");
  await demo.screenshot({ path: "docs/evidence/browser/demo-saved-stage.png", animations: "disabled" });
  await page.screenshot({ path: "docs/evidence/browser/demo-saved-desktop.png", fullPage: true, animations: "disabled" });
});


test("Demo autoplays, loops, resumes in view, and respects a manual pause", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await page.locator(".save-demo").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Pause demo" })).toBeVisible();
  await expect(page.getByText("3 resources", { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("2 resources", { exact: true })).toBeVisible({ timeout: 7000 });
  await expect(page.getByRole("button", { name: "Pause demo" })).toBeVisible();
  const demo = page.locator(".save-demo");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("button", { name: "Play demo" })).toHaveCount(1);
  const offscreen = await demo.getAttribute("class");
  await page.waitForTimeout(200);
  await expect(demo).toHaveAttribute("class", offscreen!);
  await page.locator(".save-demo").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Pause demo" })).toBeVisible();
  await page.getByRole("button", { name: "Pause demo" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(".save-demo").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Play demo" })).toBeVisible();
});
