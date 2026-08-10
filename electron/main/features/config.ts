import { app } from "electron"
import path from "node:path"
import fs from "node:fs"
import log from "electron-log"

export interface HotkeySetting {
  enabled: boolean
  accelerator: string
}

export interface AppConfig {
  closeToTray: boolean
  hasSelectedCloseBehavior: boolean
  skipUpdates: boolean
  hotkeys: {
    mute: HotkeySetting
    deafen: HotkeySetting
    ptt: HotkeySetting
  }
}

export const DEFAULT_HOTKEYS: AppConfig["hotkeys"] = {
  mute: { enabled: false, accelerator: "CommandOrControl+M" },
  deafen: { enabled: false, accelerator: "CommandOrControl+D" },
  ptt: { enabled: false, accelerator: "CommandOrControl+Space" },
}

export const DEFAULT_CONFIG: AppConfig = {
  closeToTray: true,
  hasSelectedCloseBehavior: false,
  skipUpdates: false,
  hotkeys: DEFAULT_HOTKEYS,
}

let config: AppConfig = { ...DEFAULT_CONFIG }

function getConfigPath(): string {
  const configDir = app.getPath("userData")
  return path.join(configDir, "config.json")
}

export function loadConfig(): void {
  try {
    const configPath = getConfigPath()
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf-8")
      config = { ...DEFAULT_CONFIG, ...JSON.parse(data) }
      log.info("Config loaded from:", configPath)
    } else {
      log.info("No config file found, using defaults")
    }
  } catch (e) {
    log.warn("Failed to load config:", e)
  }
}

export function saveConfig(): void {
  try {
    const configPath = getConfigPath()
    const configDir = path.dirname(configPath)
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    log.info("Config saved to:", configPath)
  } catch (e) {
    log.error("Failed to save config:", e)
  }
}

export function getConfig(): AppConfig {
  return config
}

export function setCloseToTray(value: boolean): void {
  config.closeToTray = value
  saveConfig()
}

export function setHasSelectedCloseBehavior(value: boolean): void {
  config.hasSelectedCloseBehavior = value
  saveConfig()
}

export function setHotkeys(hotkeys: AppConfig["hotkeys"]): void {
  config.hotkeys = hotkeys
  saveConfig()
}

export function resetHotkeys(): void {
  config.hotkeys = { ...DEFAULT_HOTKEYS }
  saveConfig()
}