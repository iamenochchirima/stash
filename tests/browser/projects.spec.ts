import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
for (const width of [1440, 375])
  test(`Projects keep research separate and preserve edits at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const headers = { origin: "http://127.0.0.1:3100" };
    const signup = await page.request.post("/api/auth/signup", {
      headers,
      data: {
        name: "Project researcher",
        email: `projects-${randomUUID()}@example.test`,
        password: "Research123",
      },
    });
    expect(signup.status()).toBe(201);
    await page.goto("/");
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page
      .getByRole("button", { name: "New project", exact: true })
      .click();
    await page
      .getByLabel("Project name", { exact: true })
      .fill("A calmer research workflow");
    await page
      .getByLabel("Description", { exact: true })
      .fill("Sources and working notes for our next release.");
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "A calmer research workflow",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Add research", exact: true })
      .click();
    await page.getByLabel("Type", { exact: true }).selectOption("note");
    await page.getByLabel("Title", { exact: true }).fill("Working findings");
    await page
      .getByLabel("Content", { exact: true })
      .fill("## Early findings\n\nKeep the sources close to the reasoning.");
    await page.getByRole("button", { name: "Save item", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Early findings", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByLabel("Content", { exact: true })
      .fill(
        "## Settled finding\n\nKeep research outside product repositories.",
      );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Settled finding", exact: true }),
    ).toBeVisible();
    await page.getByText("Revision history", { exact: true }).click();
    await page.getByRole("button", { name: "Revision 1", exact: true }).click();
    await expect(page.locator(".project-history pre")).toContainText(
      "Early findings",
    );
    await page
      .getByRole("button", { name: "Save to library", exact: true })
      .click();
    await page
      .getByLabel("Excerpt to keep", { exact: true })
      .fill("A useful settled conclusion.");
    await page
      .getByRole("button", { name: "Save library copy", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Open library copy ↗", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Back to project", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: /Working findings/ }),
    ).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/evidence/projects/workspace-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Archive project", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Add research", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Reopen project", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Add research", exact: true }),
    ).toBeEnabled();
    await page.getByRole("link", { name: "All projects", exact: true }).click();
    await page
      .getByRole("link", { name: "Back to library", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Working findings", exact: true })
      .click();
    await expect(
      page.getByText("A useful settled conclusion.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Settled finding", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("link", {
        name: "View original project research ↗",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Settled finding", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Stash home", exact: true }).click();
    await page
      .getByLabel("Search your library")
      .fill("research outside product repositories");
    await expect(
      page.getByRole("link", { name: "Working findings", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Include project research", { exact: true }).check();
    await page
      .getByRole("link", { name: "Working findings", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Settled finding", exact: true }),
    ).toBeVisible();
  });

test("Private project links return after sign-in and hide foreign research", async ({
  page,
  browser,
}) => {
  const headers = { origin: "http://127.0.0.1:3100" },
    email = `project-login-${randomUUID()}@example.test`,
    password = "Research123";
  expect(
    (
      await page.request.post("/api/auth/signup", {
        headers,
        data: { name: "Project owner", email, password },
      })
    ).status(),
  ).toBe(201);
  const p = (
    await (
      await page.request.post("/api/projects", {
        headers,
        data: { name: "Private investigation" },
      })
    ).json()
  ).project;
  const other = await browser.newContext();
  try {
    const foreign = await other.newPage();
    await foreign.goto(`http://127.0.0.1:3100/projects/${p.id}`);
    await expect(foreign).toHaveURL(/\/signin\?next=/);
    await foreign.getByLabel("Email address").fill(email);
    await foreign.getByLabel("Password", { exact: true }).fill(password);
    await foreign.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      foreign.getByRole("heading", {
        name: "Private investigation",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      (
        await other.request.post("http://127.0.0.1:3100/api/auth/signup", {
          headers,
          data: {
            name: "Another researcher",
            email: `project-other-${randomUUID()}@example.test`,
            password,
          },
        })
      ).status(),
    ).toBe(201);
    await foreign.reload();
    await expect(
      foreign.getByRole("heading", { name: "Project not found", exact: true }),
    ).toBeVisible();
    await expect(
      foreign.getByText("Private investigation", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await other.close();
  }
});
