import type { BrowserWindow } from "electron"

let mainWindow: BrowserWindow | null = null
let isQuitting = false

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function getIsQuitting(): boolean {
  return isQuitting
}

export function setIsQuitting(value: boolean): void {
  isQuitting = value
}