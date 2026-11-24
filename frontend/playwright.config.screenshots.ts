import { defineConfig } from "@playwright/test"
import base from "./playwright.config"

// The @screenshot specs against a demo server that is already running
// (make screenshots-seed starts one). Unlike the main config, it starts no
// servers of its own: SEED_BACKEND_URL / SEED_FRONTEND_URL point at it.
export default defineConfig({
  ...base,
  grep: /@screenshot/,
  reporter: [["list"]],
  webServer: undefined,
  use: {
    ...base.use,
    baseURL: process.env.SEED_FRONTEND_URL ?? "http://127.0.0.1:3000",
  },
})
