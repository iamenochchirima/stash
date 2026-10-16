import { chromium, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

if (process.env.STASH_HOSTED_ACCEPTANCE !== "true") throw Error("Explicit hosted acceptance flag required");
const origin = "https://stash.kasitek.co.za", headers = { origin };
const password = randomBytes(24).toString("base64url");
const browser = await chromium.launch(), context = await browser.newContext(), page = await context.newPage();
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), passed: false };
let created = false, stage = "signup";
async function json(response: any, status = 200) { expect(response.status()).toBe(status); return response.json(); }
try {
  await json(await context.request.post(`${origin}/api/auth/signup`, { headers, data: {
    name: "Hosted Markdown reader", email: `delivered+stash-markdown-${randomUUID()}@resend.dev`, password,
  } }), 201);
  created = true;
  const body = [
    "## Offering catalogue",
    "A **useful** summary with ~~old wording~~ and `inline code`.",
    "| Offering | Outcome | Capabilities | Integration | Human controls |\n| --- | --- | --- | --- | --- |\n| Knowledge assistant | Answer enquiries | Retrieve knowledge | Documents | Correct sources |",
    `![Stash image](${origin}/stash.png)`,
    "[Source guide](https://example.com/guide) and https://example.com/reference",
    "- [x] Checked\n- [ ] Follow up",
    '```ts\nconst source = "' + "long-source-".repeat(30) + '";\n```',
    '<script>window.markdownInjected = true</script>\n\n[Unsafe](javascript:alert%281%29)\n\n![Unsafe](javascript:alert%281%29)',
  ].join("\n\n");
  stage = "save";
  const saved = await json(await context.request.post(`${origin}/api/items`, { headers, data: { kind: "note", title: "Hosted Markdown verification", body } }));
  for (const width of [1440, 375]) {
    stage = `details ${width}px`;
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}/items/${saved.item.id}`);
    await page.reload();
    const content = page.locator(".item-markdown");
    await expect(content.getByRole("heading", { name: "Offering catalogue" })).toBeVisible();
    await expect(content.getByRole("columnheader")).toHaveCount(5);
    await expect(content.getByRole("cell")).toHaveCount(5);
    await expect(content.locator("del")).toHaveText("old wording");
    await expect(content.getByRole("link", { name: "Source guide" })).toHaveAttribute("href", "https://example.com/guide");
    await expect(content.getByRole("link", { name: "https://example.com/reference" })).toBeVisible();
    await expect(content.getByRole("checkbox", { name: "Completed task" })).toBeChecked();
    const image = content.getByRole("img", { name: "Stash image" });
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(content.locator("pre code")).toContainText("const source");
    await content.getByRole("region", { name: "Code block" }).focus();
    await expect(content.getByRole("region", { name: "Code block" })).toBeFocused();
    const table = content.getByRole("region", { name: "Markdown table" });
    await table.focus();
    if (width === 375) {
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    }
    await table.evaluate(el => { el.scrollLeft = 0; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(content.locator("script, iframe, img[src^='javascript:'], a[href^='javascript:']")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).markdownInjected)).toBeUndefined();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await mkdir("docs/evidence/markdown", { recursive: true });
    await page.screenshot({ path: `docs/evidence/markdown/hosted-${width}.png`, fullPage: true });
    report[`${width}px`] = "Rendered table, loaded remote image, code, links, tasks, safe content, keyboard scrolling and axe passed after reload";
  }
  report.passed = true;
} catch (error) {
  report.failedAt = stage;
  report.errorType = (error as Error).name;
  process.exitCode = 1;
} finally {
  if (created) {
    try { report.disposableAccountDeleted = (await context.request.delete(`${origin}/api/me`, { headers, data: { password, confirmation: "DELETE" } })).status() === 200; }
    catch { report.disposableAccountDeleted = false; }
  }
  await context.close(); await browser.close();
  await mkdir("docs/evidence/markdown", { recursive: true });
  await writeFile("docs/evidence/markdown/hosted.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (!report.disposableAccountDeleted) process.exitCode = 1;
}
