import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

test("theme preference persists and System follows the device", async ({
  page,
}) => {
  test.setTimeout(120000);
  const headers = { origin: "http://127.0.0.1:3100" };
  const signup = await page.request.post("/api/auth/signup", {
    headers,
    data: {
      name: "Theme tester",
      email: `appearance-${randomUUID()}@example.test`,
      password: "Research123",
    },
  });
  expect(signup.status()).toBe(201);
  const user = (await signup.json()).user;
  const saved = await page.request.post("/api/items", {
    headers: { ...headers, "X-Stash-Account": user.id },
    data: {
      kind: "idea",
      title: "Dark reading check",
      body: "A saved note to verify the reading view.",
      tags: [],
      collectionIds: [],
      topicIds: [],
    },
  });
  expect(saved.ok()).toBe(true);
  const itemId = (await saved.json()).item.id;

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/library");
  await expect(
    page.getByRole("heading", { name: "Your library" }),
  ).toBeVisible();
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme-preference", "system");
  await expect(page.locator(".app-layout")).toHaveCSS(
    "background-color",
    "rgb(250, 251, 249)",
  );
  const otherTab = await page.context().newPage();
  await otherTab.goto("/library");

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme-preference", "dark");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(otherTab.locator("html")).toHaveAttribute("data-theme", "dark");
  await otherTab.close();
  await expect(page.locator(".app-layout")).toHaveCSS(
    "background-color",
    "rgb(21, 25, 22)",
  );
  await expect(page.locator("input[name=name]")).toHaveCSS(
    "background-color",
    "rgb(29, 36, 31)",
  );
  await expectAccessible(page);
  await mkdir("docs/evidence/appearance", { recursive: true });
  await page.screenshot({
    path: "docs/evidence/appearance/dark-profile.png",
    fullPage: true,
  });

  await page.goto("/projects");
  await expectAccessible(page);
  await expect(page.locator(".project-shell")).toHaveCSS(
    "background-color",
    "rgb(21, 25, 22)",
  );
  await page.goto("/help");
  await expect(
    page.getByRole("region", { name: "Code example", exact: true }),
  ).toHaveCount(2);
  await expectAccessible(page);
  await expect(page.locator(".help-page")).toHaveCSS(
    "background-color",
    "rgb(21, 25, 22)",
  );
  await page.goto(`/items/${itemId}`);
  await expectAccessible(page);
  await expect(
    page.getByRole("heading", { name: "Dark reading check" }),
  ).toBeVisible();
  await expect(page.locator(".item-shell")).toHaveCSS(
    "background-color",
    "rgb(21, 25, 22)",
  );
  await page.goto("/profile");

  await page.reload();
  await expect(root).toHaveAttribute("data-theme-preference", "dark");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".app-layout")).toHaveCSS(
    "background-color",
    "rgb(250, 251, 249)",
  );

  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme-preference", "system");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "docs/evidence/appearance/system-dark-profile.png",
    fullPage: true,
  });

  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".app-layout")).toHaveCSS(
    "background-color",
    "rgb(250, 251, 249)",
  );
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await expectAccessible(page);
  await page.screenshot({
    path: "docs/evidence/appearance/light-profile-mobile.png",
    fullPage: true,
  });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.request.post("/api/auth/logout", { headers });
  await page.goto("/signin");
  await expect(page.locator(".account-page")).toHaveCSS(
    "background-color",
    "rgb(21, 25, 22)",
  );
  await expect(page.locator(".auth-card")).toHaveCSS(
    "background-color",
    "rgb(32, 39, 33)",
  );
  await expectAccessible(page);
});
