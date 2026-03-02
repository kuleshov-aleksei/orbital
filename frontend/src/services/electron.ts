import type { DesktopSource } from "@/types"

export function isElectron(): boolean {
  return typeof window !== "undefined" && window.electronAPI !== undefined
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

export function onUpdateAvailable(callback: (info: { version: string; releaseDate: string; sha512?: string }) => void): void {
  if (isElectron()) {
    window.electronAPI!.onUpdateAvailable(callback)
  }
}

export function onUpdateDownloaded(callback: (info: { version: string; releaseDate: string; sha512?: string }) => void): void {
  if (isElectron()) {
    window.electronAPI!.onUpdateDownloaded(callback)
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
