import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, desktopCapturer, shell } from "electron"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"
import http from "node:http"
import log from "electron-log"
import { autoUpdater } from "electron-updater"
import { hasVenmic, hasPipeWire, listAudioSources, startAudioCapture, stopAudioCapture } from "./venmic"

//app.commandLine.appendSwitch("disable-gpu")
//app.commandLine.appendSwitch("disable-software-rasterizer")

app.commandLine.appendSwitch("webrtc-max-cpu-consumption-percentage", "100")
app.commandLine.appendSwitch("max-gum-fps", "120")
app.commandLine.appendSwitch("webrtc-max-capture-framerate", "120")

app.commandLine.appendSwitch("ozone-platform", "wayland")
app.commandLine.appendSwitch("enable-zero-copy")
app.commandLine.appendSwitch("use-gl", "angle")
app.commandLine.appendSwitch("use-vulkan", "--disable-reading-from-canvas")
app.commandLine.appendSwitch("enable-raw-draw")
app.commandLine.appendSwitch("enable-gpu-rasterization")
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers")
app.commandLine.appendSwitch("enable-accelerated-2d-canvas")
app.commandLine.appendSwitch("enable-accelerated-video-decode")
app.commandLine.appendSwitch("enable-accelerated-mjpeg-decode")
app.commandLine.appendSwitch("disable-gpu-vsync")
app.commandLine.appendSwitch("enable-gpu-compositing")
app.commandLine.appendSwitch("enable-features", "PipeWireCapturer")

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, "../..")

export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron")
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist")
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

log.transports.file.level = "info"
log.info("Orbital desktop starting...")

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  log.info("Another instance is running, quitting...")
  app.quit()
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    log.info("Second instance detected, focusing main window")
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
    const deepLink = commandLine.find((arg) => arg.startsWith("orbital://"))
    if (deepLink) {
      log.info("Deep link from second instance:", deepLink)
      mainWindow?.webContents.send("deep-link", deepLink)
    }
  })
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

const preload = path.join(__dirname, "../preload/index.js")
const indexHtml = path.join(RENDERER_DIST, "index.html")

function createWindow() {
  const iconPath = path.join(process.env.APP_ROOT, "build", "orbital-icon.png")
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Orbital",
    backgroundColor: "#1a1a1a",
    icon: iconPath,
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

    // Handle any pending deep links
    if (pendingDeepLink) {
      log.info("Processing pending deep link:", pendingDeepLink)
      mainWindow?.webContents.send("deep-link", pendingDeepLink)
      pendingDeepLink = null
    }
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
    ? path.join(__dirname, "../../build/orbital-icon.png")
    : path.join(process.resourcesPath, "build/orbital-icon.png")

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
  log.info("Setting up deep link handler for orbital:// protocol")

  // Register as protocol handler - this is needed for production builds
  // In dev mode, electron handles this differently
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("orbital", process.execPath, [process.argv[1]])
      log.info("Registered as protocol handler (dev mode with exec path)")
    }
  } else {
    app.setAsDefaultProtocolClient("orbital")
    log.info("Registered as protocol handler (production mode)")
  }

  // Handle deep link on macOS via open-url event
  app.on("open-url", (event, url) => {
    event.preventDefault()
    log.info("Deep link received via open-url:", url)
    handleDeepLink(url)
  })

  // Handle deep link from command line arguments (Linux/Windows)
  // This handles the case when app is already running and a deep link is triggered
  const deepLinkArg = process.argv.find((arg) => arg.startsWith("orbital://"))
  if (deepLinkArg) {
    log.info("Deep link found in command line:", deepLinkArg)
    // Delay handling slightly to ensure window is ready
    setTimeout(() => handleDeepLink(deepLinkArg), 1000)
  }
}

function handleDeepLink(url: string) {
  if (!url.startsWith("orbital://")) {
    log.warn("Invalid deep link URL:", url)
    return
  }

  log.info("Handling deep link:", url)

  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send("deep-link", url)
  } else {
    log.warn("Main window not available, queuing deep link")
    // Store for later when window is created
    pendingDeepLink = url
  }
}

