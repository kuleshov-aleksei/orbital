import { app, BrowserWindow, dialog, nativeImage, screen, shell } from "electron"
import type { ThumbarButton } from "electron"
import path from "node:path"
import log from "electron-log"
import { APP_ROOT, VITE_DEV_SERVER_URL, __dirname, preloadPath } from "../paths"
import { getMainWindow, setMainWindow, getIsQuitting, setIsQuitting } from "../state"
import { isWayland, isDebugMode } from "../platform"
import { getConfig, setCloseToTray, setHasSelectedCloseBehavior } from "./config"
import { flushPendingLogEntries } from "./logRelay"
import { isUpdateCheckInProgress, replayCachedEvents } from "./update"
import { consumePendingDeepLink } from "./deeplink"

let thumbarIcons: Record<string, nativeImage> = {}

function loadThumbarIcon(filename: string): nativeImage {
  if (thumbarIcons[filename]) {
    return thumbarIcons[filename]
  }

  const iconPath = VITE_DEV_SERVER_URL
    ? path.join(__dirname, "../../main/icons", filename)
    : path.join(process.resourcesPath, "main/icons", filename)

  try {
    const img = nativeImage.createFromPath(iconPath)
    if (!img.isEmpty()) {
      thumbarIcons[filename] = img
      return img
    }
  } catch {
    log.warn(`[Thumbar] Failed to load icon: ${filename}`)
  }

  return nativeImage.createEmpty()
}

export function updateThumbarButtons(state?: { isMuted: boolean; isDeafened: boolean }) {
  const mainWindow = getMainWindow()
  if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed()) {
    return
  }

  if (!state) {
    mainWindow.setThumbarButtons([])
    return
  }

  const micIcon = loadThumbarIcon(state.isMuted ? "microphone-slash.png" : "microphone.png")
  const headphoneIcon = loadThumbarIcon(state.isDeafened ? "headphones-slash.png" : "headphones.png")

  const buttons: ThumbarButton[] = [
    {
      icon: micIcon,
      tooltip: state.isMuted ? "Unmute" : "Mute",
      click: () => {
        mainWindow?.webContents.send("thumbar-button-clicked", "mute")
      },
    },
    {
      icon: headphoneIcon,
      tooltip: state.isDeafened ? "Undeafen" : "Deafen",
      click: () => {
        mainWindow?.webContents.send("thumbar-button-clicked", "deafen")
      },
    },
  ]

  mainWindow.setThumbarButtons(buttons)
}

export async function showCloseDialog(win: BrowserWindow): Promise<number> {
  const result = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Hide to Tray", "Quit"],
    defaultId: 0,
    cancelId: -1,
    title: "Close Orbital",
    message: "What would you like to do?",
    detail: "You can choose to hide Orbital to the system tray or quit the application completely.",
  })
  return result.response
}

export function createWindow() {
  const iconPath = path.join(APP_ROOT, "build", "orbital-icon.png")

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize

  const win = new BrowserWindow({
    width: screenW,
    height: screenH,
    minWidth: 800,
    minHeight: 600,
    title: "Orbital",
    backgroundColor: "#1a1a1a",
    icon: iconPath,
    show: !isWayland,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    autoHideMenuBar: true
  })

  setMainWindow(win)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      shell.openExternal(url)
    }
    return { action: "deny" }
  })

  win.webContents.on("will-navigate", (event, url) => {
    const currentUrl = win.webContents.getURL()
    const isDevServerUrl = VITE_DEV_SERVER_URL !== undefined && url.startsWith(VITE_DEV_SERVER_URL)
    if (url !== currentUrl && !isDevServerUrl) {
      event.preventDefault()
      if (url.startsWith("https:") || url.startsWith("http:")) {
        shell.openExternal(url)
      }
    }
  })

  win.once("ready-to-show", () => {
    flushPendingLogEntries()

    if (isUpdateCheckInProgress()) {
      log.info("[Update] Window ready but update check in progress, deferring show")
    } else {
      win.show()
      win.maximize()
      win.focus()

      log.info("Main window shown")
    }

    const pendingDeepLink = consumePendingDeepLink()
    if (pendingDeepLink) {
      log.info("Processing pending deep link:", pendingDeepLink)
      win.webContents.send("deep-link", pendingDeepLink)
    }

    replayCachedEvents()
  })

  win.on("close", async (event) => {
    if (!getIsQuitting()) {
      event.preventDefault()

      const config = getConfig()
      if (!config.hasSelectedCloseBehavior && !isWayland) {
        const response = await showCloseDialog(win)

        if (response === -1) {
          return
        }

        setCloseToTray(response === 0)
        setHasSelectedCloseBehavior(true)
      }

      if (config.closeToTray && !isWayland) {
        win.hide()
      } else {
        setIsQuitting(true)
        app.quit()
      }
    }
  })

  win.on("closed", () => {
    setMainWindow(null)
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadURL("orbital://app/")
  }

  if (VITE_DEV_SERVER_URL || isDebugMode) {
    win.webContents.openDevTools()
  }

  if (isWayland) {
    const bounds = win.getBounds()
    const displays = screen.getAllDisplays().map(d => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
    }))
    log.info(`[Wayland] Initial window bounds: ${JSON.stringify(bounds)}`)
    log.info(`[Wayland] Displays: ${JSON.stringify(displays)}`)
    log.info(`[Wayland] Window visible on creation: ${win.isVisible()}`)
  }

  log.info("Window created, loading content...")
}