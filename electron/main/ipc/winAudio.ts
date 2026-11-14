import { ipcMain } from "electron"
import log from "electron-log"
import {
  probe,
  listApps,
  pidOfSource,
  startCapture,
  stopCapture,
  type WinAudioTarget,
} from "../winAudioCapture"

function parseTarget(raw: unknown): WinAudioTarget | null {
  const t = raw as { mode?: unknown; pid?: unknown } | null
  if (t?.mode === "exclude-self") return { mode: "exclude-self" }
  if (t?.mode === "include" && typeof t.pid === "number" && Number.isInteger(t.pid) && t.pid > 0) {
    return { mode: "include", pid: t.pid }
  }
  return null
}

export function registerWinAudioIpc() {
  ipcMain.handle("win-audio:probe", () => probe())
  ipcMain.handle("win-audio:list", () => listApps())
  ipcMain.handle("win-audio:pid-of-source", (_, sourceId: unknown) =>
    typeof sourceId === "string" ? pidOfSource(sourceId) : null,
  )
  ipcMain.handle("win-audio:start", async (event, rawTarget: unknown) => {
    const target = parseTarget(rawTarget)
    if (!target) return { ok: false, error: "invalid target" }
    log.info("[IPC] win-audio:start", JSON.stringify(target))
    const result = await startCapture(target, event.sender)
    log.info("[IPC] win-audio:start result:", JSON.stringify(result))
    return result
  })
  ipcMain.handle("win-audio:stop", () => stopCapture())
}
