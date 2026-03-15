<template>
  <div class="text-center">
    <!-- Icon based on captcha type -->
    <div class="mb-4 text-6xl" />

    <!-- Main message -->
    <h2 class="text-2xl font-bold mb-4 text-red-500">Are you a robot?</h2>

    <!-- Completion checkmark -->
    <Transition name="fade">
      <svg
        v-if="isCompleted"
        class="w-16 h-16 text-green-500 mx-auto mb-4 animate-bounce"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
      </svg>
    </Transition>

    <!-- Verify button -->
    <button
      v-if="!isCompleted"
      type="button"
      class="mt-4 px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors duration-200"
      @click="handleVerify">
      I'm Not a Robot
    </button>

    <!-- Type indicator -->
    <div class="text-sm text-gray-400 mt-2">
      {{ getTypeLabel() }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue"
import { useAprilStore } from "@/stores/april"

const aprilStore = useAprilStore()

// Track completion state
let completed = false
watch(
  () => aprilStore.showCount,
  (count) => {
    if (count >= aprilStore.maxCaptchasBeforeDisable && !completed) {
      completed = true
    }
  },
  { immediate: false },
)

const isCompleted = computed(() => completed)

// Handle verification button click
function handleVerify() {
  completed = true
  aprilStore.completeCaptcha()
}

// Get type label
function getTypeLabel(): string {
  switch (aprilStore.currentType) {
    case "join":
      return "Join attempt blocked"
    case "theme":
      return "Theme change intercepted"
    case "settings":
      return "Settings access denied"
    case "mute":
      return "Mute action stopped"
    case "leave":
      return "Leave prevented"
    case "volume":
      return "Volume adjustment halted"
    case "video":
      return "Camera sharing blocked"
    case "screenshare":
      return "Screensharing blocked"
    default:
      return "Captcha required"
  }
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
