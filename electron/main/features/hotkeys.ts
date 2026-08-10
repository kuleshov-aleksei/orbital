import { globalShortcut } from "electron"
import log from "electron-log"
import { getMainWindow } from "../state"
import { getConfig } from "./config"

let registeredAccelerators: {
  mute: string | null
  deafen: string | null
  ptt: string | null
} = {
  mute: null,
  deafen: null,
  ptt: null,
}

let hotkeysPaused = false

export function registerAllHotkeys() {
  globalShortcut.unregisterAll()
  registeredAccelerators = { mute: null, deafen: null, ptt: null }

  const { mute, deafen, ptt } = getConfig().hotkeys

  if (mute.enabled && mute.accelerator) {
    if (registeredAccelerators.mute && registeredAccelerators.mute !== mute.accelerator) {
      globalShortcut.unregister(registeredAccelerators.mute)
    }
    try {
      globalShortcut.register(mute.accelerator, () => {
        log.info("[Hotkey] Mute triggered")
        getMainWindow()?.webContents.send("hotkey-triggered", "mute")
      })
      registeredAccelerators.mute = mute.accelerator
      log.info("[Hotkey] Registered mute:", mute.accelerator)
    } catch (e) {
      log.error("[Hotkey] Failed to register mute:", e)
    }
  } else if (registeredAccelerators.mute) {
    globalShortcut.unregister(registeredAccelerators.mute)
    registeredAccelerators.mute = null
  }

  if (deafen.enabled && deafen.accelerator) {
    if (registeredAccelerators.deafen && registeredAccelerators.deafen !== deafen.accelerator) {
      globalShortcut.unregister(registeredAccelerators.deafen)
    }
    try {
      globalShortcut.register(deafen.accelerator, () => {
        log.info("[Hotkey] Deafen triggered")
        getMainWindow()?.webContents.send("hotkey-triggered", "deafen")
      })
      registeredAccelerators.deafen = deafen.accelerator
      log.info("[Hotkey] Registered deafen:", deafen.accelerator)
    } catch (e) {
      log.error("[Hotkey] Failed to register deafen:", e)
    }
  } else if (registeredAccelerators.deafen) {
    globalShortcut.unregister(registeredAccelerators.deafen)
    registeredAccelerators.deafen = null
  }

  if (ptt.enabled && ptt.accelerator) {
    if (registeredAccelerators.ptt && registeredAccelerators.ptt !== ptt.accelerator) {
      globalShortcut.unregister(registeredAccelerators.ptt)
    }
    try {
      globalShortcut.register(ptt.accelerator, () => {
        log.info("[Hotkey] PTT triggered")
        getMainWindow()?.webContents.send("hotkey-triggered", "ptt-pressed")
      })
      registeredAccelerators.ptt = ptt.accelerator
      log.info("[Hotkey] Registered PTT:", ptt.accelerator)
    } catch (e) {
      log.error("[Hotkey] Failed to register PTT:", e)
    }
  } else if (registeredAccelerators.ptt) {
    globalShortcut.unregister(registeredAccelerators.ptt)
    registeredAccelerators.ptt = null
  }
}

export function unregisterAllHotkeys() {
  globalShortcut.unregisterAll()
  registeredAccelerators = { mute: null, deafen: null, ptt: null }
  log.info("[Hotkey] Unregistered all hotkeys")
}

export function pauseHotkeys(): boolean {
  unregisterAllHotkeys()
  hotkeysPaused = true
  log.info("[Hotkey] Hotkeys paused")
  return true
}

export function resumeHotkeys(): boolean {
  hotkeysPaused = false
  registerAllHotkeys()
  log.info("[Hotkey] Hotkeys resumed")
  return true
}