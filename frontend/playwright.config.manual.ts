import { defineConfig, devices } from "@playwright/test"

const FRONTEND_URL = "http://127.0.0.1:3000"

/**
 * Playwright config for running tests against already running servers.
 * Use this when backend and frontend are already running manually.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
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
  // No webServer - assumes backend and frontend are already running
})
