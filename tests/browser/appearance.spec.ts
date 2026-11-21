import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

const webOrigin = `http://127.0.0.1:${process.env.VERIFY_WEB_PORT ?? 3100}`;

async function expectAccessible(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState === "finished"),
  );
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

test("theme preference persists and System follows the device", async ({
  page,
}) => {
  test.setTimeout(120000);
  const headers = { origin: webOrigin };
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
    "rgb(248, 248, 245)",
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
    "rgb(54, 51, 31)",
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
    "rgb(248, 248, 245)",
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
    "rgb(248, 248, 245)",
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

const lightStyles = [
  { id: "paper", label: "Paper", paper: "rgb(248, 248, 245)" },
  { id: "cool", label: "Cool", paper: "rgb(247, 248, 249)" },
  { id: "warm", label: "Warm", paper: "rgb(250, 247, 241)" },
];

const darkStyles = [
  { id: "forest", label: "Forest", paper: "rgb(21, 25, 22)" },
  { id: "midnight", label: "Midnight", paper: "rgb(16, 20, 27)" },
  { id: "graphite", label: "Graphite", paper: "rgb(20, 20, 20)" },
  { id: "warm", label: "Warm", paper: "rgb(23, 19, 16)" },
];

const accents = [
  { id: "violet", label: "Violet", light: "rgb(107, 82, 201)", dark: "rgb(181, 163, 255)" },
  { id: "indigo", label: "Indigo", light: "rgb(74, 84, 196)", dark: "rgb(170, 179, 255)" },
  { id: "teal", label: "Teal", light: "rgb(15, 111, 102)", dark: "rgb(116, 214, 201)" },
  { id: "clay", label: "Clay", light: "rgb(163, 74, 34)", dark: "rgb(240, 161, 132)" },
  { id: "plum", label: "Plum", light: "rgb(138, 63, 104)", dark: "rgb(229, 162, 197)" },
  { id: "slate", label: "Slate", light: "rgb(71, 85, 105)", dark: "rgb(185, 197, 211)" },
];

test("styles and accents apply, persist and stay accessible", async ({
  page,
}) => {
  test.setTimeout(180000);
  const headers = { origin: webOrigin };
  const signup = await page.request.post("/api/auth/signup", {
    headers,
    data: {
      name: "Style tester",
      email: `styles-${randomUUID()}@example.test`,
      password: "Research123",
    },
  });
  expect(signup.status()).toBe(201);
  const user = (await signup.json()).user;
  const saved = await page.request.post("/api/items", {
    headers: { ...headers, "X-Stash-Account": user.id },
    data: {
      kind: "link",
      url: "https://example.test/style",
      title: "Style reading check",
      notes: "A saved link to check accent colours in the reading view.",
      tags: ["research"],
      collectionIds: [],
      topicIds: [],
    },
  });
  expect(saved.ok()).toBe(true);

  const root = page.locator("html");
  await mkdir("docs/evidence/appearance", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();

  await expect(root).toHaveAttribute("data-theme-style", "paper");
  await expect(root).toHaveAttribute("data-accent", "violet");
  await expect(page.getByRole("button", { name: "Paper", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  for (const style of lightStyles) {
    await page.getByRole("button", { name: style.label, exact: true }).click();
    await expect(root).toHaveAttribute("data-theme-style", style.id);
    await expect(page.locator(".app-layout")).toHaveCSS(
      "background-color",
      style.paper,
    );
    await page.screenshot({
      path: `docs/evidence/appearance/light-style-${style.id}.png`,
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme-style", "forest");
  for (const style of darkStyles) {
    await page.getByRole("button", { name: style.label, exact: true }).click();
    await expect(root).toHaveAttribute("data-theme-style", style.id);
    await expect(page.locator(".app-layout")).toHaveCSS(
      "background-color",
      style.paper,
    );
    await page.screenshot({
      path: `docs/evidence/appearance/dark-style-${style.id}.png`,
      fullPage: true,
    });
  }

  for (const accent of accents) {
    await page.getByRole("button", { name: `${accent.label} accent` }).click();
    await expect(root).toHaveAttribute("data-accent", accent.id);
    await expect(page.locator(".brand-dot")).toHaveCSS("color", accent.dark);
  }
  await page.getByRole("button", { name: "Clay accent" }).click();
  await page
    .locator(".appearance-group", { hasText: "Accent colour" })
    .screenshot({
      path: "docs/evidence/appearance/dark-accent-row.png",
    });
  await expectAccessible(page);
  await page.screenshot({
    path: "docs/evidence/appearance/dark-accent-clay.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Light", exact: true }).click();
  for (const accent of accents) {
    await page.getByRole("button", { name: `${accent.label} accent` }).click();
    await expect(root).toHaveAttribute("data-accent", accent.id);
    await expect(page.locator(".brand-dot")).toHaveCSS("color", accent.light);
  }
  await page.getByRole("button", { name: "Teal accent" }).click();
  await expectAccessible(page);
  await page.screenshot({
    path: "docs/evidence/appearance/light-accent-teal.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Midnight", exact: true }).click();
  await page.getByRole("button", { name: "Clay accent" }).click();

  await page.reload();
  await expect(root).toHaveAttribute("data-theme-style", "midnight");
  await expect(root).toHaveAttribute("data-accent", "clay");
  await expect(page.getByRole("button", { name: "Clay accent" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const otherTab = await page.context().newPage();
  await otherTab.goto("/profile");
  await page.getByRole("button", { name: "Slate accent" }).click();
  await expect(otherTab.locator("html")).toHaveAttribute(
    "data-accent",
    "slate",
  );
  await otherTab.close();

  await page.getByRole("button", { name: "Forest", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(root).toHaveAttribute("data-theme-style", "forest");
  const indigoSwatch = page.getByRole("button", { name: "Indigo accent" });
  await indigoSwatch.focus();
  await expect(indigoSwatch).toBeFocused();
  await page.keyboard.press("Space");
  await expect(root).toHaveAttribute("data-accent", "indigo");
  await expect(indigoSwatch).toHaveAttribute("aria-pressed", "true");

  await page.evaluate(() => localStorage.setItem("stash-accent", "nonsense"));
  await page.reload();
  await expect(root).toHaveAttribute("data-accent", "violet");
  await expect(page.getByRole("button", { name: "Violet accent" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await expectAccessible(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/library");
  await expect(
    page.getByRole("link", { name: "Style reading check" }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Style reading check" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Style reading check" }),
  ).toBeVisible();
  await expectAccessible(page);
});
