import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
test("T16 accessibility of signup, library, save dialog, and profile", async ({
  page,
}) => {
  const reports: unknown[] = [];
  const check = async (name: string) => {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    reports.push({ page: name, violations: result.violations });
    await writeFile(
      "docs/evidence/accessibility.json",
      JSON.stringify(reports, null, 2),
    );
    expect(
      result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  };
  await page.goto("/");
  await check("signup");
  await page.getByLabel("Your name").fill("Accessibility User");
  await page
    .getByLabel("Email address")
    .fill(`axe-${randomUUID()}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create my Stash" }).click();
  await expect(
    page.getByRole("heading", { name: "Your library." }),
  ).toBeVisible();
  await check("library");
  await page
    .getByRole("button", { name: "Save a resource", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await check("save-dialog");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open profile" }).click();
  await check("profile");
  await writeFile(
    "docs/evidence/accessibility.json",
    JSON.stringify(reports, null, 2),
  );
});