let pendingDeepLink: string | null = null

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
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      log.error("Auto updater check failed:", error)
    })
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

  ipcMain.handle("venmic:has-venmic", () => {
    console.log("[IPC] venmic:has-venmic called")
    const result = hasVenmic()
    console.log("[IPC] venmic:has-venmic result:", result)
    return result
  })
  ipcMain.handle("venmic:has-pipewire", () => {
    console.log("[IPC] venmic:has-pipewire called")
    const result = hasPipeWire()
    console.log("[IPC] venmic:has-pipewire result:", result)
    return result
  })
  ipcMain.handle("venmic:list-sources", () => {
    console.log("[IPC] venmic:list-sources called")
    return listAudioSources()
  })
  ipcMain.handle("venmic:start", (_, include) => {
    console.log("[IPC] venmic:start called with:", JSON.stringify(include))
    return startAudioCapture(include)
  })
  ipcMain.handle("venmic:stop", () => {
    console.log("[IPC] venmic:stop called")
    return stopAudioCapture()
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

  ipcMain.handle("oauth-authenticate", async () => {
    log.info("[OAuth] Starting OAuth authentication flow")

    try {
      await startOAuthCallbackServer()
      return { port: OAUTH_CALLBACK_PORT }
    } catch (error) {
      log.error("[OAuth] Failed to start callback server:", error)
      throw error
    }
  })

  ipcMain.handle("oauth-callback", async (_, token: string) => {
    log.info("[OAuth] Token received from callback")

    if (oauthCallbackResolve) {
      oauthCallbackResolve(token)
      oauthCallbackResolve = null
    }

    stopOAuthCallbackServer()
    return true
  })
}

const OAUTH_CALLBACK_PORT = 27271
let oauthCallbackServer: http.Server | null = null

function startOAuthCallbackServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (oauthCallbackServer) {
      oauthCallbackServer.close()
    }

    oauthCallbackServer = http.createServer((req, res) => {
      const fullUrl = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}${req.url || "/"}`
      log.info("[OAuth] Full callback URL:", fullUrl)

      const url = new URL(req.url || "/", `http://127.0.0.1:${OAUTH_CALLBACK_PORT}`)
      log.info("[OAuth] Parsed pathname:", url.pathname)
      log.info("[OAuth] Search params:", url.searchParams.toString())
      log.info("[OAuth] Token:", url.searchParams.get("token"))

      const pathname = url.pathname.replace(/\/$/, "") // Remove trailing slash
      if (pathname === "/callback") {
        const token = url.searchParams.get("token")
        const expires = url.searchParams.get("expires")

        log.info("[OAuth] Token found:", token !== null)
        log.info("[OAuth] Expires found:", expires !== null)

        if (token) {
          res.writeHead(200, { "Content-Type": "text/html" })
          res.end(`
            <html>
              <body>
                <h1>Authentication Successful!</h1>
                <p>You can close this window and return to Orbital.</p>
                <script>
                  setTimeout(() => window.close(), 2000)
                </script>
              </body>
            </html>
          `)

          if (mainWindow) {
            mainWindow.webContents.send("oauth-token", { token, expires })
            log.info("[OAuth] Token sent to renderer")
          }

          setTimeout(() => {
            oauthCallbackServer?.close()
            oauthCallbackServer = null
          }, 1000)
        } else {
          res.writeHead(400, { "Content-Type": "text/html" })
          res.end("<h1>Authentication Failed</h1><p>No token received.</p>")
        }
      } else {
        res.writeHead(404, { "Content-Type": "text/html" })
        res.end("<h1>Not Found</h1>")
      }
    })

    oauthCallbackServer.on("error", (err: Error) => {
      log.error("[OAuth] Server error:", err)
      reject(err)
    })

    oauthCallbackServer.listen(OAUTH_CALLBACK_PORT, "127.0.0.1", () => {
      log.info(`[OAuth] Callback server started on http://127.0.0.1:${OAUTH_CALLBACK_PORT} and http://localhost:${OAUTH_CALLBACK_PORT}`)
      resolve()
    })
  })
}

function stopOAuthCallbackServer() {
  if (oauthCallbackServer) {
    oauthCallbackServer.close()
    oauthCallbackServer = null
    log.info("[OAuth] Callback server stopped")
  }
}

export { startOAuthCallbackServer, stopOAuthCallbackServer, OAUTH_CALLBACK_PORT }

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
