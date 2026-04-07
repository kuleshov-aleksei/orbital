import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, desktopCapturer, shell, dialog, globalShortcut } from "electron"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import crypto from "node:crypto"
import log from "electron-log"
import { autoUpdater } from "electron-updater"

log.transports.file.level = "info"
log.transports.console.level = "debug"

autoUpdater.logger = log

import { hasVenmic, hasPipeWire, listAudioSources, startAudioCapture, stopAudioCapture } from "./venmic"

//app.commandLine.appendSwitch("disable-gpu")
//app.commandLine.appendSwitch("disable-software-rasterizer")

app.commandLine.appendSwitch("webrtc-max-cpu-consumption-percentage", "100")
app.commandLine.appendSwitch("max-gum-fps", "120")
app.commandLine.appendSwitch("webrtc-max-capture-framerate", "120")

app.commandLine.appendSwitch("ozone-platform", "wayland")
app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal,PipeWireCapturer")
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

const getModuleUrl = (): string => {
  if (typeof import.meta !== "undefined" && import.meta.url && import.meta.url !== "undefined") {
    return import.meta.url
  }
  const appPath = app.isPackaged ? app.getAppPath() : path.join(__dirname, "../..")
  return `file://${path.join(appPath, "dist-electron/main/index.js")}`
}

const moduleUrl = getModuleUrl()
const require = createRequire(moduleUrl)
const __dirname = path.dirname(fileURLToPath(moduleUrl))

process.env.APP_ROOT = path.join(__dirname, "../..")

export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron")
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist")
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface HotkeySetting {
  enabled: boolean
  accelerator: string
}

interface AppConfig {
  closeToTray: boolean
  hasSelectedCloseBehavior: boolean
  hotkeys: {
    mute: HotkeySetting
    deafen: HotkeySetting
    ptt: HotkeySetting
  }
}

const DEFAULT_HOTKEYS: AppConfig["hotkeys"] = {
  mute: { enabled: false, accelerator: "CommandOrControl+M" },
  deafen: { enabled: false, accelerator: "CommandOrControl+D" },
  ptt: { enabled: false, accelerator: "CommandOrControl+Space" },
}

const DEFAULT_CONFIG: AppConfig = {
  closeToTray: true,
  hasSelectedCloseBehavior: false,
  hotkeys: DEFAULT_HOTKEYS,
}

let config: AppConfig = { ...DEFAULT_CONFIG }
let hotkeysPaused = false

const isWayland = process.platform === "linux" && 
  (process.env.XDG_SESSION_TYPE === "wayland" || 
   process.env.WAYLAND_DISPLAY !== undefined ||
   process.argv.includes("--ozone-platform=wayland"))

log.info("[Platform] Running on Wayland:", isWayland)

function getConfigPath(): string {
  const configDir = app.getPath("userData")
  return path.join(configDir, "config.json")
}

function loadConfig(): void {
  try {
    const configPath = getConfigPath()
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf-8")
      config = { ...DEFAULT_CONFIG, ...JSON.parse(data) }
      log.info("Config loaded from:", configPath)
    } else {
      log.info("No config file found, using defaults")
    }
  } catch (e) {
    log.warn("Failed to load config:", e)
  }
}

function saveConfig(): void {
  try {
    const configPath = getConfigPath()
    const configDir = path.dirname(configPath)
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    log.info("Config saved to:", configPath)
  } catch (e) {
    log.error("Failed to save config:", e)
  }
}

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
let updateCheckInProgress = false

interface CachedUpdateState {
  status: "idle" | "checking" | "downloading" | "ready" | "error"
  version?: string
  percent?: number
  error?: string
  pendingEvent?: string
  pendingData?: unknown
}

let cachedUpdateState: CachedUpdateState = { status: "idle" }

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
    if (updateCheckInProgress) {
      log.info("[Update] Window ready but update check in progress, deferring show")
    } else {
      mainWindow?.show()
      log.info("Main window shown")
    }

    if (pendingDeepLink) {
      log.info("Processing pending deep link:", pendingDeepLink)
      mainWindow?.webContents.send("deep-link", pendingDeepLink)
      pendingDeepLink = null
    }

    replayCachedEvents()
  })

  mainWindow.on("close", async (event) => {
    if (!isQuitting) {
      event.preventDefault()

      if (!config.hasSelectedCloseBehavior) {
        const shouldHide = await dialog.showMessageBox(mainWindow!, {
          type: "question",
          buttons: ["Hide to Tray", "Quit"],
          defaultId: 0,
          cancelId: -1,
          title: "Close Orbital",
          message: "What would you like to do?",
          detail: "You can choose to hide Orbital to the system tray or quit the application completely.",
        })

        if (shouldHide.response === -1) {
          return
        }

        config.closeToTray = shouldHide.response === 0
        config.hasSelectedCloseBehavior = true
        saveConfig()
      }

      if (config.closeToTray) {
        mainWindow?.hide()
      } else {
        isQuitting = true
        app.quit()
      }
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

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http
    client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.location) {
        fetchUrl(res.location).then(resolve).catch(reject)
        return
      }
      let data = ""
      res.on("data", (chunk) => (data += chunk))
      res.on("end", () => resolve(data))
    }).on("error", reject)
  })
}

