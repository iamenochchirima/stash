import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

for (const width of [1440, 375]) {
  test(`Details render Markdown and contain wide content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const headers = { origin: "http://127.0.0.1:3100" };
    const signup = await page.request.post("/api/auth/signup", {
      headers,
      data: { name: "Markdown reader", email: `markdown-${randomUUID()}@example.test`, password: "Markdown123" },
    });
    expect(signup.status()).toBe(201);
    await page.route("https://example.test/diagram.svg", route => route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><rect width="1600" height="400" fill="#d9e3d4"/><text x="60" y="210" font-size="64">Research diagram</text></svg>',
    }));
    const longCode = `const source = "${"long-source-".repeat(30)}";`;
    const body = [
      "## Offering catalogue",
      "A **useful** summary with *emphasis*, ~~old wording~~ and `inline code`.",
      ["| Offering | Outcome | Capabilities | Integration | Human controls |",
      "| --- | --- | --- | --- | --- |",
      "| Knowledge assistant | Answer public enquiries | Retrieve approved knowledge | Documents and website content | Correct sources |",
      "| Account assistant | Account-specific help | Read booking status | Verified customer scope | Take over |"].join("\n"),
      "![Research diagram](https://example.test/diagram.svg)",
      `[Source guide](https://example.test/guide) and https://example.test/reference and [Email](mailto:reader@example.test).`,
      "> Review the sources before publishing.",
      "- First source\n  - Nested source\n\n1. Read\n2. Review",
      "- [x] Checked\n- [ ] Follow up",
      `\`\`\`ts\n${longCode}\n\`\`\``,
      "---",
      '<script>window.markdownInjected = true</script>',
      '[Unsafe link](javascript:alert%281%29)\n\n![Unsafe image](javascript:alert%281%29)',
      '<iframe src="https://example.test/embed"></iframe>',
    ].join("\n\n");
    await page.goto("/library");
    await page.getByRole("button", { name: "Add item", exact: true }).first().click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Type", { exact: true }).selectOption("note");
    await form.getByLabel("Title", { exact: true }).fill("Markdown details");
    await form.getByLabel("Content", { exact: true }).fill(body);
    await form.getByRole("button", { name: "Save item", exact: true }).click();
    await page.getByRole("link", { name: "Markdown details", exact: true }).click();
    await expect(page).toHaveURL(/\/items\//);
    await expect(page.getByRole("heading", { name: "Offering catalogue" })).toBeVisible();
    await page.reload();
    const content = page.locator(".item-markdown");
    await expect(content.getByRole("heading", { name: "Offering catalogue" })).toBeVisible();
    await expect(content.getByRole("table")).toBeVisible();
    await expect(content.getByRole("columnheader")).toHaveCount(5);
    await expect(content.getByRole("cell")).toHaveCount(10);
    await expect(content.locator("strong")).toHaveText("useful");
    await expect(content.locator("em")).toHaveText("emphasis");
    await expect(content.locator("del")).toHaveText("old wording");
    await expect(content.locator("ul ul li")).toHaveText("Nested source");
    await expect(content.locator("ol li")).toHaveCount(2);
    await expect(content.locator("blockquote")).toContainText("Review the sources");
    await expect(content.getByRole("checkbox").first()).toBeChecked();
    await expect(content.getByRole("checkbox").last()).not.toBeChecked();
    const image = content.getByRole("img", { name: "Research diagram" });
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(1600);
    await expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(content.getByRole("link", { name: "Source guide" })).toHaveAttribute("href", "https://example.test/guide");
    await expect(content.getByRole("link", { name: "https://example.test/reference" })).toHaveAttribute("href", "https://example.test/reference");
    await expect(content.getByRole("link", { name: "Email", exact: true })).toHaveAttribute("href", "mailto:reader@example.test");
    await expect(content.locator("pre code")).toHaveText(`${longCode}\n`);
    await expect(content.locator("script, iframe, img[src^='javascript:'], a[href^='javascript:']")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).markdownInjected)).toBeUndefined();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const tableRegion = content.getByRole("region", { name: "Markdown table" });
    await tableRegion.focus();
    if (width === 375) {
      expect(await tableRegion.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => tableRegion.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    }
    await tableRegion.evaluate(el => { el.scrollLeft = 0; });
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await mkdir("docs/evidence/markdown", { recursive: true });
    await page.screenshot({ path: `docs/evidence/markdown/details-${width}.png`, fullPage: true });
  });
}
