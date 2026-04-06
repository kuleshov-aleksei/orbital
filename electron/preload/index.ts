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

export interface HotkeySetting {
  enabled: boolean
  accelerator: string
}

export interface HotkeysConfig {
  mute: HotkeySetting
  deafen: HotkeySetting
  ptt: HotkeySetting
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
  openExternal: (url: string) => Promise<boolean>
  oauthAuthenticate: () => Promise<void>
  oauthCallback: (token) => Promise<boolean>
  onOAuthToken: (callback: (data: { token: string; expires: string }) => void) => void
  venmicHasVenmic: () => Promise<boolean>
  venmicHasPipeWire: () => Promise<boolean>
  venmicListSources: () => Promise<VenmicNode[]>
  venmicStart: (include: VenmicNode[]) => Promise<boolean>
  venmicStop: () => Promise<boolean>
  getCloseToTray: () => Promise<boolean | null>
  setCloseToTray: (value: boolean) => Promise<void>
  hasSelectedCloseBehavior: () => Promise<boolean>
  setHasSelectedCloseBehavior: (value: boolean) => Promise<void>
  showCloseDialog: () => Promise<boolean>
  getHotkeys: () => Promise<HotkeysConfig>
  setHotkeys: (hotkeys: HotkeysConfig) => Promise<void>
  resetHotkeys: () => Promise<void>
  onHotkeyTriggered: (callback: (action: string) => void) => void
  pauseHotkeys: () => Promise<{ requiresRestart: boolean }>
  resumeHotkeys: () => Promise<{ requiresRestart: boolean }>
  getIsWayland: () => Promise<boolean>
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

  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  oauthAuthenticate: () => ipcRenderer.invoke("oauth-authenticate"),
  oauthCallback: (token) => ipcRenderer.invoke("oauth-callback", token),
  onOAuthToken: (callback) => {
    ipcRenderer.on("oauth-token", (_, data) => callback(data))
  },

  venmicHasVenmic: () => ipcRenderer.invoke("venmic:has-venmic"),
  venmicHasPipeWire: () => ipcRenderer.invoke("venmic:has-pipewire"),
  venmicListSources: () => ipcRenderer.invoke("venmic:list-sources"),
  venmicStart: (include) => ipcRenderer.invoke("venmic:start", include),
  venmicStop: () => ipcRenderer.invoke("venmic:stop"),

  getCloseToTray: () => ipcRenderer.invoke("get-close-to-tray"),
  setCloseToTray: (value) => ipcRenderer.invoke("set-close-to-tray", value),
  hasSelectedCloseBehavior: () => ipcRenderer.invoke("has-selected-close-behavior"),
  setHasSelectedCloseBehavior: (value) => ipcRenderer.invoke("set-has-selected-close-behavior", value),
  showCloseDialog: () => ipcRenderer.invoke("show-close-dialog"),

  getHotkeys: () => ipcRenderer.invoke("get-hotkeys"),
  setHotkeys: (hotkeys) => ipcRenderer.invoke("set-hotkeys", hotkeys),
  resetHotkeys: () => ipcRenderer.invoke("reset-hotkeys"),
  onHotkeyTriggered: (callback) => {
    ipcRenderer.on("hotkey-triggered", (_, action) => callback(action))
  },
  pauseHotkeys: () => ipcRenderer.invoke("pause-hotkeys"),
  resumeHotkeys: () => ipcRenderer.invoke("resume-hotkeys"),
  getIsWayland: () => ipcRenderer.invoke("get-is-wayland"),
}

contextBridge.exposeInMainWorld("electronAPI", electronAPI)
