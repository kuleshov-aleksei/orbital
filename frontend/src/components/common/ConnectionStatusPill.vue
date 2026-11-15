<template>
  <Transition name="conn-pill">
    <div
      v-if="visible"
      class="absolute left-1/2 -translate-x-1/2 top-16 mt-2 z-30 pointer-events-none"
      data-testid="connection-status">
      <div
        class="pointer-events-auto flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg border"
        :class="
          shownStatus === 'offline'
            ? 'bg-amber-950/90 border-amber-700/60 text-amber-100'
            : 'bg-theme-bg-secondary/95 border-theme-border text-theme-text-secondary'
        "
        role="status"
        aria-live="polite">
        <span
          v-if="shownStatus === 'connecting'"
          class="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
        <span v-else class="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span>{{ label }}</span>
        <button
          v-if="shownStatus === 'offline'"
          type="button"
          class="underline underline-offset-2 hover:text-white"
          @click="retry">
          Retry
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useConnectionStatusLabel } from "@/composables/useConnectionStatusLabel"
import { useConnectionStore } from "@/stores/connection"

const { visible, shownStatus, label } = useConnectionStatusLabel()
const connection = useConnectionStore()

const retry = () => connection.probe()
</script>

<style scoped>
.conn-pill-enter-active,
.conn-pill-leave-active {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}
.conn-pill-enter-from,
.conn-pill-leave-to {
  opacity: 0;
  /* Tailwind 4 centers with the translate property; transform stacks on it. */
  transform: translateY(-0.5rem);
}
</style>
