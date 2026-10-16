import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { diagramNote } from "../fixtures/mermaid";

for (const width of [1440, 375]) {
  test(`Mermaid diagrams render, zoom and recover from invalid source at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 1000 });
    const headers = { origin: "http://127.0.0.1:3100" };
    expect((await page.request.post("/api/auth/signup", { headers, data: {
      name: "Diagram reader", email: `mermaid-${randomUUID()}@example.test`, password: "Diagrams123",
    } })).status()).toBe(201);
    const response = await page.request.post("/api/items", { headers, data: { kind: "note", title: "Architecture diagrams", body: diagramNote } });
    expect(response.status()).toBe(200);
    const { item } = await response.json();
    await page.goto(`/items/${item.id}`);
    const diagrams = page.locator(".mermaid-diagram");
    const images = diagrams.getByRole("img", { name: "Mermaid diagram", exact: true });
    await expect(images).toHaveCount(2, { timeout: 60000 });
    for (const image of await images.all()) {
      await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth), { timeout: 15000 }).toBeGreaterThan(0);
    }
    const svg = decodeURIComponent((await images.first().getAttribute("src"))!.split(",").slice(1).join(","));
    expect(svg).toContain("flowchart-Console");
    expect(svg).toContain("flowchart-Objects");
    expect(svg).not.toContain("<foreignObject");
    await expect(page.locator("pre code.language-ts")).toHaveText("const useful = true;\n");
    const first = diagrams.first();
    const viewport = first.getByRole("region", { name: "Mermaid diagram", exact: true });
    await first.getByRole("button", { name: "Zoom in diagram", exact: true }).click();
    await expect(first.getByRole("button", { name: "Reset diagram zoom", exact: true })).toHaveText("125%");
    await viewport.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    await first.getByRole("button", { name: "Reset diagram zoom", exact: true }).click();
    await first.getByText("Diagram source", { exact: true }).click();
    await expect(first.getByRole("region", { name: "Diagram source code" })).toContainText("flowchart TB");
    await first.getByText("Diagram source", { exact: true }).click();
    await page.reload();
    await expect(images).toHaveCount(2);
    await expect.poll(() => images.first().evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await mkdir("docs/evidence/mermaid", { recursive: true });
    await page.screenshot({ path: `docs/evidence/mermaid/details-${width}.png`, fullPage: true });

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Content", { exact: true }).fill("```mermaid\nthis is not valid mermaid\n```\n\nStill readable.");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(diagrams.getByRole("status")).toContainText("could not be rendered");
    await expect(page.getByRole("region", { name: "Diagram source code" })).toBeVisible();
    await expect(page.getByText("Still readable.", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Content", { exact: true }).fill('```mermaid\n%%{init: {"securityLevel":"loose","flowchart":{"htmlLabels":true}}}%%\nflowchart LR\n A["<img src=x onerror=window.mermaidInjected=true>"] --> B[Safe]\n click B "javascript:window.mermaidInjected=true"\n```');
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(images).toHaveCount(1);
    await expect.poll(() => images.first().evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as any).mermaidInjected)).toBeUndefined();
    await expect(page.locator(".mermaid-diagram script, .mermaid-diagram iframe, .mermaid-diagram svg")).toHaveCount(0);
    const safeSvg = decodeURIComponent((await images.first().getAttribute("src"))!.split(",").slice(1).join(","));
    expect(safeSvg).not.toContain("<foreignObject");
    expect(safeSvg).not.toContain('href="javascript:');
    expect(safeSvg).not.toContain("<script");
  });
}
