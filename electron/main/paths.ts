import { app } from "electron"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"

const getModuleUrl = (): string => {
  if (typeof import.meta !== "undefined" && import.meta.url && import.meta.url !== "undefined") {
    return import.meta.url
  }
  return `file://${path.join(app.getAppPath(), "dist-electron/main/index.js")}`
}

const moduleUrl = getModuleUrl()
export const require = createRequire(moduleUrl)
export const __dirname = path.dirname(fileURLToPath(moduleUrl))

process.env.APP_ROOT = path.join(__dirname, "../..")

export const APP_ROOT = process.env.APP_ROOT
export const MAIN_DIST = path.join(APP_ROOT, "dist-electron")
export const RENDERER_DIST = path.join(APP_ROOT, "dist")
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

export const preloadPath = path.join(__dirname, "../preload/index.js")
export const indexHtmlPath = path.join(RENDERER_DIST, "index.html")