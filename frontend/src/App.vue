<template>
  <div
    id="app"
    :data-theme="themeStore.currentTheme"
    class="h-screen bg-theme-bg-primary text-theme-text-primary">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue"
import { useAppStore, useRoomStore, useThemeStore } from "@/stores"

const appStore = useAppStore()
const roomStore = useRoomStore()
const themeStore = useThemeStore()

const checkMobile = () => {
  appStore.checkMobile()
}

onMounted(() => {
  checkMobile()
  window.addEventListener("resize", checkMobile)
  roomStore.loadUserVolumes()
})

onUnmounted(() => {
  window.removeEventListener("resize", checkMobile)
})
</script>
