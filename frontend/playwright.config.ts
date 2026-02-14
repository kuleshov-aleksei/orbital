import { defineConfig, devices } from "@playwright/test"

const FRONTEND_URL = "http://127.0.0.1:3000"
const BACKEND_URL = "http://127.0.0.1:8080"

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  // Backend is an in-memory singleton on :8080; tests reset shared state.
  // Run serially to avoid cross-test interference.
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
      command: "go run ./cmd/server",
      cwd: "../backend",
      url: `${BACKEND_URL}/api/health`,
      // Do not reuse a manually started backend on :8080.
      // E2E expects test-only endpoints and a clean in-memory state.
      reuseExistingServer: false,
      env: {
        ...process.env,
        ORBITAL_E2E: "1",
      },
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 3000",
      cwd: ".",
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
