import { ipcMain, type BrowserWindow } from "electron"
import { getMainWindow } from "../state"
import { updateThumbarButtons, showCloseDialog } from "../features/window"

/** The window that is flashing and has a focus listener waiting to stop it. */
let flashingWindow: BrowserWindow | null = null

export function registerWindowIpc() {
  ipcMain.handle("minimize-window", () => {
    getMainWindow()?.minimize()
  })

  ipcMain.handle("maximize-window", () => {
    const mainWindow = getMainWindow()
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  // Taskbar attention for text channel mentions; stops when focused.
  ipcMain.handle("flash-window", () => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isFocused()) return
    mainWindow.flashFrame(true)
    // One pending listener is enough however many mentions arrive.
    if (flashingWindow === mainWindow) return
    flashingWindow = mainWindow
    mainWindow.once("focus", () => {
      flashingWindow = null
      mainWindow.flashFrame(false)
    })
  })

  ipcMain.handle("close-window", () => {
    getMainWindow()?.hide()
  })

  ipcMain.handle("set-thumbar-buttons", (_, state: { isMuted: boolean; isDeafened: boolean } | null) => {
    updateThumbarButtons(state ?? undefined)
    return true
  })

  ipcMain.handle("show-close-dialog", async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return true

    const response = await showCloseDialog(mainWindow)
    return response === 0
  })
}