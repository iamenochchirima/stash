import { defineConfig } from "@playwright/test";
const apiPort = Number(process.env.VERIFY_API_PORT ?? 4100);
const webPort = Number(process.env.VERIFY_WEB_PORT ?? 3100);
const adminPort = Number(process.env.VERIFY_ADMIN_PORT ?? 3101);
export default defineConfig({
  testDir: "tests/browser",
  globalTeardown: "./scripts/browser-cleanup.ts",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    headless: true,
  },
  webServer: [
    {
      command: `VERIFY_API_PORT=${apiPort} VERIFY_WEB_PORT=${webPort} VERIFY_ADMIN_PORT=${adminPort} pnpm exec tsx scripts/verify-server.ts`,
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: `NEXT_DIST_DIR=.next-verification-web API_URL=http://127.0.0.1:${apiPort} pnpm --filter @stash/web exec next dev --hostname 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 60000,
    },
    ...(process.env.VERIFY_SKIP_ADMIN === "true" ? [] : [{
      command: `NEXT_DIST_DIR=.next-verification-admin API_URL=http://127.0.0.1:${apiPort} pnpm --filter @stash/admin exec next dev --hostname 127.0.0.1 --port ${adminPort}`,
      url: `http://127.0.0.1:${adminPort}`,
      reuseExistingServer: false,
      timeout: 60000,
    }]),
  ],
});
