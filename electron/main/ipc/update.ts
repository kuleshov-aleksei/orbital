import { ipcMain } from "electron"
import log from "electron-log"
import { autoUpdater } from "electron-updater"
import { VITE_DEV_SERVER_URL } from "../paths"
import { installUpdate } from "../features/update"

export function registerUpdateIpc() {
  ipcMain.handle("check-for-updates", async () => {
    if (!VITE_DEV_SERVER_URL) {
      return autoUpdater.checkForUpdates()
    }
    return null
  })

  ipcMain.handle("install-update", () => {
    installUpdate()
  })
}