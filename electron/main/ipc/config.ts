import { ipcMain } from "electron"
import log from "electron-log"
import { isWayland } from "../platform"
import {
  getConfig,
  setCloseToTray,
  setHasSelectedCloseBehavior,
  setHotkeys,
  resetHotkeys,
} from "../features/config"
import { registerAllHotkeys, pauseHotkeys, resumeHotkeys, getHotkeyBackend } from "../features/hotkeys"

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

  ipcMain.handle("set-hotkeys", async (_, hotkeys: ReturnType<typeof getConfig>["hotkeys"]) => {
    log.info("[IPC] set-hotkeys called:", JSON.stringify(hotkeys))
    try {
      setHotkeys(hotkeys)
      // On KDE/Plasma we register with kglobalaccel directly over D-Bus, which
      // re-registers live — no restart needed. On other Wayland desktops the
      // GlobalShortcuts portal is consent-gated: kglobalacceld owns the
      // binding after the "Global Shortcut Requested" dialog, so live
      // re-registration tears down the session against a binding the DE still
      // holds, leaving stale or broken shortcuts. Persist only and require a
      // restart there.
      if (await getHotkeyBackend() === "kglobalaccel") {
        await registerAllHotkeys()
        return { requiresRestart: false }
      }
      if (!isWayland) {
        await registerAllHotkeys()
      }
      return { requiresRestart: isWayland }
    } catch (e) {
      log.error("[IPC] set-hotkeys error:", e)
      return { requiresRestart: false }
    }
  })

  ipcMain.handle("reset-hotkeys", async () => {
    resetHotkeys()
    if (await getHotkeyBackend() === "kglobalaccel") {
      await registerAllHotkeys()
      return { requiresRestart: false }
    }
    if (!isWayland) {
      await registerAllHotkeys()
    }
    return { requiresRestart: isWayland }
  })

  ipcMain.handle("pause-hotkeys", async () => {
    await pauseHotkeys()
    return { requiresRestart: false }
  })

  ipcMain.handle("resume-hotkeys", async () => {
    await resumeHotkeys()
    return { requiresRestart: false }
  })
}
