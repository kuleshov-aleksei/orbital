import { ipcMain } from "electron"
import log from "electron-log"
import { hasVenmic, hasPipeWire, listAudioSources, startAudioCapture, stopAudioCapture } from "../venmic"

export function registerVenmicIpc() {
  ipcMain.handle("venmic:has-venmic", () => {
    log.info("[IPC] venmic:has-venmic called")
    const result = hasVenmic()
    log.info("[IPC] venmic:has-venmic result:", result)
    return result
  })
  ipcMain.handle("venmic:has-pipewire", () => {
    log.info("[IPC] venmic:has-pipewire called")
    const result = hasPipeWire()
    log.info("[IPC] venmic:has-pipewire result:", result)
    return result
  })
  ipcMain.handle("venmic:list-sources", () => {
    log.info("[IPC] venmic:list-sources called")
    return listAudioSources()
  })
  ipcMain.handle("venmic:start", (_, include) => {
    log.info("[IPC] venmic:start called with:", JSON.stringify(include))
    return startAudioCapture(include)
  })
  ipcMain.handle("venmic:stop", () => {
    log.info("[IPC] venmic:stop called")
    return stopAudioCapture()
  })
}