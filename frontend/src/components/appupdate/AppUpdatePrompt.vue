<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50 p-4 safe-area-pad"
      data-testid="app-update-prompt"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-update-title"
      @click.self="later">
      <div class="bg-theme-bg-secondary rounded-lg p-6 w-full max-w-sm shadow-xl">
        <h2 id="app-update-title" class="text-lg font-semibold text-theme-text-primary mb-1">
          Update available
        </h2>
        <p class="text-sm text-theme-text-secondary mb-1">
          Orbital {{ store.latestVersion }} is out. You have {{ store.currentVersion }}.
        </p>
        <p class="text-xs text-theme-text-muted mb-5">
          The download opens in your browser. If Android asks, allow the browser to install apps.
        </p>
        <div class="flex gap-3">
          <button
            type="button"
            class="flex-1 px-4 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg transition-colors"
            data-testid="app-update-later"
            @click="later">
            Later
          </button>
          <button
            type="button"
            class="flex-1 px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg transition-colors"
            data-testid="app-update-download"
            @click="download">
            Download
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useAppUpdateStore } from "@/stores/appUpdate"
import { openExternal } from "@/services/platform"

const store = useAppUpdateStore()

function later() {
  store.dismiss()
}

function download() {
  if (store.downloadUrl) void openExternal(store.downloadUrl)
  // Don't nag again for this version; the installer takes it from here.
  store.dismiss()
}
</script>
