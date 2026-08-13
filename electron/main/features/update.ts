import { app } from "electron"
import path from "node:path"
import fs from "node:fs"
import crypto from "node:crypto"
import log from "electron-log"
import { autoUpdater } from "electron-updater"
import { VITE_DEV_SERVER_URL, require } from "../paths"
import { getMainWindow, setIsQuitting } from "../state"

export function installUpdate() {
  setIsQuitting(true)
  autoUpdater.quitAndInstall(true, true)
}

function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha512")
    const file = fs.createReadStream(filePath)
    file.on("data", (chunk: Buffer) => hash.update(chunk))
    file.on("end", () => resolve(hash.digest("base64")))
    file.on("error", reject)
  })
}

async function verifyUpdateHash(installerPath: string, expectedSha512?: string): Promise<boolean> {
  if (!expectedSha512) {
    log.warn("[Update] No published checksum available, skipping verification")
    return true
  }

  log.info("[Update] Verifying downloaded file checksum")
  log.info("[Update] Installer path:", installerPath)
  log.info("[Update] Expected sha512 (from release):", expectedSha512)

  const actualHash = await calculateFileHash(installerPath)
  log.info("[Update] Actual sha512 (calculated):", actualHash)

  if (expectedSha512 === actualHash) {
    log.info("[Update] Hash verification PASSED")
    return true
  } else {
    log.error("[Update] Hash verification FAILED - hashes do not match!")
    return false
  }
}

interface UpdateInfo {
  version: string
  sha512?: string
  releaseUrl?: string
  releaseNotes?: string
}

interface UpdateProgressInfo {
  percent: number
  bytesPerSecond: number
  total: number
  transferred: number
}

interface CachedUpdateState {
  status: "idle" | "checking" | "downloading" | "ready" | "error"
  version?: string
  percent?: number
  error?: string
  pendingEvent?: string
  pendingData?: unknown
}

let cachedUpdateState: CachedUpdateState = { status: "idle" }
let currentUpdateInfo: UpdateInfo | null = null
let updateAvailableSent = false
let updateDownloadedSent = false

function sendToRenderer(channel: string, data?: unknown): void {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    log.info(`[Update] Sending ${channel} to renderer immediately`)
    mainWindow.webContents.send(channel, data)
  } else {
    log.info(`[Update] Window not ready, caching event ${channel}`)
    cachedUpdateState.pendingEvent = channel
    cachedUpdateState.pendingData = data
  }
}

export function replayCachedEvents(): void {
  const mainWindow = getMainWindow()
  if (cachedUpdateState.pendingEvent) {
    log.info(`[Update] Replaying cached event: ${cachedUpdateState.pendingEvent}`)
    mainWindow?.webContents.send(cachedUpdateState.pendingEvent, cachedUpdateState.pendingData)
    cachedUpdateState.pendingEvent = undefined
    cachedUpdateState.pendingData = undefined
  }
}

export function setupAutoUpdater() {
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

    const installerPath = (info as any).installerPath ?? (info as any).downloadedFile
    if (installerPath && currentUpdateInfo) {
      const isValid = await verifyUpdateHash(installerPath, currentUpdateInfo.sha512)
      if (!isValid) {
        log.error("[Update] Hash verification failed - rejecting update")
        getMainWindow()?.webContents.send("update-error", { message: "Update integrity check failed. The downloaded file may be corrupted or tampered with." })
        return
      }
    }

    getMainWindow()?.webContents.send("update-downloaded", info)

    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      log.info("[Update] Update complete, showing main window")
    }
  })

  autoUpdater.on("error", (error) => {
    log.error("Auto updater error:", error)
    log.error("Auto updater error stack:", error.stack)
    sendToRenderer("update-error", { message: error.message || "Failed to check for updates" })
  })

  autoUpdater.on("update-not-available", () => {
    log.info("[Update] No update available")
    sendToRenderer("update-not-available")
  })

  if (!VITE_DEV_SERVER_URL) {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      log.error("Auto updater check failed:", error)
    })
  } else {
    log.info("[Update] Skipping auto update check in dev mode")
  }
}