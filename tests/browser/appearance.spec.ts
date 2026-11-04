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

  await page.goto("/library");
  await expect(
    page.getByRole("link", { name: "Dark reading check", exact: true }),
  ).toBeVisible();
  const setup = page.locator("details.onboarding");
  await setup.getByText("Getting started", { exact: true }).click();
  await expect(setup).toHaveAttribute("open", "");
  await expect(setup).toHaveCSS("max-width", "620px");
  await expect(setup).toHaveCSS("border-top-width", "1px");
  await expect(setup).toHaveCSS("border-top-left-radius", "12px");
  await expect(setup).toHaveCSS("padding-left", "18px");
  await expect(setup).toHaveCSS("background-color", "rgb(32, 39, 33)");
  await expect(page.locator(".verification-banner")).toHaveCSS(
    "background-color",
    "rgb(51, 43, 29)",
  );
  await expect(page.locator(".search-field")).toHaveCSS(
    "background-color",
    "rgb(29, 36, 31)",
  );
  await expect(page.locator(".search-field")).toHaveCSS(
    "border-top-color",
    "rgb(66, 76, 68)",
  );
  await expect(page.locator(".search-field input")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await page.screenshot({
    path: "docs/evidence/appearance/dark-library.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });

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
  await page.setViewportSize({ width: 1440, height: 1000 });
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
  const cardStyle = await page.locator(".auth-card").evaluate((card) => {
    const style = getComputedStyle(card);
    const panel = document.querySelector(".account-panel")!;
    return {
      padding: Number.parseFloat(style.paddingLeft),
      borderWidth: Number.parseFloat(style.borderTopWidth),
      borderRadius: Number.parseFloat(style.borderTopLeftRadius),
      sideInset:
        (panel.getBoundingClientRect().width -
          card.getBoundingClientRect().width) /
        2,
    };
  });
  expect(cardStyle.padding).toBeGreaterThanOrEqual(30);
  expect(cardStyle.borderWidth).toBe(1);
  expect(cardStyle.borderRadius).toBeGreaterThan(12);
  expect(cardStyle.sideInset).toBeGreaterThan(100);
  await expectAccessible(page);
  await page.screenshot({
    path: "docs/evidence/appearance/dark-signin.png",
    fullPage: true,
  });

  await page.goto("/signup");
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({
    path: "docs/evidence/appearance/dark-signup.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  const mobilePadding = await page
    .locator(".auth-card")
    .evaluate((card) => Number.parseFloat(getComputedStyle(card).paddingLeft));
  expect(mobilePadding).toBeGreaterThanOrEqual(20);
  await expectAccessible(page);
  await page.screenshot({
    path: "docs/evidence/appearance/dark-signup-mobile.png",
    fullPage: true,
  });
});
