<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-[#1a1a1a]">
    <div class="w-full max-w-md px-6">
      <div class="flex flex-col items-center">
        <div class="w-20 h-20 mb-8 rounded-2xl bg-indigo-600 flex items-center justify-center">
          <PhArrowClockwise class="w-10 h-10 text-white" :class="{ 'animate-spin': isDownloading }" />
        </div>

        <h2 class="text-2xl font-bold text-white mb-2">Updating Orbital</h2>
        <p class="text-gray-400 text-center mb-8">
          {{ statusText }}
        </p>

        <div v-if="showProgress" class="w-full mb-8">
          <div class="h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
            <div
              class="h-full bg-indigo-600 transition-all duration-300 ease-out rounded-full"
              :style="{ width: `${progressInfo?.percent || 0}%` }"></div>
          </div>
          <div class="flex justify-between text-sm text-gray-400">
            <span>{{ Math.round(progressInfo?.percent || 0) }}%</span>
            <span>{{ formatBytes(progressInfo?.transferred || 0) }} / {{ formatBytes(progressInfo?.total || 0) }}</span>
          </div>
        </div>

        <div v-if="errorMessage" class="w-full mb-8 p-4 bg-red-900/30 border border-red-800 rounded-lg">
          <p class="text-red-400 text-center text-sm">{{ errorMessage }}</p>
        </div>

        <button
          v-if="canInstall"
          type="button"
          class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          @click="install">
          Restart to Update
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { PhArrowClockwise } from "@phosphor-icons/vue"
import { onUpdateAvailable, onUpdateProgress, onUpdateDownloaded, onUpdateError, installUpdate, isElectron } from "@/services/electron"
import type { UpdateProgressInfo } from "@/types"

type UpdateStatus = "checking" | "downloading" | "verifying" | "ready" | "error"

const status = ref<UpdateStatus>("checking")
const progressInfo = ref<UpdateProgressInfo | null>(null)
const errorMessage = ref<string | null>(null)
const canInstall = ref(false)

const isDownloading = computed(() => status.value === "downloading")

const showProgress = computed(() => {
  return status.value === "downloading" || status.value === "verifying"
})

const statusText = computed(() => {
  switch (status.value) {
    case "checking":
      return "Checking for updates..."
    case "downloading":
      return "Downloading update..."
    case "verifying":
      return "Verifying update..."
    case "ready":
      return "Update ready to install"
    case "error":
      return "An error occurred"
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

onMounted(() => {
  onUpdateAvailable((info) => {
    status.value = "downloading"
  })

  onUpdateProgress((info) => {
    progressInfo.value = info
  })

  onUpdateDownloaded(() => {
    status.value = "verifying"
    setTimeout(() => {
      status.value = "ready"
      canInstall.value = true
    }, 1500)
  })

  onUpdateError((info) => {
    errorMessage.value = info.message
    status.value = "error"
  })
})
</script>
