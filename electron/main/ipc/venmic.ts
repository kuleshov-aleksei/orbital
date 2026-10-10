import { ipcMain } from "electron"
import log from "electron-log"
import { hasVenmic, hasPipeWire, listAudioSources, listApps, startAudioCapture, stopAudioCapture, getSavedVenmicSources, setSavedVenmicSources } from "../venmic"

export function registerVenmicIpc() {
  ipcMain.handle("venmic:has-venmic", async () => {
    log.info("[IPC] venmic:has-venmic called")
    const result = await hasVenmic()
    log.info("[IPC] venmic:has-venmic result:", result)
    return result
  })
  ipcMain.handle("venmic:has-pipewire", async () => {
    log.info("[IPC] venmic:has-pipewire called")
    const result = await hasPipeWire()
    log.info("[IPC] venmic:has-pipewire result:", result)
    return result
  })
  ipcMain.handle("venmic:list-sources", async () => {
    log.info("[IPC] venmic:list-sources called")
    const sources = await listAudioSources()
    log.info("[IPC] venmic:list-sources result:", sources.length, "source(s)")
    return sources
  })
  ipcMain.handle("venmic:list-apps", async (_, includeAll) => {
    log.info("[IPC] venmic:list-apps called, includeAll:", includeAll === true)
    const apps = await listApps(includeAll === true)
    log.info("[IPC] venmic:list-apps result:", apps.length, "app(s)")
    return apps
  })
  ipcMain.handle("venmic:get-saved-sources", async () => {
    log.info("[IPC] venmic:get-saved-sources called")
    const sources = await getSavedVenmicSources()
    log.info("[IPC] venmic:get-saved-sources result:", JSON.stringify(sources))
    return sources
  })
  ipcMain.handle("venmic:save-sources", (_, sources) => {
    log.info("[IPC] venmic:save-sources called with:", JSON.stringify(sources))
    setSavedVenmicSources(sources ?? [])
  })
  ipcMain.handle("venmic:start", async (_, include) => {
    log.info("[IPC] venmic:start called with:", JSON.stringify(include))
    const result = await startAudioCapture(include)
    log.info("[IPC] venmic:start result:", result)
    return result
  })
  ipcMain.handle("venmic:stop", async () => {
    log.info("[IPC] venmic:stop called")
    const result = await stopAudioCapture()
    log.info("[IPC] venmic:stop result:", result)
    return result
  })
}