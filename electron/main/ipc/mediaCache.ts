import { ipcMain } from "electron"
import { clearMediaCache, evictMedia, listMediaCache } from "../features/mediaCache"

export function registerMediaCacheIpc() {
  ipcMain.handle("media-cache:list", () => listMediaCache())
  ipcMain.handle("media-cache:evict", (_event, id: string) => evictMedia(String(id)))
  ipcMain.handle("media-cache:clear", () => clearMediaCache())
}
