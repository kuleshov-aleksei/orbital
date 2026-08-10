import { app, BrowserWindow, protocol } from "electron"
import log from "electron-log"
import { autoUpdater } from "electron-updater"
import "./platform"
import { getMainWindow, setIsQuitting } from "./state"
import { loadConfig, getConfig } from "./features/config"
import { setupMainProcessLogRelay, flushPendingLogEntries } from "./features/logRelay"
import { setupAppProtocol } from "./features/protocol"
import { createWindow } from "./features/window"
import { createTray } from "./features/tray"
import { setupDeepLink } from "./features/deeplink"
import { setupAutoUpdater } from "./features/update"
import { setupScreenShareHandler } from "./features/screenshare"
import { registerAllHotkeys } from "./features/hotkeys"
import { setupIPC } from "./ipc"

log.transports.file.level = "info"
log.transports.console.level = "debug"

autoUpdater.logger = log

protocol.registerSchemesAsPrivileged([
  {
    scheme: "orbital",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

log.info("Orbital desktop starting...")

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  log.info("Another instance is running, quitting...")
  app.quit()
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    log.info("Second instance detected, focusing main window")
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    const deepLink = commandLine.find((arg) => arg.startsWith("orbital://"))
    if (deepLink) {
      log.info("Deep link from second instance:", deepLink)
      getMainWindow()?.webContents.send("deep-link", deepLink)
    }
  })
}

app.whenReady().then(() => {
  setupMainProcessLogRelay()
  log.info("App ready")
  loadConfig()
  setupAppProtocol()
  createWindow()
  flushPendingLogEntries()
  createTray()
  setupDeepLink()
  setupIPC()
  registerAllHotkeys()
  if (!getConfig().skipUpdates) {
    setupAutoUpdater()
  }
  setupScreenShareHandler()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      getMainWindow()?.show()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("before-quit", () => {
  setIsQuitting(true)
})

process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error)
})

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection:", reason)
})

process.on("SIGTERM", () => {
  log.info("Received SIGTERM, quitting...")
  setIsQuitting(true)
  try {
    app.quit()
  } catch {
    app.exit(0)
  }
})

process.on("SIGINT", () => {
  log.info("Received SIGINT, quitting...")
  setIsQuitting(true)
  try {
    app.quit()
  } catch {
    app.exit(0)
  }
})