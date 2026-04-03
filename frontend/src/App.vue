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
import { useRouter } from "vue-router"
import { useAppStore, useRoomStore, useThemeStore } from "@/stores"
import { useKeyboardShortcuts } from "@/composables/useKeyboardShortcuts"
import { isElectron, onDeepLink } from "@/services/electron"

const router = useRouter()
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

  if (isElectron()) {
    onDeepLink((url: string) => {
      console.log("[App] Deep link received:", url.substring(0, 30) + "...")
      if (url.startsWith("orbital://auth/callback")) {
        router.push(url.replace("orbital://", "/"))
      }
    })
  }
})

onUnmounted(() => {
  window.removeEventListener("resize", checkMobile)
})
</script>
