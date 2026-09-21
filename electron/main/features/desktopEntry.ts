import { app, dialog } from "electron"
import path from "node:path"
import fs from "node:fs"
import { execFile } from "node:child_process"
import log from "electron-log"

const DESKTOP_FILE_NAME = "com.orbital.app.desktop"
const APP_ID = "com.orbital.app"
const ICON_NAME = "com.orbital.app"
const ICON_PATH_REL = path.join("hicolor", "256x256", "apps", `${ICON_NAME}.png`)

function getApplicationsDir(): string {
  const dataDir = process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share")
  return path.join(dataDir, "applications")
}

function getDesktopEntryPath(): string {
  return path.join(getApplicationsDir(), DESKTOP_FILE_NAME)
}

function getIconDir(): string {
  const dataDir = process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share")
  return path.join(dataDir, "icons")
}

function getIconPath(): string {
  return path.join(getIconDir(), ICON_PATH_REL)
}

function getSourceIconPath(): string {
  return path.join(process.resourcesPath, "build", "orbital-icon.png")
}

/**
 * AppImageLauncher integrates AppImages as `appimagekit_<hash>-<name>.desktop`,
 * which never matches the app's `app_id`. That entry carries `StartupWMClass`
 * and a stable icon, so our own `com.orbital.app.desktop` must not compete for
 * window association. Returns true when such an integrated entry exists.
 */
function isAppImageLauncherIntegrated(): boolean {
  if (!process.env.APPIMAGE) return false
  try {
    const files = fs.readdirSync(getApplicationsDir())
    for (const file of files) {
      if (!file.endsWith(".desktop") || file === DESKTOP_FILE_NAME) continue
      const content = fs.readFileSync(path.join(getApplicationsDir(), file), "utf-8")
      const hasWMClass = content.split("\n").some((line) => line.startsWith(`StartupWMClass=${APP_ID}`))
      const hasExec = content.split("\n").some((line) => line.startsWith("Exec=") && line.includes(process.env.APPIMAGE!))
      if (hasWMClass || hasExec) {
        log.info("[DesktopEntry] AppImageLauncher-integrated entry found:", file)
        return true
      }
    }
  } catch (e) {
    log.warn("[DesktopEntry] Failed to scan applications dir for AppImage integration:", e)
  }
  return false
}

function installIcon(): void {
  const source = getSourceIconPath()
  const target = getIconPath()
  try {
    if (!fs.existsSync(source)) {
      log.warn("[DesktopEntry] Source icon missing, skipping icon install:", source)
      return
    }
    if (fs.existsSync(target) && fs.readFileSync(target).equals(fs.readFileSync(source))) {
      return
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
    log.info("[DesktopEntry] Installed icon:", target)
  } catch (e) {
    log.warn("[DesktopEntry] Failed to install icon:", e)
  }
}

function renderDesktopEntry(execTarget: string, hidden: boolean, includeWMClass: boolean): string {
  const lines = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Orbital",
    "Comment=The Orbital - Voice Chat Desktop App",
    `Exec=${execTarget} --no-sandbox %U`,
    `Icon=${ICON_NAME}`,
    "Terminal=false",
    "Categories=Network;",
  ]
  if (includeWMClass) {
    lines.push(`StartupWMClass=${APP_ID}`)
  }
  if (hidden) {
    lines.push("NoDisplay=true")
  }
  return lines.join("\n") + "\n"
}

function refreshDesktopDatabase(): void {
  const dir = getApplicationsDir()
  execFile("update-desktop-database", [dir], (err) => {
    if (err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("[DesktopEntry] update-desktop-database failed:", err.message)
    }
  })
}

function writeDesktopEntry(execTarget: string, hidden: boolean, includeWMClass: boolean): void {
  try {
    installIcon()
    const target = getDesktopEntryPath()
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, renderDesktopEntry(execTarget, hidden, includeWMClass))
    log.info("[DesktopEntry] Wrote desktop entry:", target, hidden ? "(hidden)" : "(visible)")
    refreshDesktopDatabase()
  } catch (e) {
    log.error("[DesktopEntry] Failed to write desktop entry:", e)
  }
}

/**
 * Ensures a `com.orbital.app.desktop` entry exists in the user's applications dir.
 *
 * On Wayland (KDE/GNOME) the GlobalShortcuts portal resolves the app's `app_id`
 * against installed `.desktop` files. AppImageLauncher integrates AppImages under
 * an `appimagekit_<hash>-<name>.desktop` name that never matches the app_id, so
 * hotkey registration silently fails without a properly-named entry. This writes
 * one at first launch, repairs it after AppImage updates, and keeps it from
 * competing with an AppImageLauncher-integrated entry for window association.
 */
export function ensureLinuxDesktopEntry(): void {
  if (process.platform !== "linux" || !app.isPackaged) return

  const target = getDesktopEntryPath()
  const execTarget = process.env.APPIMAGE || process.execPath
  const integrated = isAppImageLauncherIntegrated()

  if (fs.existsSync(target)) {
    try {
      const content = fs.readFileSync(target, "utf-8")
      const execLine = content.split("\n").find((line) => line.startsWith("Exec="))
      const hasWMClass = content.includes(`StartupWMClass=${APP_ID}`)
      const hasStaleIcon = content.includes("/tmp/.mount_") || content.includes(`Icon=${ICON_NAME}`) === false
      const upToDate =
        !!execLine &&
        execLine.includes(execTarget) &&
        hasWMClass === !integrated &&
        !hasStaleIcon

      if (upToDate) {
        log.info("[DesktopEntry] Desktop entry present and up to date:", target)
        return
      }

      const hidden = content.includes("NoDisplay=true")
      log.info(
        "[DesktopEntry] Desktop entry present but needs repair (Exec/hidden/icon):",
        execLine,
      )
      writeDesktopEntry(execTarget, hidden, !integrated)
    } catch (e) {
      log.error("[DesktopEntry] Failed to read existing desktop entry:", e)
    }
    return
  }

  const choice = dialog.showMessageBoxSync({
    type: "question",
    title: "Orbital desktop integration",
    message: "Install Orbital into the application menu?",
    detail:
      "A desktop entry is required for global shortcuts (hotkeys) to work on Linux (KDE Wayland).\n\n" +
      "If the app was already integrated with AppImageLauncher, a visible entry may duplicate it in the menu. " +
      'Choose "Install hidden" to avoid the duplicate while still enabling hotkeys.',
    buttons: ["Install", "Install hidden", "Skip"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  })

  if (choice === 0) {
    writeDesktopEntry(execTarget, false, !integrated)
  } else if (choice === 1) {
    writeDesktopEntry(execTarget, true, !integrated)
  } else {
    log.info("[DesktopEntry] User skipped desktop entry installation")
  }
}