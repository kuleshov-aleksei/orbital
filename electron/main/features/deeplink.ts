import { app } from "electron"
import log from "electron-log"
import { getMainWindow } from "../state"

let pendingDeepLink: string | null = null

export function setupDeepLink() {
  log.info("Setting up deep link handler for orbital:// protocol")

  // Register as protocol handler - this is needed for production builds
  // In dev mode, electron handles this differently
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("orbital", process.execPath, [process.argv[1]])
      log.info("Registered as protocol handler (dev mode with exec path)")
    }
  } else {
    app.setAsDefaultProtocolClient("orbital")
    log.info("Registered as protocol handler (production mode)")
  }

  // Handle deep link on macOS via open-url event
  app.on("open-url", (event, url) => {
    event.preventDefault()
    log.info("Deep link received via open-url:", url)
    handleDeepLink(url)
  })

  // Handle deep link from command line arguments (Linux/Windows)
  // This handles the case when app is already running and a deep link is triggered
  const deepLinkArg = process.argv.find((arg) => arg.startsWith("orbital://"))
  if (deepLinkArg) {
    log.info("Deep link found in command line:", deepLinkArg)
    // Delay handling slightly to ensure window is ready
    setTimeout(() => handleDeepLink(deepLinkArg), 1000)
  }
}

function handleDeepLink(url: string) {
  if (!url.startsWith("orbital://")) {
    log.warn("Invalid deep link URL:", url)
    return
  }

  log.info("Handling deep link:", url)

  const mainWindow = getMainWindow()
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send("deep-link", url)
  } else {
    log.warn("Main window not available, queuing deep link")
    // Store for later when window is created
    pendingDeepLink = url
  }
}

export function consumePendingDeepLink(): string | null {
  const url = pendingDeepLink
  pendingDeepLink = null
  return url
}