function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    const file = require("fs").createReadStream(filePath)
    file.on("data", (chunk: Buffer) => hash.update(chunk))
    file.on("end", () => resolve(hash.digest("base64")))
    file.on("error", reject)
  })
}

async function verifyUpdateHash(updateInfo: UpdateInfo, installerPath: string): Promise<boolean> {
  const version = updateInfo.version

  log.info(`[Update] Verifying hash for version ${version}`)
  log.info(`[Update] Installer path: ${installerPath}`)

  const expectedHash = await fetchExpectedHashFromRelease(version)
  if (!expectedHash) {
    log.warn("[Update] Could not fetch expected hash, skipping verification")
    return true
  }

  log.info(`[Update] Expected hash (from GitHub): ${expectedHash}`)

  const actualHash = await calculateFileHash(installerPath)
  log.info(`[Update] Actual hash (calculated): ${actualHash}`)

  if (expectedHash === actualHash) {
    log.info("[Update] Hash verification PASSED")
    return true
  } else {
    log.error("[Update] Hash verification FAILED - hashes do not match!")
    return false
  }
}

async function fetchExpectedHashFromRelease(version: string): Promise<string | null> {
  const artifactNames = [
    `Orbital-Setup-${version}.exe.sha256`,
    `Orbital-Setup-${version}.sha256`,
  ]

  for (const artifactName of artifactNames) {
    const url = `https://github.com/kuleshov-aleksei/orbital/releases/download/v${version}/${artifactName}`
    log.info(`[Update] Fetching hash from: ${url}`)

    try {
      const content = await fetchUrl(url)
      const hash = content.trim()
      log.info(`[Update] Fetched hash: ${hash}`)
      return hash
    } catch (error) {
      log.warn(`[Update] Failed to fetch ${artifactName}: ${error}`)
    }
  }

  return null
}

interface UpdateInfo {
  version: string
  releaseUrl?: string
  releaseNotes?: string
}

interface UpdateProgressInfo {
  percent: number
  bytesPerSecond: number
  total: number
  transferred: number
}

let currentUpdateInfo: UpdateInfo | null = null
let updateAvailableSent = false
let updateDownloadedSent = false

function sendToRenderer(channel: string, data?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    log.info(`[Update] Sending ${channel} to renderer immediately`)
    mainWindow.webContents.send(channel, data)
  } else {
    log.info(`[Update] Window not ready, caching event ${channel}`)
    cachedUpdateState.pendingEvent = channel
    cachedUpdateState.pendingData = data
  }
}

function replayCachedEvents(): void {
  if (cachedUpdateState.pendingEvent) {
    log.info(`[Update] Replaying cached event: ${cachedUpdateState.pendingEvent}`)
    mainWindow?.webContents.send(cachedUpdateState.pendingEvent, cachedUpdateState.pendingData)
    cachedUpdateState.pendingEvent = undefined
    cachedUpdateState.pendingData = undefined
  }
}

