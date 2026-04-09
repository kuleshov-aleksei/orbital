<template>
  <!-- Error Message -->
  <div
    v-if="appStore.errorMessage"
    class="fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg z-50 max-w-md text-center">
    {{ appStore.errorMessage }}
  </div>

  <!-- Connecting Overlay -->
  <div
    v-if="appStore.isConnecting"
    class="fixed inset-0 bg-black/60 z-40 flex items-center justify-center">
    <div class="bg-theme-bg-secondary rounded-lg p-6 flex items-center space-x-3">
      <div
        class="animate-spin rounded-full h-6 w-6 border-b-2 border-t-2 border-theme-text-primary"></div>

      <span class="text-theme-text-primary">Connecting to voice server...</span>
    </div>
  </div>

  <!-- Loading Overlay -->
  <div
    v-if="appStore.isLoading"
    class="fixed inset-0 bg-black/60 z-40 flex items-center justify-center">
    <div class="bg-theme-bg-secondary rounded-lg p-6 flex items-center space-x-3">
      <div
        class="animate-spin rounded-full h-6 w-6 border-b-2 border-t-2 border-theme-text-primary"></div>

      <span class="text-theme-text-primary">Preparing your experience...</span>
    </div>
  </div>

  <!-- Mobile Overlay -->
  <div
    v-if="appStore.mobileSidebarOpen || appStore.mobileUserSidebarOpen"
    class="lg:hidden fixed inset-0 bg-black/60 z-30"
    @click="appStore.closeAllMobileSidebars()"></div>

  <!-- Update Overlay -->
  <UpdateOverlay
    v-if="showUpdateOverlay"
    :update-state="appStore.updateState"
    :update-error="appStore.updateError"
    :update-progress="appStore.updateProgress"
    @retry="retryUpdate"
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue"
import { useAppStore } from "@/stores"
import {
  isElectron,
  isElectronDev,
  onUpdateChecking,
  onUpdateAvailable,
  onUpdateProgress,
  onUpdateDownloaded,
  onUpdateError,
  onUpdateNotAvailable,
} from "@/services/electron"
import UpdateOverlay from "@/components/UpdateOverlay.vue"

const appStore = useAppStore()

const showUpdateOverlay = computed(() => {
  return (
    isElectron() &&
    !isElectronDev() &&
    appStore.updateState !== "idle" &&
    appStore.updateState !== "not-available"
  )
})

function retryUpdate() {
  appStore.setUpdateState("checking")
}

onMounted(() => {
  if (isElectron() && !isElectronDev()) {
    appStore.setUpdateState("checking")
  }

  onUpdateChecking(() => {
    appStore.setUpdateState("checking")
  })

  onUpdateAvailable(() => {
    appStore.setUpdateState("available")
  })

  onUpdateProgress((info) => {
    appStore.setUpdateState("downloading")
    appStore.setUpdateProgress(info.percent, info.transferred, info.total)
  })

  onUpdateDownloaded(() => {
    appStore.setUpdateState("ready")
  })

  onUpdateError((info) => {
    appStore.setUpdateState("error", info.message)
  })

  onUpdateNotAvailable(() => {
    appStore.setUpdateState("not-available")
    setTimeout(() => {
      appStore.setUpdateState("idle")
    }, 2000)
  })
})
</script>
