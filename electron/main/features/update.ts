import { app } from "electron"
import path from "node:path"
import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import crypto from "node:crypto"
import log from "electron-log"
import { autoUpdater } from "electron-updater"
import { VITE_DEV_SERVER_URL, require } from "../paths"
import { getMainWindow, setIsQuitting } from "../state"

export function installUpdate() {
  setIsQuitting(true)
  autoUpdater.quitAndInstall(true, true)
}

export function isUpdateCheckInProgress(): boolean {
  return updateCheckInProgress
}

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
    const file = fs.createReadStream(filePath)
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
let updateCheckInProgress = false

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
        getMainWindow()?.webContents.send("update-error", { message: "Update integrity check failed. The downloaded file may be corrupted or tampered with." })
        return
      }
    }

    getMainWindow()?.webContents.send("update-downloaded", info)
    
    updateCheckInProgress = false
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      log.info("[Update] Update complete, showing main window")
    }
  })

  autoUpdater.on("error", (error) => {
    log.error("Auto updater error:", error)
    log.error("Auto updater error stack:", error.stack)
    updateCheckInProgress = false
    getMainWindow()?.show()
    sendToRenderer("update-error", { message: error.message || "Failed to check for updates" })
  })

  autoUpdater.on("update-not-available", () => {
    log.info("[Update] No update available")
    updateCheckInProgress = false
    getMainWindow()?.show()
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