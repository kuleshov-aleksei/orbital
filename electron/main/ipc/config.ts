import { ipcMain } from "electron"
import log from "electron-log"
import {
  getConfig,
  setCloseToTray,
  setHasSelectedCloseBehavior,
  setHotkeys,
  resetHotkeys,
} from "../features/config"
import { registerAllHotkeys, pauseHotkeys, resumeHotkeys } from "../features/hotkeys"

export function registerConfigIpc() {
  ipcMain.handle("get-close-to-tray", () => {
    return getConfig().closeToTray
  })

  ipcMain.handle("set-close-to-tray", (_, value: boolean) => {
    setCloseToTray(value)
  })

  ipcMain.handle("has-selected-close-behavior", () => {
    return getConfig().hasSelectedCloseBehavior
  })

  ipcMain.handle("set-has-selected-close-behavior", (_, value: boolean) => {
    setHasSelectedCloseBehavior(value)
  })

  ipcMain.handle("get-hotkeys", () => {
    return getConfig().hotkeys
  })

  ipcMain.handle("set-hotkeys", (_, hotkeys: ReturnType<typeof getConfig>["hotkeys"]) => {
    log.info("[IPC] set-hotkeys called:", JSON.stringify(hotkeys))
    try {
      setHotkeys(hotkeys)
      registerAllHotkeys()
    } catch (e) {
      log.error("[IPC] set-hotkeys error:", e)
    }
  })

  ipcMain.handle("reset-hotkeys", () => {
    resetHotkeys()
    registerAllHotkeys()
  })

  ipcMain.handle("pause-hotkeys", () => {
    pauseHotkeys()
    return { requiresRestart: false }
  })

  ipcMain.handle("resume-hotkeys", () => {
    resumeHotkeys()
    return { requiresRestart: false }
  })
}