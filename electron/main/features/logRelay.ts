import log from "electron-log"
import { getMainWindow } from "../state"

const pendingLogEntries: Array<{ level: string; message: string }> = []
const MAX_PENDING_LOG_ENTRIES = 500

function logToRenderer(level: string, message: string) {
  const formatted = `[${new Date().toISOString()}] ${message}`
  try {
    if (getMainWindow() && !getMainWindow()!.isDestroyed()) {
      getMainWindow()!.webContents.send("main-process-log", level, formatted)
    } else if (pendingLogEntries.length < MAX_PENDING_LOG_ENTRIES) {
      pendingLogEntries.push({ level, message: formatted })
    }
  } catch {
    // Ignore errors sending logs — renderer may not be ready
  }
}

export function flushPendingLogEntries() {
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return
  const entries = pendingLogEntries.splice(0)
  for (const entry of entries) {
    try {
      mainWindow.webContents.send("main-process-log", entry.level, entry.message)
    } catch {
      // Ignore send errors
    }
  }
}

export function setupMainProcessLogRelay() {
  log.hooks.push((entry, _transFn, transName) => {
    // Hooks are called once per transport; forward only once to avoid tripling
    if (transName !== "console") return entry
    const message = entry.data
      .map((arg: unknown) => {
        if (typeof arg === "object") {
          try {
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        }
        return String(arg)
      })
      .join(" ")
    logToRenderer(entry.level, message)
    return entry
  })
}