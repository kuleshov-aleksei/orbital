import { ipcMain } from "electron"
import { VITE_DEV_SERVER_URL } from "../paths"
import { checkForUpdates, installUpdate } from "../features/update"
import { applyPendingOta, confirmOtaBoot, getOtaStatus } from "../features/ota"

export function registerUpdateIpc() {
  ipcMain.handle("check-for-updates", async () => {
    if (!VITE_DEV_SERVER_URL) {
      return checkForUpdates()
    }
    return null
  })

  ipcMain.handle("install-update", () => {
    installUpdate()
  })

  // Over-the-air frontend updates (features/ota.ts).
  ipcMain.handle("ota:status", () => getOtaStatus())
  ipcMain.handle("ota:apply", () => applyPendingOta())
  ipcMain.handle("ota:confirm-boot", () => confirmOtaBoot())
}
