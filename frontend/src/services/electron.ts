import type { DesktopSource, UpdateProgressInfo, UpdateErrorInfo } from "@/types"

const isDev = import.meta.env.DEV

export function isElectron(): boolean {
  return typeof window !== "undefined" && window.electronAPI !== undefined
}

export function isElectronDev(): boolean {
  return isElectron() && isDev
}

export async function getDesktopSources(): Promise<DesktopSource[]> {
  if (!isElectron()) {
    throw new Error("Not running in Electron")
  }
  return window.electronAPI!.getDesktopSources()
}

export async function getPlatform(): Promise<NodeJS.Platform> {
  if (!isElectron()) {
    return process.platform
  }
  return window.electronAPI!.getPlatform()
}

export function onDeepLink(callback: (url: string) => void): void {
  if (isElectron()) {
    window.electronAPI!.onDeepLink(callback)
  }
}

export function checkForUpdates(): Promise<unknown> {
  if (!isElectron()) {
    return Promise.resolve(null)
  }
  return window.electronAPI!.checkForUpdates()
}

export function onUpdateChecking(callback: () => void): void {
  if (isElectron()) {
    window.electronAPI!.onUpdateChecking(callback)
  }
}

export function onUpdateAvailable(
  callback: (info: { version: string; releaseDate: string; sha512?: string }) => void,
): void {
  if (isElectron()) {
    window.electronAPI!.onUpdateAvailable(callback)
  }
}

export function onUpdateProgress(callback: (info: UpdateProgressInfo) => void): void {
  if (isElectron()) {
    window.electronAPI!.onUpdateProgress(callback)
  }
}

export function onUpdateDownloaded(
  callback: (info: { version: string; releaseDate: string; sha512?: string }) => void,
): void {
  if (isElectron()) {
    window.electronAPI!.onUpdateDownloaded(callback)
  }
}

export function onUpdateError(callback: (info: UpdateErrorInfo) => void): void {
  if (isElectron()) {
    window.electronAPI!.onUpdateError(callback)
  }
}

export function onUpdateNotAvailable(callback: () => void): void {
  if (isElectron()) {
    window.electronAPI!.onUpdateNotAvailable(callback)
  }
}

export function installUpdate(): void {
  if (isElectron()) {
    window.electronAPI!.installUpdate()
  }
}

export function minimizeWindow(): void {
  if (isElectron()) {
    window.electronAPI!.minimizeWindow()
  }
}

export function maximizeWindow(): void {
  if (isElectron()) {
    window.electronAPI!.maximizeWindow()
  }
}

export function closeWindow(): void {
  if (isElectron()) {
    window.electronAPI!.closeWindow()
  }
}

export async function openExternal(url: string): Promise<boolean> {
  if (!isElectron()) {
    throw new Error("Not running in Electron")
  }
  return window.electronAPI!.openExternal(url)
}

export async function oauthAuthenticate(): Promise<void> {
  if (!isElectron()) {
    throw new Error("Not running in Electron")
  }
  return window.electronAPI!.oauthAuthenticate()
}

export function onOAuthToken(callback: (data: { token: string; expires: string }) => void): void {
  if (isElectron()) {
    window.electronAPI!.onOAuthToken(callback)
  }
}

export async function getCloseToTray(): Promise<boolean | null> {
  if (!isElectron()) return null
  return window.electronAPI!.getCloseToTray()
}

export async function setCloseToTray(value: boolean): Promise<void> {
  if (!isElectron()) return
  return window.electronAPI!.setCloseToTray(value)
}

export async function hasSelectedCloseBehavior(): Promise<boolean> {
  if (!isElectron()) return false
  return window.electronAPI!.hasSelectedCloseBehavior()
}

export async function setHasSelectedCloseBehavior(value: boolean): Promise<void> {
  if (!isElectron()) return
  return window.electronAPI!.setHasSelectedCloseBehavior(value)
}

export async function showCloseDialog(): Promise<boolean> {
  if (!isElectron()) return true
  return window.electronAPI!.showCloseDialog()
}

export interface HotkeySetting {
  enabled: boolean
  accelerator: string
}

export interface HotkeysConfig {
  mute: HotkeySetting
  deafen: HotkeySetting
  ptt: HotkeySetting
}

export async function getHotkeys(): Promise<HotkeysConfig | null> {
  if (!isElectron()) return null
  return window.electronAPI!.getHotkeys()
}

export async function setHotkeys(hotkeys: HotkeysConfig): Promise<void> {
  if (!isElectron()) return
  return window.electronAPI!.setHotkeys(hotkeys)
}

export async function resetHotkeys(): Promise<void> {
  if (!isElectron()) return
  return window.electronAPI!.resetHotkeys()
}

export function onHotkeyTriggered(callback: (action: string) => void): void {
  if (isElectron()) {
    window.electronAPI!.onHotkeyTriggered(callback)
  }
}

export async function pauseHotkeys(): Promise<{ requiresRestart: boolean }> {
  if (!isElectron()) return { requiresRestart: false }
  return window.electronAPI!.pauseHotkeys()
}

export async function resumeHotkeys(): Promise<{ requiresRestart: boolean }> {
  if (!isElectron()) return { requiresRestart: false }
  return window.electronAPI!.resumeHotkeys()
}

export async function getIsWayland(): Promise<boolean> {
  if (!isElectron()) return false
  return window.electronAPI!.getIsWayland()
}

export interface License {
  name: string
  version: string
  license: string
  url: string
  description: string
  custom: string | null
}

export async function getLicenses(): Promise<License[] | null> {
  if (!isElectron()) return null
  return window.electronAPI!.getLicenses()
}
