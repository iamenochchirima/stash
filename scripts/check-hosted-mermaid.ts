import { chromium, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { diagramNote } from "../tests/fixtures/mermaid.js";

if (process.env.STASH_HOSTED_ACCEPTANCE !== "true") throw Error("Explicit hosted acceptance flag required");
const origin = "https://stash.kasitek.co.za", headers = { origin }, password = randomBytes(24).toString("base64url");
const browser = await chromium.launch(), context = await browser.newContext(), page = await context.newPage();
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), passed: false };
let created = false, stage = "signup";
async function json(response: any, status = 200) { expect(response.status()).toBe(status); return response.json(); }
try {
  await json(await context.request.post(`${origin}/api/auth/signup`, { headers, data: {
    name: "Hosted diagram reader", email: `delivered+stash-diagram-${randomUUID()}@resend.dev`, password,
  } }), 201);
  created = true;
  stage = "save";
  const { item } = await json(await context.request.post(`${origin}/api/items`, { headers, data: { kind: "note", title: "Hosted architecture verification", body: diagramNote } }));
  for (const width of [1440, 375]) {
    stage = `diagrams ${width}px`;
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}/items/${item.id}`);
    await page.reload();
    const diagrams = page.locator(".mermaid-diagram"), images = diagrams.getByRole("img", { name: "Mermaid diagram", exact: true });
    await expect(images).toHaveCount(2, { timeout: 60000 });
    for (const image of await images.all()) await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth), { timeout: 15000 }).toBeGreaterThan(0);
    const svg = decodeURIComponent((await images.first().getAttribute("src"))!.split(",").slice(1).join(","));
    expect(svg).toContain("flowchart-Console");
    expect(svg).toContain("flowchart-Objects");
    expect(svg).not.toContain("<foreignObject");
    const first = diagrams.first();
    await first.getByRole("button", { name: "Zoom in diagram", exact: true }).click();
    await expect(first.getByRole("button", { name: "Reset diagram zoom", exact: true })).toHaveText("125%");
    const viewport = first.getByRole("region", { name: "Mermaid diagram", exact: true });
    await viewport.focus(); await page.keyboard.press("ArrowRight");
    await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await first.getByRole("button", { name: "Reset diagram zoom", exact: true }).click();
    await viewport.evaluate(el => { el.scrollLeft = 0; });
    await first.getByText("Diagram source", { exact: true }).click();
    await expect(first.getByRole("region", { name: "Diagram source code" })).toContainText("flowchart TB");
    await first.getByText("Diagram source", { exact: true }).click();
    await expect(page.locator("pre code.language-ts")).toHaveText("const useful = true;\n");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await mkdir("docs/evidence/mermaid", { recursive: true });
    await page.screenshot({ path: `docs/evidence/mermaid/hosted-${width}.png`, fullPage: true });
    report[`${width}px`] = "Architecture and sequence diagrams loaded after reload; source, zoom, keyboard scrolling, ordinary code and axe passed";
  }
  report.passed = true;
} catch (error) { report.failedAt = stage; report.errorType = (error as Error).name; process.exitCode = 1; }
finally {
  if (created) {
    try { report.disposableAccountDeleted = (await context.request.delete(`${origin}/api/me`, { headers, data: { password, confirmation: "DELETE" } })).status() === 200; }
    catch { report.disposableAccountDeleted = false; }
  }
  await context.close(); await browser.close();
  await mkdir("docs/evidence/mermaid", { recursive: true });
  await writeFile("docs/evidence/mermaid/hosted.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (!report.disposableAccountDeleted) process.exitCode = 1;
}
