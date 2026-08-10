import { app, Tray, Menu, nativeImage } from "electron"
import path from "node:path"
import log from "electron-log"
import { VITE_DEV_SERVER_URL, __dirname } from "../paths"
import { getMainWindow, setIsQuitting } from "../state"

let tray: Tray | null = null

export function createTray() {
  const iconPath = VITE_DEV_SERVER_URL
    ? path.join(__dirname, "../../build/orbital-icon.png")
    : path.join(process.resourcesPath, "build/orbital-icon.png")

  let trayIcon: nativeImage
  try {
    trayIcon = nativeImage.createFromPath(iconPath)
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty()
    }
  } catch {
    trayIcon = nativeImage.createEmpty()
  }

  tray = new Tray(trayIcon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Orbital",
      click: () => {
        getMainWindow()?.show()
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        setIsQuitting(true)
        app.quit()
      },
    },
  ])

  tray.setToolTip("Orbital")
  tray.setContextMenu(contextMenu)

  tray.on("click", () => {
    getMainWindow()?.show()
  })
}