import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, desktopCapturer, shell } from "electron"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"
import log from "electron-log"
import { autoUpdater } from "electron-updater"

app.commandLine.appendSwitch("disable-gpu")
app.commandLine.appendSwitch("disable-software-rasterizer")

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, "../..")

export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron")
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist")
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

log.transports.file.level = "info"
log.info("Orbital desktop starting...")

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

const preload = path.join(__dirname, "../preload/index.js")
const indexHtml = path.join(RENDERER_DIST, "index.html")

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Orbital",
    backgroundColor: "#1a1a1a",
    show: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show()
    log.info("Main window shown")
  })

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(indexHtml)
  }

  log.info("Window created, loading content...")
}

function createTray() {
  const iconPath = VITE_DEV_SERVER_URL
    ? path.join(__dirname, "../../build/icon.png")
    : path.join(process.resourcesPath, "build/icon.png")

  let trayIcon: nativeImage
  try {
    trayIcon = nativeImage.createFromPath(iconPath)
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty()
    }
  } catch {
    trayIcon = nativeImage.createEmpty()
  }

  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Orbital",
      click: () => {
        mainWindow?.show()
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setToolTip("Orbital")
  tray.setContextMenu(contextMenu)

  tray.on("click", () => {
    mainWindow?.show()
  })
}

function setupDeepLink() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("orbital", process.execPath, [process.argv[1]])
    }
  } else {
    app.setAsDefaultProtocolClient("orbital")
  }

  app.on("open-url", (event, url) => {
    event.preventDefault()
    log.info("Deep link received:", url)
    if (mainWindow) {
      mainWindow.webContents.send("deep-link", url)
    }
  })
}

function setupAutoUpdater() {
  autoUpdater.logger = log
  autoUpdater.autoDownload = false

  autoUpdater.on("update-available", (info) => {
    log.info("Update available:", info.version)
    mainWindow?.webContents.send("update-available", info)
  })

  autoUpdater.on("update-downloaded", (info) => {
    log.info("Update downloaded:", info.version)
    mainWindow?.webContents.send("update-downloaded", info)
  })

  autoUpdater.on("error", (error) => {
    log.error("Auto updater error:", error)
  })

  if (!VITE_DEV_SERVER_URL) {
    autoUpdater.checkForUpdatesAndNotify()
  }
}

function setupIPC() {
  ipcMain.handle("get-desktop-sources", async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["window", "screen"],
        thumbnailSize: { width: 320, height: 180 },
      })

      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        display_id: source.display_id,
      }))
    } catch (error) {
      log.error("Error getting desktop sources:", error)
      throw error
    }
  })

  ipcMain.handle("check-for-updates", async () => {
    if (!VITE_DEV_SERVER_URL) {
      return autoUpdater.checkForUpdates()
    }
    return null
  })

  ipcMain.handle("install-update", () => {
    isQuitting = true
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle("minimize-window", () => {
    mainWindow?.minimize()
  })

  ipcMain.handle("maximize-window", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.handle("close-window", () => {
    mainWindow?.hide()
  })

  ipcMain.handle("get-platform", () => {
    return process.platform
  })
}

app.whenReady().then(() => {
  log.info("App ready")
  createWindow()
  createTray()
  setupDeepLink()
  setupIPC()
  setupAutoUpdater()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("before-quit", () => {
  isQuitting = true
})

process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error)
})

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection:", reason)
})
