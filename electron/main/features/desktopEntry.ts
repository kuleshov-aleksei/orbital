import { app, dialog } from "electron"
import path from "node:path"
import fs from "node:fs"
import { execFile } from "node:child_process"
import log from "electron-log"

const DESKTOP_FILE_NAME = "com.orbital.app.desktop"

function getApplicationsDir(): string {
  const dataDir = process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share")
  return path.join(dataDir, "applications")
}

function getDesktopEntryPath(): string {
  return path.join(getApplicationsDir(), DESKTOP_FILE_NAME)
}

function renderDesktopEntry(execTarget: string, hidden: boolean): string {
  const iconPath = path.join(process.resourcesPath, "build", "orbital-icon.png")
  const lines = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Orbital",
    "Comment=The Orbital - Voice Chat Desktop App",
    `Exec=${execTarget} --no-sandbox %U`,
    `Icon=${iconPath}`,
    "Terminal=false",
    "Categories=Network;",
    "StartupWMClass=com.orbital.app",
  ]
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

function writeDesktopEntry(execTarget: string, hidden: boolean): void {
  try {
    const target = getDesktopEntryPath()
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, renderDesktopEntry(execTarget, hidden))
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
 * one at first launch, and repairs the `Exec=` path after AppImage updates.
 */
export function ensureLinuxDesktopEntry(): void {
  if (process.platform !== "linux" || !app.isPackaged) return

  const target = getDesktopEntryPath()
  const execTarget = process.env.APPIMAGE || process.execPath

  if (fs.existsSync(target)) {
    try {
      const content = fs.readFileSync(target, "utf-8")
      const execLine = content.split("\n").find((line) => line.startsWith("Exec="))
      if (execLine && execLine.includes(execTarget)) {
        log.info("[DesktopEntry] Desktop entry present and up to date:", target)
        return
      }
      log.info("[DesktopEntry] Desktop entry present but Exec is stale, updating:", execLine)
      writeDesktopEntry(execTarget, content.includes("NoDisplay=true"))
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
      "A desktop entry is required for global shortcuts (hotkeys) to work on Linux (under Wayland).\n\n" +
      "If the app was already integrated with AppImageLauncher, a visible entry may duplicate it in the menu. " +
      'Choose "Install hidden" to avoid the duplicate while still enabling hotkeys.',
    buttons: ["Install", "Install hidden", "Skip"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  })

  if (choice === 0) {
    writeDesktopEntry(execTarget, false)
  } else if (choice === 1) {
    writeDesktopEntry(execTarget, true)
  } else {
    log.info("[DesktopEntry] User skipped desktop entry installation")
  }
}