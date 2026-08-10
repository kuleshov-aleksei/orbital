import { app, ipcMain, shell } from "electron"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import log from "electron-log"
import { __dirname, VITE_DEV_SERVER_URL } from "../paths"
import { isWayland } from "../platform"

export function registerSystemIpc() {
  ipcMain.handle("get-platform", () => {
    return process.platform
  })

  ipcMain.handle("get-system-info", () => {
    return {
      platform: process.platform,
      electronVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      osType: os.type(),
      osRelease: os.release(),
      osVersion: os.version(),
      osArch: os.arch(),
      desktopEnvironment:
        process.env.XDG_CURRENT_DESKTOP ||
        process.env.XDG_SESSION_DESKTOP ||
        process.env.DESKTOP_SESSION ||
        "",
      wayland: isWayland,
      appVersion: app.getVersion(),
    }
  })

  ipcMain.handle("get-is-wayland", () => {
    return isWayland
  })

  ipcMain.handle("open-external", async (_, url: string) => {
    log.info("Opening external URL:", url)
    try {
      await shell.openExternal(url)
      return true
    } catch (error) {
      log.error("Error opening external URL:", error)
      throw error
    }
  })

  ipcMain.handle("get-licenses", async () => {
    try {
      const licensesPath = app.isPackaged
        ? path.join(process.resourcesPath, "build", "licenses.json")
        : path.join(__dirname, "../..", "build", "licenses.json")

      const content = fs.readFileSync(licensesPath, "utf-8")
      return JSON.parse(content)
    } catch (error) {
      log.error("Error getting licenses:", error)
      return []
    }
  })
}