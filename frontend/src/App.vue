<template>
  <div id="app" class="h-screen bg-gray-900 text-white">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue"
import { useAppStore, useRoomStore } from "@/stores"

const appStore = useAppStore()
const roomStore = useRoomStore()

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
