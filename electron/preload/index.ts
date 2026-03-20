import { contextBridge, ipcRenderer } from "electron"

export interface DesktopSource {
  id: string
  name: string
  thumbnail: string
  display_id: string
}

export interface UpdateInfo {
  version: string
  releaseDate: string
  sha512?: string
}

export interface VenmicNode {
  [key: string]: string | number | boolean | undefined
}

export interface ElectronAPI {
  getDesktopSources: () => Promise<DesktopSource[]>
  checkForUpdates: () => Promise<unknown>
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => void
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => void
  installUpdate: () => void
  getPlatform: () => Promise<NodeJS.Platform>
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  onDeepLink: (callback: (url: string) => void) => void
  venmicHasVenmic: () => Promise<boolean>
  venmicHasPipeWire: () => Promise<boolean>
  venmicListSources: () => Promise<VenmicNode[]>
  venmicStart: (include: VenmicNode[]) => Promise<boolean>
  venmicStop: () => Promise<boolean>
}

const electronAPI: ElectronAPI = {
  getDesktopSources: () => ipcRenderer.invoke("get-desktop-sources"),

  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),

  onUpdateAvailable: (callback) => {
    ipcRenderer.on("update-available", (_, info) => callback(info))
  },

  onUpdateDownloaded: (callback) => {
    ipcRenderer.on("update-downloaded", (_, info) => callback(info))
  },

  installUpdate: () => {
    ipcRenderer.invoke("install-update")
  },

  getPlatform: () => ipcRenderer.invoke("get-platform"),

  minimizeWindow: () => {
    ipcRenderer.invoke("minimize-window")
  },

  maximizeWindow: () => {
    ipcRenderer.invoke("maximize-window")
  },

  closeWindow: () => {
    ipcRenderer.invoke("close-window")
  },

  onDeepLink: (callback) => {
    ipcRenderer.on("deep-link", (_, url) => callback(url))
  },

  venmicHasVenmic: () => ipcRenderer.invoke("venmic:has-venmic"),
  venmicHasPipeWire: () => ipcRenderer.invoke("venmic:has-pipewire"),
  venmicListSources: () => ipcRenderer.invoke("venmic:list-sources"),
  venmicStart: (include) => ipcRenderer.invoke("venmic:start", include),
  venmicStop: () => ipcRenderer.invoke("venmic:stop"),
}

contextBridge.exposeInMainWorld("electronAPI", electronAPI)
