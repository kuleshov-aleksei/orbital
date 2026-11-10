import { defineStore } from "pinia"
import { ref, computed } from "vue"

const APP_SETTINGS_STORAGE_KEY = "orbital_app_settings"

export interface HotkeySetting {
  enabled: boolean
  accelerator: string
}

export interface HotkeysConfig {
  mute: HotkeySetting
  deafen: HotkeySetting
  ptt: HotkeySetting
}

export interface AppSettings {
  closeToTray: boolean
  hasSelectedCloseBehavior: boolean
  hotkeys: HotkeysConfig
  // Pause animated custom emojis in room/user lists until hovered
  reduceEmojiMotion: boolean
  // Text channel mention ping sound (docs/specs/CHAT_SYSTEM.md §7.4)
  mentionSound: boolean
  mentionSoundVolume: number // 0..1
  // Desktop app: flash the taskbar entry on a text channel mention
  mentionTaskbarFlash: boolean
}

const DEFAULT_HOTKEYS: HotkeysConfig = {
  mute: { enabled: true, accelerator: "CommandOrControl+Shift+M" },
  deafen: { enabled: true, accelerator: "CommandOrControl+Shift+D" },
  ptt: { enabled: true, accelerator: "CommandOrControl+Shift+Space" },
}

const defaultSettings: AppSettings = {
  closeToTray: true,
  hasSelectedCloseBehavior: false,
  hotkeys: DEFAULT_HOTKEYS,
  reduceEmojiMotion: false,
  mentionSound: true,
  mentionSoundVolume: 0.6,
  mentionTaskbarFlash: true,
}

export const useAppSettingsStore = defineStore("appSettings", () => {
  const settings = ref<AppSettings>({ ...defaultSettings })
  const isLoaded = ref(false)

  const closeToTray = computed(() => settings.value.closeToTray)
  const hasSelectedCloseBehavior = computed(() => settings.value.hasSelectedCloseBehavior)

  const loadSettings = (): void => {
    if (typeof window === "undefined") return

    try {
      const stored = localStorage.getItem(APP_SETTINGS_STORAGE_KEY)
      if (stored !== null) {
        settings.value = { ...defaultSettings, ...JSON.parse(stored) }
      }
      isLoaded.value = true
    } catch (e) {
      console.warn("Failed to load app settings from localStorage:", e)
      isLoaded.value = true
    }
  }

  const saveSettings = (): void => {
    if (typeof window === "undefined") return

    try {
      localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings.value))
    } catch (e) {
      console.warn("Failed to save app settings to localStorage:", e)
    }
  }

  const setCloseToTray = (value: boolean): void => {
    settings.value.closeToTray = value
    settings.value.hasSelectedCloseBehavior = true
    saveSettings()
  }

  const markCloseBehaviorSelected = (): void => {
    settings.value.hasSelectedCloseBehavior = true
    saveSettings()
  }

  const hotkeys = computed(() => settings.value.hotkeys)
  const reduceEmojiMotion = computed(() => settings.value.reduceEmojiMotion)

  const setReduceEmojiMotion = (value: boolean): void => {
    settings.value.reduceEmojiMotion = value
    saveSettings()
  }

  const mentionSound = computed(() => settings.value.mentionSound)
  const mentionSoundVolume = computed(() => settings.value.mentionSoundVolume)

  const setMentionSound = (value: boolean): void => {
    settings.value.mentionSound = value
    saveSettings()
  }

  const mentionTaskbarFlash = computed(() => settings.value.mentionTaskbarFlash)

  const setMentionTaskbarFlash = (value: boolean): void => {
    settings.value.mentionTaskbarFlash = value
    saveSettings()
  }

  const setMentionSoundVolume = (value: number): void => {
    settings.value.mentionSoundVolume = Math.min(1, Math.max(0, value))
    saveSettings()
  }

  const setHotkey = (action: keyof HotkeysConfig, setting: HotkeySetting): void => {
    settings.value.hotkeys[action] = setting
    saveSettings()
  }

  const resetHotkeys = (): void => {
    settings.value.hotkeys = { ...DEFAULT_HOTKEYS }
    saveSettings()
  }

  const hasCustomHotkeys = computed(() => {
    const current = settings.value.hotkeys
    const defaultKeys = DEFAULT_HOTKEYS
    return (
      current.mute.accelerator !== defaultKeys.mute.accelerator ||
      current.mute.enabled !== defaultKeys.mute.enabled ||
      current.deafen.accelerator !== defaultKeys.deafen.accelerator ||
      current.deafen.enabled !== defaultKeys.deafen.enabled ||
      current.ptt.accelerator !== defaultKeys.ptt.accelerator ||
      current.ptt.enabled !== defaultKeys.ptt.enabled
    )
  })

  loadSettings()

  return {
    settings,
    isLoaded,
    closeToTray,
    hasSelectedCloseBehavior,
    hotkeys,
    hasCustomHotkeys,
    reduceEmojiMotion,
    setReduceEmojiMotion,
    mentionSound,
    mentionSoundVolume,
    setMentionSound,
    setMentionSoundVolume,
    mentionTaskbarFlash,
    setMentionTaskbarFlash,
    loadSettings,
    saveSettings,
    setCloseToTray,
    markCloseBehaviorSelected,
    setHotkey,
    resetHotkeys,
  }
})
