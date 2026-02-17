<template>
  <div class="space-y-4">
    <h3 class="text-lg font-medium text-white flex items-center gap-2">
      <PhBug class="w-5 h-5 text-indigo-400" />
      Debug Settings
    </h3>

    <p class="text-sm text-gray-400">
      These settings are for troubleshooting and development purposes.
    </p>

    <!-- Debug Logs Toggle -->
    <div class="flex items-center justify-between pt-2 border-t border-gray-700">
      <div>
        <label class="text-sm font-medium text-gray-200 block"> Enable Debug Logs </label>

        <p class="text-xs text-gray-400 mt-0.5">
          Show verbose LiveKit and WebSocket logs in the browser console. Useful for troubleshooting
          connection issues.
        </p>
      </div>

      <button
        type="button"
        class="relative inline-flex h-6 w-12 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800"
        :class="debugLogsEnabled ? 'bg-indigo-600' : 'bg-gray-600'"
        @click="toggleDebugLogs">
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
          :class="debugLogsEnabled ? 'translate-x-7' : 'translate-x-1'" />
      </button>
    </div>

    <!-- Note about error logs -->
    <div class="pt-2 border-t border-gray-700">
      <p class="text-xs text-gray-500">
        <span class="font-medium">Note:</span>
        Error messages will always be shown in the console regardless of this setting, as they are
        important for debugging issues.
      </p>
    </div>

    <!-- Application Version -->
    <div class="pt-4 border-t border-gray-700">
      <div class="flex items-center gap-2">
        <PhInfo class="w-4 h-4 text-gray-400" />
        <span class="text-sm font-medium text-gray-300">Version</span>
      </div>
      <p class="text-sm text-gray-400 mt-1 font-mono">
        {{ appVersion }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useDebugSettingsStore } from "@/stores/debugSettings"
import { PhBug, PhInfo } from "@phosphor-icons/vue"

// Global constant defined in vite.config.ts
declare const __APP_VERSION__: string

const debugStore = useDebugSettingsStore()

// Computed
const debugLogsEnabled = computed(() => debugStore.isDebugLogsEnabled)

// App version from build
const appVersion = __APP_VERSION__

// Methods
function toggleDebugLogs() {
  debugStore.toggleDebugLogs(!debugLogsEnabled.value)
}
</script>
