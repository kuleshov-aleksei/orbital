import { defineConfig, devices } from "@playwright/test"

const FRONTEND_URL = "http://127.0.0.1:3000"
const BACKEND_URL = "http://127.0.0.1:8080"

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  // Backend is a fresh single-tenant server on :8080 (dedicated e2e DB, wiped
  // each run). Run serially to avoid cross-test interference.
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html"]] : [["list"], ["html"]],
  use: {
    baseURL: FRONTEND_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--no-sandbox",
          ],
        },
      },
    },
  ],
  webServer: [
    {
      // E2E uses a dedicated SQLite DB that is wiped before each run so the
      // first registered user deterministically becomes super_admin (needed
      // for admin-gated room create/delete) and real dev data stays untouched.
      command:
        "sh -c 'rm -f data/orbital-e2e.db data/orbital-e2e.db-* && DATABASE_PATH=data/orbital-e2e.db go run ./cmd/server'",
      cwd: "../backend",
      url: `${BACKEND_URL}/api/health`,
      reuseExistingServer: false,
    },
    {
      command: "pnpm run dev -- --host 127.0.0.1 --port 3000",
      cwd: ".",
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
