import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { pdf } from "../pdf-fixture.js";
for (const width of [1440, 375])
  test(`Topics capture and management at ${width}px`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 1000 });
    const headers = { origin: "http://127.0.0.1:3100" };
    expect(
      (
        await page.request.post("/api/auth/signup", {
          headers,
          data: {
            name: "Topic researcher",
            email: `topics-${randomUUID()}@example.test`,
            password: "Research123",
          },
        })
      ).status(),
    ).toBe(201);
    await page.goto("/topics");
    await expect(
      page.getByRole("heading", { name: "No topics yet" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New topic", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Topic name", { exact: true })
      .fill("Field research");
    await dialog
      .getByLabel("Description", { exact: true })
      .fill("Observations and ideas from practical work.");
    await dialog
      .getByRole("button", { name: "Create topic", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Field research", exact: true }),
    ).toBeVisible();
    const topicId = new URL(page.url()).pathname.split("/").at(-1)!;
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Type", { exact: true }).selectOption("idea");
    await dialog
      .getByLabel("Title", { exact: true })
      .fill("Investigate secure agents");
    await dialog
      .getByLabel("Content", { exact: true })
      .fill("Compare the permissions needed by research tools.");
    await expect(
      dialog.getByRole("checkbox", { name: "Field research", exact: false }),
    ).toBeChecked();
    await dialog.getByLabel("Find topics").fill("Security research");
    await dialog
      .getByRole("button", {
        name: "Create topic “Security research”",
        exact: true,
      })
      .click();
    await dialog
      .getByLabel("Topic description", { exact: true })
      .fill("Application and agent security.");
    await dialog
      .getByRole("button", { name: "Create and select topic", exact: true })
      .click();
    await expect(
      dialog.getByRole("checkbox", { name: "Security research", exact: false }),
    ).toBeChecked();
    await dialog
      .getByRole("button", { name: "Save item", exact: true })
      .click();
    await expect(page.locator(".resource-card")).toHaveCount(1);
    const saved = (
      await (await page.request.get(`/api/items?topicId=${topicId}`)).json()
    ).items[0];
    expect(saved.topicIds).toHaveLength(2);
    await page
      .getByRole("link", { name: "Investigate secure agents", exact: true })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Item topics" }).getByRole("link"),
    ).toHaveCount(2);
    await page.getByRole("link", { name: "Back to library" }).click();
    await expect(page).toHaveURL(new RegExp(`/topics/${topicId}$`));
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await expect(page.locator(".library-items")).toHaveAttribute(
      "data-view",
      "grid",
    );
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Type", { exact: true }).selectOption("pdf");
    await dialog.getByLabel("PDF file", { exact: true }).setInputFiles({
      name: "Topic source.pdf",
      mimeType: "application/pdf",
      buffer: pdf(),
    });
    await dialog.getByLabel("Title", { exact: true }).fill("Topic PDF source");
    await dialog
      .getByRole("button", { name: "Save item", exact: true })
      .click();
    await expect(page.locator(".resource-card")).toHaveCount(2);
    const persistedPdf = (
      await (
        await page.request.get(`/api/items?topicId=${topicId}&kind=pdf`)
      ).json()
    ).items[0];
    expect(persistedPdf.topicIds).toEqual([topicId]);
    await page
      .getByRole("button", { name: "Manage topic", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Topic name", { exact: true })
      .fill("Research notebook");
    await dialog
      .getByLabel("Description", { exact: true })
      .fill("Research and source material.");
    await dialog
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Research notebook", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Research notebook", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".resource-card")).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/evidence/topics", { recursive: true });
    await page.screenshot({
      path: `docs/evidence/topics/topic-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Manage topic", exact: true })
      .click();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete topic", exact: true })
      .click();
    await expect(page).toHaveURL(/\/topics$/);
    await expect(
      page
        .locator(".topic-list")
        .getByRole("link", { name: /Security research/ }),
    ).toBeVisible();
    expect((await page.request.get(`/api/items/${saved.id}`)).status()).toBe(
      200,
    );
    const after = (
      await (await page.request.get(`/api/items/${saved.id}`)).json()
    ).item;
    expect(after.topicIds).toHaveLength(1);
    expect(after.topicIds).not.toContain(topicId);
    await page.goto("/library");
    await expect(page.locator(".resource-card")).toHaveCount(2);
    await page.goto(`/topics/${topicId}`);
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add item", exact: true }),
    ).toBeDisabled();
  });
