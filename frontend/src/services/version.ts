// Version checking service for PWA update detection
import { apiRequest } from "./api"
import { debugLog } from "@/utils/debug"

// Version is injected at build time via Vite define
declare const __APP_VERSION__: string

const POLL_INTERVAL_MS = 60000 // 1 minute
const INITIAL_DELAY_MS = 30000 // 30 seconds

interface VersionResponse {
  version: string
}

export class VersionChecker {
  private intervalId: number | null = null
  private currentVersion: string
  private onUpdateAvailable: (isInCall: boolean) => void
  private isInCallCallback: () => boolean

  constructor(onUpdateAvailable: (isInCall: boolean) => void, isInCallCallback: () => boolean) {
    this.currentVersion = __APP_VERSION__
    this.onUpdateAvailable = onUpdateAvailable
    this.isInCallCallback = isInCallCallback
  }

  start(): void {
    // Wait initial delay before first check
    setTimeout(() => {
      void this.checkVersion()
      this.startPolling()
    }, INITIAL_DELAY_MS)

    // Pause/resume polling based on tab visibility
    document.addEventListener("visibilitychange", this.handleVisibilityChange)
  }

  stop(): void {
    this.stopPolling()
    document.removeEventListener("visibilitychange", this.handleVisibilityChange)
  }

  private startPolling(): void {
    if (this.intervalId !== null) return
    this.intervalId = window.setInterval(() => {
      void this.checkVersion()
    }, POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.stopPolling()
    } else {
      this.startPolling()
      // Check immediately when tab becomes visible
      void this.checkVersion()
    }
  }

  private async checkVersion(): Promise<void> {
    try {
      const response = await apiRequest<VersionResponse>("/version")
      const serverVersion = response.version

      if (serverVersion !== this.currentVersion) {
        debugLog(`[VersionChecker] Update detected: ${this.currentVersion} → ${serverVersion}`)
        const isInCall = this.isInCallCallback()
        this.onUpdateAvailable(isInCall)
      }
    } catch (error) {
      // Silent failure - will retry on next interval
      debugLog("[VersionChecker] Version check failed:", error)
    }
  }

  forceReload(): void {
    window.location.reload()
  }

  getCurrentVersion(): string {
    return this.currentVersion
  }
}

// Factory function for creating version checker instance
export function createVersionChecker(
  onUpdateAvailable: (isInCall: boolean) => void,
  isInCallCallback: () => boolean,
): VersionChecker {
  return new VersionChecker(onUpdateAvailable, isInCallCallback)
}
