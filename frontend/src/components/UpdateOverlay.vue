<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-[#1a1a1a]">
    <div class="w-full max-w-md px-6">
      <div class="flex flex-col items-center">
        <div class="w-20 h-20 mb-8 rounded-2xl bg-indigo-600 flex items-center justify-center">
          <PhArrowClockwise class="w-10 h-10 text-white" :class="{ 'animate-spin': isAnimating }" />
        </div>

        <h2 class="text-2xl font-bold text-white mb-2">Updating Orbital</h2>
        <p class="text-gray-400 text-center mb-8">
          {{ statusText }}
        </p>

        <div v-if="showProgress" class="w-full mb-8">
          <div class="h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
            <div
              class="h-full bg-indigo-600 transition-all duration-300 ease-out rounded-full"
              :style="{ width: `${updateProgress.percent}%` }"></div>
          </div>
          <div class="flex justify-between text-sm text-gray-400">
            <span>{{ Math.round(updateProgress.percent) }}%</span>
            <span
              >{{ formatBytes(updateProgress.transferred) }} /
              {{ formatBytes(updateProgress.total) }}</span
            >
          </div>
        </div>

        <div
          v-if="updateError"
          class="w-full mb-8 p-4 bg-red-900/30 border border-red-800 rounded-lg">
          <p class="text-red-400 text-center text-sm">{{ updateError }}</p>
        </div>

        <div v-if="updateState === 'ready'" class="flex gap-3 w-full">
          <button
            type="button"
            class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
            @click="install">
            Restart to Update
          </button>
        </div>

        <button
          v-if="updateState === 'error'"
          type="button"
          class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          @click="$emit('retry')">
          Try Again
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { PhArrowClockwise } from "@phosphor-icons/vue"
import { installUpdate } from "@/services/electron"

interface UpdateProgress {
  percent: number
  transferred: number
  total: number
}

interface Props {
  updateState: string
  updateError: string | null
  updateProgress: UpdateProgress
}

const props = defineProps<Props>()

defineEmits<{
  retry: []
}>()

const isAnimating = computed(() => {
  return (
    props.updateState === "checking" ||
    props.updateState === "available" ||
    props.updateState === "downloading"
  )
})

const showProgress = computed(() => {
  return props.updateState === "downloading"
})

const statusText = computed(() => {
  switch (props.updateState) {
    case "idle":
      return ""
    case "checking":
      return "Checking for updates..."
    case "available":
      return "Preparing download..."
    case "downloading":
      return "Downloading update..."
    case "ready":
      return "Update ready to install"
    case "error":
      return "An error occurred"
    case "not-available":
      return "No updates available"
    default:
      return ""
  }
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function install() {
  installUpdate()
}
</script>
