<template>
  <div
    class="fixed inset-0 z-[200] flex items-center justify-center bg-theme-bg-primary p-6 safe-area-pad"
    data-testid="app-outdated-screen"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="app-outdated-title">
    <div class="w-full max-w-sm text-center">
      <h2 id="app-outdated-title" class="text-xl font-semibold text-theme-text-primary mb-2">
        Update required
      </h2>
      <p class="text-sm text-theme-text-secondary mb-1">
        This version of Orbital ({{ store.currentVersion }}) is no longer supported.
        <template v-if="store.minVersion"
          >Version {{ store.minVersion }} or newer is needed.</template
        >
      </p>
      <p class="text-xs text-theme-text-muted mb-6">
        The download opens in your browser. If Android asks, allow the browser to install apps.
      </p>
      <button
        type="button"
        class="w-full px-4 py-3 mb-3 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent font-semibold rounded-lg transition-colors disabled:opacity-60"
        :disabled="!store.downloadUrl"
        data-testid="app-outdated-download"
        @click="download">
        {{ store.downloadUrl ? `Download ${store.latestVersion}` : "Looking for the update…" }}
      </button>
      <button
        type="button"
        class="w-full px-4 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg transition-colors disabled:opacity-60"
        :disabled="store.checking"
        data-testid="app-outdated-check"
        @click="store.check()">
        Check again
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue"
import { useAppUpdateStore } from "@/stores/appUpdate"
import { useCallStore, useRoomStore } from "@/stores"
import { openExternal } from "@/services/platform"
import { wsService } from "@/services/websocket"

const store = useAppUpdateStore()
const roomStore = useRoomStore()
const callStore = useCallStore()

function download() {
  if (store.downloadUrl) void openExternal(store.downloadUrl)
}

onMounted(() => {
  if (!store.downloadUrl) void store.check()
  // Drop out of a voice call: the backend refuses this build, so the room
  // can't be left through the API. Clearing the active room unmounts the
  // call view, which disconnects LiveKit.
  if (roomStore.activeRoomId) {
    wsService.disconnect()
    roomStore.setActiveRoom(null)
    callStore.resetCallState()
  }
})
</script>
