<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    @click.self="close">
    <div
      class="bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl mx-4 overflow-hidden flex"
      style="max-height: 80vh">
      <!-- Sidebar Tabs -->
      <div class="w-48 bg-gray-700 border-r border-gray-600 flex flex-col">
        <!-- Header -->
        <div class="px-4 py-4 border-b border-gray-600">
          <h2 class="text-lg font-semibold text-white flex items-center gap-2">
            <PhGearSix class="w-5 h-5 text-indigo-400" />
            Settings
          </h2>
        </div>

        <!-- Tab Buttons -->
        <div class="flex-1 p-2 space-y-1">
          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === 'audio'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:bg-gray-600 hover:text-white'
            "
            @click="currentTab = 'audio'">
            <PhSpeakerHigh class="w-5 h-5" />

            <span class="font-medium">Audio</span>
          </button>

          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === 'sounds'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:bg-gray-600 hover:text-white'
            "
            @click="currentTab = 'sounds'">
            <PhMusicNotes class="w-5 h-5" />

            <span class="font-medium">Sounds</span>
          </button>

          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === 'account'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:bg-gray-600 hover:text-white'
            "
            @click="currentTab = 'account'">
            <PhUser class="w-5 h-5" />

            <span class="font-medium">Account</span>
          </button>

          <button
            type="button"
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-200"
            :class="
              currentTab === 'debug'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:bg-gray-600 hover:text-white'
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
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:bg-gray-600 hover:text-white'
            "
            @click="currentTab = 'about'">
            <PhInfo class="w-5 h-5" />

            <span class="font-medium">About</span>
          </button>
        </div>

        <!-- Close Button at Bottom -->
        <div class="p-2 border-t border-gray-600">
          <button
            type="button"
            class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-600 transition-colors duration-200"
            @click="close">
            <PhX class="w-4 h-4" />

            <span class="text-sm">Close</span>
          </button>
        </div>
      </div>

      <!-- Content Area -->
      <div class="flex-1 overflow-y-auto">
        <div class="p-6">
          <!-- Audio Settings Tab -->
          <AudioSettings v-if="currentTab === 'audio'" />

          <!-- Sounds Settings Tab -->
          <SoundPackSettings v-else-if="currentTab === 'sounds'" />

          <!-- Account Settings Tab -->
          <AccountSettings v-else-if="currentTab === 'account'" @logout="close" />

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
import AudioSettings from "./AudioSettings.vue"
import SoundPackSettings from "./SoundPackSettings.vue"
import AccountSettings from "./AccountSettings.vue"
import DebugSettings from "./DebugSettings.vue"
import AboutSettings from "./AboutSettings.vue"
import {
  PhGearSix,
  PhSpeakerHigh,
  PhMusicNotes,
  PhUser,
  PhBug,
  PhX,
  PhInfo,
} from "@phosphor-icons/vue"

const modalStore = useModalStore()
const currentTab = ref<"audio" | "sounds" | "account" | "debug" | "about">("audio")

const isOpen = computed(() => modalStore.isUserSettingsModal)

function close() {
  modalStore.closeModal()
  currentTab.value = "audio"
}
</script>
