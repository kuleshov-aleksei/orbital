<template>
  <div
    class="fixed left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm"
    style="bottom: calc(1rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))"
    data-testid="ota-ready-toast"
    role="status">
    <div
      class="flex items-center gap-3 bg-theme-bg-secondary border border-theme-border rounded-lg shadow-xl px-4 py-3">
      <p class="flex-1 text-sm text-theme-text-primary">
        Orbital {{ store.readyVersion }} is ready.
        <span class="text-theme-text-muted">Reload to update.</span>
      </p>
      <button
        type="button"
        class="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary rounded-lg transition-colors"
        data-testid="ota-later"
        @click="store.dismiss()">
        Later
      </button>
      <button
        type="button"
        class="px-3 py-1.5 text-sm bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent font-semibold rounded-lg transition-colors disabled:opacity-60"
        :disabled="store.applying"
        data-testid="ota-reload"
        @click="store.apply()">
        Reload
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useOtaStore } from "@/stores/ota"

// A newer frontend was downloaded over the air (stores/ota.ts). Shown only
// outside calls; "Later" still applies it when idle or on the next launch.
const store = useOtaStore()
</script>
