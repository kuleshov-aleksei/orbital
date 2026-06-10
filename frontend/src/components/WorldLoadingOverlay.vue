<template>
  <Transition name="fade">
    <div
      v-if="store.active"
      class="absolute inset-0 z-50 flex items-center justify-center"
      style="background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(4px)">
      <div
        class="bg-theme-bg-secondary rounded-xl px-8 py-6 flex flex-col items-center gap-4 min-w-[280px]">
        <div
          class="animate-spin rounded-full h-6 w-6 border-b-2 border-t-2 border-theme-accent">
        </div>
        <div class="w-full flex flex-col gap-2">
          <div class="relative w-full h-2 bg-theme-bg-tertiary rounded-full overflow-hidden">
            <div
              class="absolute inset-y-0 left-0 rounded-full bg-theme-accent transition-[width] duration-300 ease-out"
              :style="{ width: `${store.progress}%` }" />
          </div>
          <p class="text-sm text-theme-text-muted text-center">{{ store.stage }}</p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useWorldLoadingStore } from "@/stores/worldLoading"

const store = useWorldLoadingStore()
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 300ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