function setupAutoUpdater() {
  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  autoUpdater.disableWebInstaller = true

  log.info("[Update] Electron version:", process.versions.electron)
  log.info("[Update] electron-updater version:", require("electron-updater/package.json").version)
  log.info("[Update] App version:", app.getVersion())

  const resourcesPath = process.resourcesPath || ""
  log.info("[Update] Resources path:", resourcesPath)
  log.info("[Update] Resources app-update.yml exists:", fs.existsSync(path.join(resourcesPath, "app-update.yml")))

  if (fs.existsSync(path.join(resourcesPath, "app-update.yml"))) {
    const appUpdateConfig = fs.readFileSync(path.join(resourcesPath, "app-update.yml"), "utf-8")
    log.info("[Update] app-update.yml content:", appUpdateConfig)
  }

  autoUpdater.on("checking-for-update", () => {
    log.info("[Update] Checking for update...")
    updateCheckInProgress = true
    updateAvailableSent = false
    updateDownloadedSent = false
    sendToRenderer("update-checking")
  })

  autoUpdater.on("update-available", async (info) => {
    log.info("Update available:", info.version)
    currentUpdateInfo = info as unknown as UpdateInfo
    
    if (!updateAvailableSent) {
      updateAvailableSent = true
      sendToRenderer("update-available", info)
    }

    log.info("[Update] Automatically downloading update...")
    autoUpdater.downloadUpdate().catch((error) => {
      log.error("[Update] Failed to download update:", error)
    })
  })

  autoUpdater.on("download-progress", (progress) => {
    log.info("[Update] Download progress:", progress.percent, "%")
    sendToRenderer("update-progress", {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred,
    })
  })

  autoUpdater.on("update-downloaded", async (info) => {
    log.info("Update downloaded:", info.version)

    if (updateDownloadedSent) {
      log.info("[Update] Already sent update-downloaded, skipping")
      return
    }
    updateDownloadedSent = true

    const installerPath = (info as any).installerPath
    if (installerPath && currentUpdateInfo) {
      const isValid = await verifyUpdateHash(currentUpdateInfo, installerPath)
      if (!isValid) {
        log.error("[Update] Hash verification failed - rejecting update")
        mainWindow?.webContents.send("update-error", { message: "Update integrity check failed. The downloaded file may be corrupted or tampered with." })
        return
      }
    }

    mainWindow?.webContents.send("update-downloaded", info)
    
    updateCheckInProgress = false
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      log.info("[Update] Update complete, showing main window")
    }
  })

  autoUpdater.on("error", (error) => {
    log.error("Auto updater error:", error)
    log.error("Auto updater error stack:", error.stack)
    updateCheckInProgress = false
    mainWindow?.show()
  })

  autoUpdater.on("update-not-available", () => {
    log.info("[Update] No update available")
    updateCheckInProgress = false
    mainWindow?.show()
  })

  if (!VITE_DEV_SERVER_URL) {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      log.error("Auto updater check failed:", error)
    })
  } else {
    log.info("[Update] Skipping auto update check in dev mode")
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

  ipcMain.handle("get-licenses", async () => {
    try {
      const licensesPath = app.isPackaged
        ? path.join(process.resourcesPath, "build", "licenses.json")
        : path.join(__dirname, "..", "dist", "licenses.json")

      const content = fs.readFileSync(licensesPath, "utf-8")
      return JSON.parse(content)
    } catch (error) {
      log.error("Error getting licenses:", error)
      return []
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

  ipcMain.handle("get-close-to-tray", () => {
    return config.closeToTray
  })

  ipcMain.handle("set-close-to-tray", (_, value: boolean) => {
    config.closeToTray = value
    saveConfig()
  })

  ipcMain.handle("has-selected-close-behavior", () => {
    return config.hasSelectedCloseBehavior
  })

  ipcMain.handle("set-has-selected-close-behavior", (_, value: boolean) => {
    config.hasSelectedCloseBehavior = value
    saveConfig()
  })

  ipcMain.handle("show-close-dialog", async () => {
    if (!mainWindow) return true

    const result = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["Hide to Tray", "Quit"],
      defaultId: 0,
      cancelId: -1,
      title: "Close Orbital",
      message: "What would you like to do?",
      detail: "You can choose to hide Orbital to the system tray or quit the application completely.",
    })

    return result.response === 0
  })

  ipcMain.handle("get-hotkeys", () => {
    return config.hotkeys
  })

  ipcMain.handle("set-hotkeys", (_, hotkeys: AppConfig["hotkeys"]) => {
    log.info("[IPC] set-hotkeys called:", JSON.stringify(hotkeys))
    try {
      config.hotkeys = hotkeys
      saveConfig()
      registerAllHotkeys()
    } catch (e) {
      log.error("[IPC] set-hotkeys error:", e)
    }
  })

  ipcMain.handle("reset-hotkeys", () => {
    config.hotkeys = { ...DEFAULT_HOTKEYS }
    saveConfig()
    registerAllHotkeys()
  })

  ipcMain.handle("pause-hotkeys", () => {
    unregisterAllHotkeys()
    hotkeysPaused = true
    log.info("[Hotkey] Hotkeys paused")
    return { requiresRestart: false }
  })

  ipcMain.handle("resume-hotkeys", () => {
    hotkeysPaused = false
    registerAllHotkeys()
    log.info("[Hotkey] Hotkeys resumed")
    return { requiresRestart: false }
  })

  ipcMain.handle("get-is-wayland", () => {
    return isWayland
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
      const url = new URL(req.url || "/", `http://127.0.0.1:${OAUTH_CALLBACK_PORT}`)

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

let registeredAccelerators: {
  mute: string | null
  deafen: string | null
  ptt: string | null
} = {
  mute: null,
  deafen: null,
  ptt: null,
}

function registerAllHotkeys() {
  globalShortcut.unregisterAll()
  registeredAccelerators = { mute: null, deafen: null, ptt: null }

  const { mute, deafen, ptt } = config.hotkeys

  if (mute.enabled && mute.accelerator) {
    if (registeredAccelerators.mute && registeredAccelerators.mute !== mute.accelerator) {
      globalShortcut.unregister(registeredAccelerators.mute)
    }
    try {
      globalShortcut.register(mute.accelerator, () => {
        log.info("[Hotkey] Mute triggered")
        mainWindow?.webContents.send("hotkey-triggered", "mute")
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
        mainWindow?.webContents.send("hotkey-triggered", "deafen")
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
        mainWindow?.webContents.send("hotkey-triggered", "ptt-pressed")
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

function unregisterAllHotkeys() {
  globalShortcut.unregisterAll()
  registeredAccelerators = { mute: null, deafen: null, ptt: null }
  log.info("[Hotkey] Unregistered all hotkeys")
}

app.whenReady().then(() => {
  log.info("App ready")
  loadConfig()
  createWindow()
  createTray()
  setupDeepLink()
  setupIPC()
  registerAllHotkeys()
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
