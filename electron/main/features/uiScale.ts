import { BrowserWindow, screen } from "electron"
import fs from "node:fs"
import log from "electron-log"
import { getConfig, setUiScaleSetting } from "./config"
import {
  autoFactor,
  detectHandheld,
  effectiveScale,
  normalizeSetting,
  type DmiInfo,
  type UiScaleSetting,
} from "./uiScalePlan"

export interface UiScaleInfo {
  setting: UiScaleSetting
  auto: number
  effective: number
  handheld: boolean
}

function readDmi(): DmiInfo | null {
  if (process.platform !== "linux") return null
  const read = (name: string) => {
    try {
      return fs.readFileSync(`/sys/class/dmi/id/${name}`, "utf-8").trim()
    } catch {
      return ""
    }
  }
  return {
    sysVendor: read("sys_vendor"),
    productName: read("product_name"),
    productVersion: read("product_version"),
  }
}

let detected: { device: string | null; auto: number } | null = null

/** Detects once per run; needs the app to be ready (uses `screen`). */
function detection() {
  if (detected) return detected
  const display = screen.getPrimaryDisplay()
  const dmi = readDmi()
  const device = detectHandheld({
    platform: process.platform,
    dmi,
    env: process.env,
    hasTouchscreen: display.touchSupport === "available",
  })
  // Handhelds run landscape; take the long side in case the panel reports
  // its native portrait orientation (the Deck's panel is 800x1280).
  const widthDip = Math.max(display.size.width, display.size.height)
  const auto = autoFactor(device !== null, widthDip)
  detected = { device, auto }
  log.info(
    `[UiScale] handheld=${device ?? "no"} dmi=${dmi ? `${dmi.sysVendor}/${dmi.productName}/${dmi.productVersion}` : "n/a"}` +
      ` display=${display.size.width}x${display.size.height}@${display.scaleFactor} auto=${auto}`,
  )
  return detected
}

export function getUiScaleInfo(): UiScaleInfo {
  const { device, auto } = detection()
  const setting = normalizeSetting(getConfig().uiScale)
  return { setting, auto, effective: effectiveScale(setting, auto), handheld: device !== null }
}

export function effectiveZoom(): number {
  return getUiScaleInfo().effective
}

/**
 * Chromium page zoom is kept per origin, and an OTA reload or the boot guard can
 * move the window to another origin, so the zoom is reapplied after each load.
 */
export function attachUiScale(win: BrowserWindow): void {
  win.webContents.on("did-finish-load", () => {
    if (!win.isDestroyed()) win.webContents.setZoomFactor(effectiveZoom())
  })
}

export function setUiScale(value: unknown): UiScaleInfo {
  setUiScaleSetting(normalizeSetting(value))
  const info = getUiScaleInfo()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.setZoomFactor(info.effective)
  }
  log.info(`[UiScale] setting=${info.setting} effective=${info.effective}`)
  return info
}
