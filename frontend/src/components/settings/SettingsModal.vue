<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50"
    @click.self="close">
    <div
      class="bg-theme-bg-secondary rounded-xl shadow-xl w-full max-w-2xl mx-4 overflow-hidden flex"
      style="max-height: 80vh">
      <!-- Sidebar Tabs -->
      <div class="w-48 bg-theme-bg-tertiary border-r border-theme-border flex flex-col">
        <!-- Header -->
        <div class="px-4 py-4 border-b border-theme-border">
          <h2 class="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
            <PhGearSix class="w-5 h-5 text-theme-accent" />
            Settings
          </h2>
        </div>

        <!-- Tab Buttons -->
        <div class="flex-1 p-2 space-y-1">
          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === 'account'
                ? 'bg-theme-accent text-theme-text-on-accent'
                : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
            "
            @click="currentTab = 'account'">
            <PhUser class="w-5 h-5" />

            <span class="font-medium">Account</span>
          </button>

          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === 'audio'
                ? 'bg-theme-accent text-theme-text-on-accent'
                : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
            "
            @click="currentTab = 'audio'">
            <PhSpeakerHigh class="w-5 h-5" />

            <span class="font-medium">Audio</span>
          </button>

          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === 'video'
                ? 'bg-theme-accent text-theme-text-on-accent'
                : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
            "
            @click="currentTab = 'video'">
            <PhCamera class="w-5 h-5" />

            <span class="font-medium">Video</span>
          </button>

          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === 'appearance'
                ? 'bg-theme-accent text-theme-text-on-accent'
                : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
            "
            @click="currentTab = 'appearance'">
            <PhPalette class="w-5 h-5" />

            <span class="font-medium">Appearance</span>
          </button>

          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === 'sounds'
                ? 'bg-theme-accent text-theme-text-on-accent'
                : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
            "
            @click="currentTab = 'sounds'">
            <PhMusicNotes class="w-5 h-5" />

            <span class="font-medium">Sounds</span>
          </button>

          <button
            v-if="isElectronApp"
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === 'application'
                ? 'bg-theme-accent text-theme-text-on-accent'
                : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
            "
            @click="currentTab = 'application'">
            <PhMonitor class="w-5 h-5" />

            <span class="font-medium">Application</span>
          </button>

          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === 'debug'
                ? 'bg-theme-accent text-theme-text-on-accent'
                : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
            "
            @click="currentTab = 'debug'">
            <PhBug class="w-5 h-5" />

            <span class="font-medium">Debug</span>
          </button>

          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === 'about'
                ? 'bg-theme-accent text-theme-text-on-accent'
                : 'text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary'
            "
            @click="currentTab = 'about'">
            <PhInfo class="w-5 h-5" />

            <span class="font-medium">About</span>
          </button>
        </div>

        <!-- Close Button at Bottom -->
        <div class="p-2 border-t border-theme-border">
          <button
            type="button"
            class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors duration-200"
            @click="close">
            <PhX class="w-4 h-4" />

            <span class="text-sm">Close</span>
          </button>
        </div>
      </div>

      <!-- Content Area -->
      <div class="flex-1 overflow-y-auto">
        <div class="p-6">
          <!-- Account Settings Tab -->
          <AccountSettings v-if="currentTab === 'account'" @logout="close" />

          <!-- Application Settings Tab -->
          <ApplicationSettings v-else-if="isElectronApp && currentTab === 'application'" />

          <!-- Audio Settings Tab -->
          <AudioSettings v-else-if="currentTab === 'audio'" />

          <!-- Video Settings Tab -->
          <VideoSettings v-else-if="currentTab === 'video'" />

          <!-- Sounds Settings Tab -->
          <SoundPackSettings v-else-if="currentTab === 'sounds'" />

          <!-- Appearance Settings Tab -->
          <AppearanceSettings v-else-if="currentTab === 'appearance'" />

          <!-- Debug Settings Tab -->
          <DebugSettings v-else-if="currentTab === 'debug'" />

          <!-- About Settings Tab -->
          <AboutSettings v-else-if="currentTab === 'about'" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue"
import { useModalStore } from "@/stores/modal"
import { isElectron } from "@/services/electron"
import AudioSettings from "./AudioSettings.vue"
import VideoSettings from "./VideoSettings.vue"
import SoundPackSettings from "./SoundPackSettings.vue"
import AppearanceSettings from "./AppearanceSettings.vue"
import AccountSettings from "./AccountSettings.vue"
import DebugSettings from "./DebugSettings.vue"
import ApplicationSettings from "./ApplicationSettings.vue"
import AboutSettings from "./AboutSettings.vue"
import {
  PhGearSix,
  PhSpeakerHigh,
  PhMusicNotes,
  PhPalette,
  PhUser,
  PhBug,
  PhX,
  PhInfo,
  PhCamera,
  PhMonitor,
} from "@phosphor-icons/vue"

const modalStore = useModalStore()
const isElectronApp = isElectron()
const currentTab = ref<
  "application" | "audio" | "video" | "sounds" | "appearance" | "account" | "debug" | "about"
>("account")

const isOpen = computed(() => modalStore.isUserSettingsModal)

function close() {
  modalStore.closeModal()
  currentTab.value = "account"
}
</script>
