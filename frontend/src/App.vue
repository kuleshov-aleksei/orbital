<template>
  <div
    id="app"
    :data-theme="themeStore.currentTheme"
    class="h-screen bg-theme-bg-primary text-theme-text-primary">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue"
import { useAppStore, useRoomStore, useThemeStore } from "@/stores"
import { useKeyboardShortcuts } from "@/composables/useKeyboardShortcuts"

const appStore = useAppStore()
const roomStore = useRoomStore()
const themeStore = useThemeStore()

useKeyboardShortcuts()

const checkMobile = () => {
  appStore.checkMobile()
}

watch(
  () => themeStore.currentTheme,
  (newTheme) => {
    document.body.dataset.theme = newTheme
  },
  { immediate: true },
)

watch(
  () => appStore.isMobile,
  (isMobile) => {
    if (isMobile && roomStore.activeRoomId && appStore.mobileView === "rooms") {
      appStore.showRoomView()
    }
  },
)

onMounted(() => {
  checkMobile()
  window.addEventListener("resize", checkMobile)
  roomStore.loadUserVolumes()
})

onUnmounted(() => {
  window.removeEventListener("resize", checkMobile)
})
</script>
