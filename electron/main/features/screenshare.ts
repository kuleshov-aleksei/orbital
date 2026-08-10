import { session } from "electron"
import log from "electron-log"

export interface PendingScreenShareSource {
  id: string
  name: string
  audio: boolean
}

let pendingScreenShareSource: PendingScreenShareSource | null = null

export function setPendingScreenShareSource(source: PendingScreenShareSource | null): void {
  pendingScreenShareSource = source
}

export function setupScreenShareHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      log.info("[ScreenShare] Handler invoked, pendingSource:", pendingScreenShareSource)

      const source = pendingScreenShareSource
      pendingScreenShareSource = null

      if (!source || source.id === "none") {
        log.warn("[ScreenShare] No source selected, source was:", source)
        try {
          callback({})
        } catch (e) {
          log.error("[ScreenShare] Callback error (no source):", e)
        }
        return
      }

      log.info(`[ScreenShare] Using source: ${source.id}, audio: ${source.audio}`)

      const options: Electron.Streams = {
        video: { id: source.id, name: source.name },
      }
      if (source.audio) {
        if (process.platform === "win32" && source.id.startsWith("window:")) {
          log.warn("[ScreenShare] Audio loopback not supported for window capture on Windows, skipping")
        } else {
          options.audio = "loopback"
          log.info("[ScreenShare] Added audio: loopback to options")
        }
      }

      try {
        callback(options)
        log.info("[ScreenShare] Callback sent successfully")
      } catch (e) {
        log.error("[ScreenShare] Callback error:", e)
      }
    },
    { useSystemPicker: false }
  )
  log.info("[ScreenShare] Handler registered")
}