<template>
  <div id="app" class="h-screen bg-gray-900 text-white">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue"
import { useAppStore } from "@/stores"

// Initialize mobile detection
const appStore = useAppStore()

const checkMobile = () => {
  appStore.checkMobile()
}

onMounted(() => {
  checkMobile()
  window.addEventListener("resize", checkMobile)
})

onUnmounted(() => {
  window.removeEventListener("resize", checkMobile)
})
</script>
