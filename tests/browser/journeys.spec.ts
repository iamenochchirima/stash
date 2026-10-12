import { test, expect, type Page } from "@playwright/test";
import { readdir, readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const password = "Stash123";
async function signup(page: Page) {
  const email = `browser-${randomUUID()}@example.test`;
  await page.goto("/");
  await page.getByRole("link", { name: "Sign up", exact: true }).first().click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.getByLabel("Your name").fill("Browser Researcher");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Your library" }),
  ).toBeVisible();
  return email;
}
async function mailToken(email: string, purpose: "verify" | "reset") {
  const directory = ".data/verification-mail";
  for (let attempt = 0; attempt < 50; attempt++) {
    const messages = await Promise.all(
      (await readdir(directory).catch(() => [])).map(async (file) =>
        JSON.parse(await readFile(`${directory}/${file}`, "utf8")),
      ),
    );
    const message = messages
      .filter(
        (m) =>
          m.to === email &&
          m.subject
            .toLowerCase()
            .includes(purpose === "verify" ? "verify" : "reset"),
      )
      .at(-1);
    if (message)
      return new URL(message.text.match(/https?:\/\/\S+/)[0]).searchParams.get(
        purpose,
      )!;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Development email was not captured.");
}
async function verifyEmail(page: Page, email: string) {
  await page.goto(`/?verify=${await mailToken(email, "verify")}`);
  await page.getByRole("button", { name: "Verify my email" }).click();
  await expect(page.getByText("Your email is verified.")).toBeVisible();
  await page.getByRole("button", { name: "Continue to Stash" }).click();
  await expect(
    page.getByRole("heading", { name: "Your library" }),
  ).toBeVisible();
}
async function save(
  page: Page,
  title = "Research guide",
  url = "https://example.test/research",
) {
  await page
    .getByRole("button", { name: "Save a resource", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Link", { exact: true }).fill(url);
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog
    .getByLabel("Why it matters")
    .fill("Remember the agent memory patterns.");
  await dialog.getByLabel("Tags").fill("agents, memory");
  await dialog.getByLabel("Inbox", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "Save resource", exact: true })
    .click();
  await expect(page.getByRole("link", { name: title })).toBeVisible();
}
test("T15/E01/E06 complete account, library, organization, connections, import/export, and deletion journey", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const email = await signup(page);
  const setup = page.locator("details.onboarding");
  await expect(setup).not.toHaveAttribute("open");
  await setup.getByText("Getting started", { exact: true }).click();
  await expect(setup.getByRole("button", { name: "Save your first resource" })).toBeVisible();
  await setup.getByText("Getting started", { exact: true }).click();
  await expect(setup.getByRole("button", { name: "Save your first resource" })).not.toBeVisible();
  await save(page);
  await verifyEmail(page, email);
  await page
    .getByRole("button", { name: "New collection", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Collection name")
    .fill("Agent research");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create collection" })
    .click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("Agent research", { exact: true }).check();
  await edit.getByLabel("Reading status").selectOption("reading");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.locator("article").getByText("Reading", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search your library").fill("memory");
  await expect(
    page.getByRole("link", { name: "Research guide" }),
  ).toBeVisible();
  await page.getByLabel("Search your library").fill("missing");
  await expect(
    page.getByRole("heading", { name: "No results" }),
  ).toBeVisible();
  await page.getByLabel("Search your library").fill("");
  await page
    .getByRole("button", { name: "Agent research", exact: true })
    .click();
  await page.getByRole("button", { name: "Manage collection" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Collection name")
    .fill("Research projects");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Rename collection" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Research projects" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "All resources" }).click();
  await page.getByRole("button", { name: "Import / export" }).click();
  const transfer = page.getByRole("dialog");
  const downloadPromise = page.waitForEvent("download");
  await transfer.getByRole("button", { name: "Export my library" }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported.resources).toHaveLength(1);
  expect(exported.resources[0].collectionIds).toHaveLength(2);
  await transfer.getByLabel("Choose an import file").setInputFiles({
    name: "bookmarks.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      '<DL><DT><A HREF="https://example.test/imported">Imported article</A><DT><A HREF="javascript:bad">Invalid</A></DL>',
    ),
  });
  await expect(
    transfer.getByText("2 entries · 1 new · 0 duplicates · 1 rejected"),
  ).toBeVisible();
  await transfer.getByRole("button", { name: "Import 1 resources" }).click();
  await expect(
    transfer.getByText("1 saved, 0 duplicates, 1 rejected."),
  ).toBeVisible();
  await transfer.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("link", { name: "Imported article" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Agent connections", exact: true })
    .click();
  await page.getByRole("button", { name: "Create an agent key" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Agent name")
    .fill("Browser test agent");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create key", exact: true })
    .click();
  await expect(page.getByText("Your key is ready.")).toBeVisible();
  await page.getByRole("button", { name: "I’ve saved my key" }).click();
  await expect(
    page.getByText("Awaiting first use", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Revoke Browser test agent" }).click();
  await expect(
    page.getByText("Browser test agent", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "All resources" }).click();
  await save(page, "Temporary resource", "https://example.test/temporary");
  await page
    .locator("article")
    .filter({ has: page.getByRole("link", { name: "Temporary resource" }) })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Temporary resource" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Open profile" }).click();
  const png = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Profile photo")
    .setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: png });
  await expect(page.getByAltText("Your avatar")).toHaveCount(2);
  await page.getByRole("button", { name: "Remove photo", exact: true }).click();
  await expect(page.getByAltText("Your avatar")).toHaveCount(0);
  await page.getByLabel("Name", { exact: true }).fill("Updated Researcher");
  await page.getByLabel("Bio").fill("Building research tools");
  await page.getByLabel("Interests").fill("agents, libraries");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Updated Researcher", exact: true }),
  ).toBeVisible();
  await mkdir("docs/evidence/browser", { recursive: true });
  await page.screenshot({
    path: "docs/evidence/browser/profile-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your library" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Research guide" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Imported article" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/browser/library-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open profile" }).click();
  await page
    .getByRole("button", { name: "Delete account", exact: true })
    .click();
  await page.getByLabel("Current password").fill(password);
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page
    .getByRole("button", { name: "Permanently delete account" })
    .click();
  await expect(
    page.getByRole("link", { name: "Sign up", exact: true }).first(),
  ).toBeVisible();
});
test("T15/E05 browser password recovery and invalid reused links", async ({
  page,
}) => {
  const email = await signup(page);
  await save(page, "Recovery guide");
  await page.getByRole("button", { name: "Open profile" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If that email has an account")).toBeVisible();
  const token = await mailToken(email, "reset");
  await page.goto(`/?reset=${token}`);
  await page.getByLabel("New password").fill("Newpass8");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(page.getByText("Password changed.")).toBeVisible();
  await page.getByRole("button", { name: "Continue to Stash" }).click();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email address").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("Newpass8");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Recovery guide" }),
  ).toBeVisible();
  await page.goto(`/?reset=${token}`);
  await page.getByLabel("New password").fill("yet another long password");
  await page
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect(page.locator('p[role="alert"]')).toContainText(
    "invalid or expired",
  );
});
for (const width of [375, 768])
  test(`T16/E07 responsive layout and keyboard dialog at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await signup(page);
    await save(page, "Mobile research guide");
    await expect(
      page.getByRole("link", { name: "Mobile research guide" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Save a resource", exact: true })
      .first()
      .focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Close dialog" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Save resource", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await mkdir("docs/evidence/browser", { recursive: true });
    await page.screenshot({
      path: `docs/evidence/browser/library-${width}.png`,
      fullPage: true,
    });
  });
test("T12 older search responses cannot replace newer results", async ({
  page,
}) => {
  await signup(page);
  await save(page, "Latest memory guide");
  let arrive!: () => void, release!: () => void, done!: () => void;
  const arrived = new Promise<void>((resolve) => (arrive = resolve)),
    released = new Promise<void>((resolve) => (release = resolve)),
    finished = new Promise<void>((resolve) => (done = resolve));
  await page.route("**/api/resources?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "missing") {
      const response = await route.fetch();
      arrive();
      await released;
      await route.fulfill({ response });
      done();
    } else await route.continue();
  });
  await page.getByLabel("Search your library").fill("missing");
  await arrived;
  await page.getByLabel("Search your library").fill("memory");
  await expect(
    page.getByRole("link", { name: "Latest memory guide" }),
  ).toBeVisible();
  release();
  await finished;
  await expect(
    page.getByRole("link", { name: "Latest memory guide" }),
  ).toBeVisible();
});
