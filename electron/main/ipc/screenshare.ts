import { ipcMain, desktopCapturer } from "electron"
import log from "electron-log"
import { setPendingScreenShareSource } from "../features/screenshare"

export function registerScreenshareIpc() {
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

  ipcMain.handle("startScreenshare", (_event, id: string, audio: boolean) => {
    log.info(`[ScreenShare] startScreenshare: id=${id}, audio=${audio}`)
    setPendingScreenShareSource({ id, name: "", audio })
    return { success: true }
  })
}