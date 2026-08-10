import type { ElectronSystemInfoData, SystemInfo } from "@/types"
import { getLogBuffer } from "@/utils/debug"
import { getSystemInfo } from "@/services/electron"

interface BrowserInfo {
  name: string
  version: string
}

function detectBrowser(): BrowserInfo {
  const ua = navigator.userAgent
  const patterns: Array<[string, RegExp]> = [
    ["Chrome", /Chrome\/([\d.]+)/],
    ["Edge", /Edg\/([\d.]+)/],
    ["Firefox", /Firefox\/([\d.]+)/],
    ["Safari", /Version\/([\d.]+) Safari/],
    ["Opera", /OPR\/([\d.]+)/],
  ]
  for (const [name, pattern] of patterns) {
    const match = ua.match(pattern)
    if (match) {
      return { name, version: match[1] }
    }
  }
  return { name: "Unknown", version: "" }
}

function mapElectronSystemInfo(e: ElectronSystemInfoData): NonNullable<SystemInfo["electron"]> {
  return {
    app_version: e.appVersion,
    electron_version: e.electronVersion,
    chromium_version: e.chromiumVersion,
    node_version: e.nodeVersion,
    os_type: e.osType,
    os_release: e.osRelease,
    os_version: e.osVersion,
    os_arch: e.osArch,
    desktop_environment: e.desktopEnvironment,
    wayland: e.wayland,
    platform: e.platform,
  }
}

export async function collectSystemInfo(): Promise<SystemInfo> {
  const screen = window.screen || ({ width: 0, height: 0, colorDepth: 0 } as Screen)
  const info: SystemInfo = {
    app_version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "",
    browser: detectBrowser(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    },
    screen: {
      width: screen.width || 0,
      height: screen.height || 0,
      color_depth: screen.colorDepth || 0,
    },
    language: navigator.language || "",
    platform: getPlatformString(),
    user_agent: navigator.userAgent,
    is_electron: false,
    electron: null,
  }

  try {
    const electronInfo = await getSystemInfo()
    if (electronInfo) {
      info.is_electron = true
      info.platform = electronInfo.platform
      info.electron = mapElectronSystemInfo(electronInfo)
    }
  } catch {
    // Non-fatal: system info collection should never break log sending
  }

  return info
}

function getPlatformString(): string {
  if (typeof navigator !== "undefined") {
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    if (platform.userAgentData?.platform) {
      return platform.userAgentData.platform
    }
    return navigator.platform || "unknown"
  }
  return "unknown"
}

export function formatSystemInfoHeader(info: SystemInfo): string {
  const lines: string[] = ["================== SYSTEM INFO =================="]
  lines.push(`App version: ${info.app_version}`)
  lines.push(`Browser: ${info.browser.name} ${info.browser.version}`)
  lines.push(`Viewport: ${info.viewport.width}x${info.viewport.height} (dpr: ${info.viewport.dpr})`)
  lines.push(`Screen: ${info.screen.width}x${info.screen.height} (${info.screen.color_depth}-bit)`)
  lines.push(`Language: ${info.language}`)
  lines.push(`Platform: ${info.platform}`)
  lines.push(`User agent: ${info.user_agent}`)
  if (info.electron) {
    const e = info.electron
    lines.push(`Electron: ${e.electron_version} (Chromium: ${e.chromium_version}, Node: ${e.node_version})`)
    lines.push(`OS: ${e.os_type} ${e.os_release}${e.os_version ? ` (${e.os_version})` : ""} (${e.os_arch})`)
    lines.push(`Desktop environment: ${e.desktop_environment}${e.wayland ? " (Wayland)" : ""}`)
  }
  lines.push("===============================================")
  return lines.join("\n")
}

// Builds a debug log report: formatted system info header prepended to the log buffer entries,
// plus the structured system info JSON for analytics
export async function buildLogReport(): Promise<{ logs: string; system_info: string }> {
  const info = await collectSystemInfo()
  const header = formatSystemInfoHeader(info)
  const entries = getLogBuffer().map((entry) => entry.message)
  const logs = [header, "", ...entries].join("\n")
  return {
    logs,
    system_info: JSON.stringify(info),
  }
}