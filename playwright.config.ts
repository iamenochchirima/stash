import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  globalTeardown: "./scripts/browser-cleanup.ts",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    headless: true,
  },
  webServer: [
    {
      command: "pnpm exec tsx scripts/verify-server.ts",
      url: "http://127.0.0.1:4100/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command:
        "API_URL=http://127.0.0.1:4100 pnpm --filter @stash/web exec next dev --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
