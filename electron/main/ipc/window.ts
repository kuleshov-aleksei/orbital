import { ipcMain } from "electron"
import { getMainWindow } from "../state"
import { updateThumbarButtons, showCloseDialog } from "../features/window"

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
    mainWindow.once("focus", () => mainWindow.flashFrame(false))
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