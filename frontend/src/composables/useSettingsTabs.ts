import { type Component } from "vue"
import {
  PhUser,
  PhSpeakerHigh,
  PhCamera,
  PhPalette,
  PhMusicNotes,
  PhMonitor,
  PhBug,
  PhInfo,
} from "@phosphor-icons/vue"
import AccountSettings from "@/components/settings/AccountSettings.vue"
import AudioSettings from "@/components/settings/AudioSettings.vue"
import VideoSettings from "@/components/settings/VideoSettings.vue"
import AppearanceSettings from "@/components/settings/AppearanceSettings.vue"
import SoundPackSettings from "@/components/settings/SoundPackSettings.vue"
import ApplicationSettings from "@/components/settings/ApplicationSettings.vue"
import DebugSettings from "@/components/settings/DebugSettings.vue"
import AboutSettings from "@/components/settings/AboutSettings.vue"

export interface SettingsTab {
  id: string
  label: string
  icon: Component
  component: Component
}

export const SETTINGS_TABS: SettingsTab[] = [
  { id: "account", label: "Account", icon: PhUser, component: AccountSettings },
  { id: "audio", label: "Audio", icon: PhSpeakerHigh, component: AudioSettings },
  { id: "video", label: "Video", icon: PhCamera, component: VideoSettings },
  { id: "appearance", label: "Appearance", icon: PhPalette, component: AppearanceSettings },
  { id: "sounds", label: "Sounds", icon: PhMusicNotes, component: SoundPackSettings },
  { id: "application", label: "Application", icon: PhMonitor, component: ApplicationSettings },
  { id: "debug", label: "Debug", icon: PhBug, component: DebugSettings },
  { id: "about", label: "About", icon: PhInfo, component: AboutSettings },
]
