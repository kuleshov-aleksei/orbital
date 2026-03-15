<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50"
    @click.self="close">
    <div
      class="bg-theme-bg-secondary rounded-xl shadow-xl w-full mx-4 overflow-hidden flex flex-col"
      style="max-height: 90vh; height: 90vh">
      <!-- Header -->
      <div
        class="px-4 py-4 border-b border-theme-border flex items-center justify-between flex-shrink-0">
        <div class="flex items-center gap-2">
          <button
            v-if="currentTab"
            type="button"
            class="p-1 -ml-1 text-theme-text-muted hover:text-theme-text-primary transition-colors"
            @click="currentTab = undefined">
            <PhCaretLeft class="w-5 h-5" />
          </button>
          <h2 class="text-lg font-semibold text-theme-text-primary flex items-center gap-2">
            <PhGearSix v-if="!currentTab" class="w-5 h-5 text-theme-accent" />
            <PhUser v-else-if="currentTab === 'account'" class="w-5 h-5 text-theme-accent" />
            <PhSpeakerHigh v-else-if="currentTab === 'audio'" class="w-5 h-5 text-theme-accent" />
            <PhCamera v-else-if="currentTab === 'video'" class="w-5 h-5 text-theme-accent" />
            <PhPalette v-else-if="currentTab === 'appearance'" class="w-5 h-5 text-theme-accent" />
            <PhMusicNotes v-else-if="currentTab === 'sounds'" class="w-5 h-5 text-theme-accent" />
            <PhBug v-else-if="currentTab === 'debug'" class="w-5 h-5 text-theme-accent" />
            <PhInfo v-else-if="currentTab === 'about'" class="w-5 h-5 text-theme-accent" />
            {{ currentTab ? tabLabels[currentTab] : "Settings" }}
          </h2>
        </div>
        <button
          type="button"
          class="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover rounded-lg transition-colors"
          @click="close">
          <PhX class="w-5 h-5" />
        </button>
      </div>

      <!-- Content Area -->
      <div class="flex-1 overflow-y-auto p-2">
        <!-- Main List View -->
        <div v-if="!currentTab" class="space-y-1">
          <button
            type="button"
            class="w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-colors duration-200 bg-theme-accent text-theme-text-on-accent"
            @click="currentTab = 'account'">
            <div class="flex items-center gap-3">
              <PhUser class="w-5 h-5" />
              <span class="font-medium">Account</span>
            </div>
            <PhCaretRight class="w-5 h-5" />
          </button>

          <button
            type="button"
            class="w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-colors duration-200 text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary"
            @click="currentTab = 'audio'">
            <div class="flex items-center gap-3">
              <PhSpeakerHigh class="w-5 h-5" />
              <span class="font-medium">Audio</span>
            </div>
            <PhCaretRight class="w-5 h-5" />
          </button>

          <button
            type="button"
            class="w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-colors duration-200 text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary"
            @click="currentTab = 'video'">
            <div class="flex items-center gap-3">
              <PhCamera class="w-5 h-5" />
              <span class="font-medium">Video</span>
            </div>
            <PhCaretRight class="w-5 h-5" />
          </button>

          <button
            type="button"
            class="w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-colors duration-200 text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary"
            @click="currentTab = 'appearance'">
            <div class="flex items-center gap-3">
              <PhPalette class="w-5 h-5" />
              <span class="font-medium">Appearance</span>
            </div>
            <PhCaretRight class="w-5 h-5" />
          </button>

          <button
            type="button"
            class="w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-colors duration-200 text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary"
            @click="currentTab = 'sounds'">
            <div class="flex items-center gap-3">
              <PhMusicNotes class="w-5 h-5" />
              <span class="font-medium">Sounds</span>
            </div>
            <PhCaretRight class="w-5 h-5" />
          </button>

          <button
            type="button"
            class="w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-colors duration-200 text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary"
            @click="currentTab = 'debug'">
            <div class="flex items-center gap-3">
              <PhBug class="w-5 h-5" />
              <span class="font-medium">Debug</span>
            </div>
            <PhCaretRight class="w-5 h-5" />
          </button>

          <button
            type="button"
            class="w-full flex items-center justify-between px-3 py-3 rounded-lg text-left transition-colors duration-200 text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary"
            @click="currentTab = 'about'">
            <div class="flex items-center gap-3">
              <PhInfo class="w-5 h-5" />
              <span class="font-medium">About</span>
            </div>
            <PhCaretRight class="w-5 h-5" />
          </button>
        </div>

        <!-- Settings Content View -->
        <div v-else class="space-y-4 pb-4">
          <!-- Account Settings Tab -->
          <AccountSettings v-if="currentTab === 'account'" :hide-header="true" @logout="close" />

          <!-- Audio Settings Tab -->
          <AudioSettings v-else-if="currentTab === 'audio'" :hide-header="true" />

          <!-- Video Settings Tab -->
          <VideoSettings v-else-if="currentTab === 'video'" :hide-header="true" />

          <!-- Sounds Settings Tab -->
          <SoundPackSettings v-else-if="currentTab === 'sounds'" :hide-header="true" />

          <!-- Appearance Settings Tab -->
          <AppearanceSettings v-else-if="currentTab === 'appearance'" :hide-header="true" />

          <!-- Debug Settings Tab -->
          <DebugSettings v-else-if="currentTab === 'debug'" :hide-header="true" />

          <!-- About Settings Tab -->
          <AboutSettings v-else-if="currentTab === 'about'" :hide-header="true" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue"
import { useModalStore } from "@/stores/modal"
import AudioSettings from "./AudioSettings.vue"
import VideoSettings from "./VideoSettings.vue"
import SoundPackSettings from "./SoundPackSettings.vue"
import AppearanceSettings from "./AppearanceSettings.vue"
import AccountSettings from "./AccountSettings.vue"
import DebugSettings from "./DebugSettings.vue"
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
  PhCaretRight,
  PhCaretLeft,
} from "@phosphor-icons/vue"

const modalStore = useModalStore()
const currentTab = ref<
  "audio" | "video" | "sounds" | "appearance" | "account" | "debug" | "about" | undefined
>(undefined)

const tabLabels: Record<string, string> = {
  account: "Account",
  audio: "Audio",
  video: "Video",
  appearance: "Appearance",
  sounds: "Sounds",
  debug: "Debug",
  about: "About",
}

const isOpen = computed(() => modalStore.isUserSettingsModal)

function close() {
  modalStore.closeModal()
  currentTab.value = undefined
}
</script>
