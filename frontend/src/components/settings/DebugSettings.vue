<template>
  <div class="space-y-4">
    <h3 class="text-lg font-medium text-theme-text-primary flex items-center gap-2">
      <PhBug class="w-5 h-5 text-theme-accent" />
      Debug Settings
    </h3>

    <p class="text-sm text-theme-text-muted">
      These settings are for troubleshooting and development purposes.
    </p>

    <!-- Debug Logs Toggle -->
    <div class="flex items-center justify-between pt-2 border-t border-theme-border">
      <div>
        <label class="text-sm font-medium text-theme-text-primary block"> Enable Debug Logs </label>

        <p class="text-xs text-theme-text-muted mt-0.5">
          Show verbose LiveKit and WebSocket logs in the browser console. Useful for troubleshooting
          connection issues.
        </p>
      </div>

      <button
        type="button"
        class="relative inline-flex h-6 w-12 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent focus:ring-offset-2 focus:ring-offset-theme-bg-primary"
        :class="debugLogsEnabled ? 'bg-theme-accent' : 'bg-theme-bg-hover'"
        @click="toggleDebugLogs">
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
          :class="debugLogsEnabled ? 'translate-x-7' : 'translate-x-1'" />
      </button>
    </div>

    <!-- Send Logs to Server -->
    <div class="pt-2 border-t border-theme-border">
      <div class="flex items-center justify-between gap-4">
        <div class="flex-1 min-w-0">
          <label class="text-sm font-medium text-theme-text-primary block">
            Send Logs to Server
          </label>

          <p class="text-xs text-theme-text-muted mt-0.5">
            Upload your debug logs to help troubleshoot issues. Logs are stored securely and only
            accessible to administrators.
          </p>
        </div>

        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-theme-accent hover:bg-theme-accent-hover disabled:bg-theme-bg-hover text-theme-text-on-accent rounded transition-colors whitespace-nowrap"
          :disabled="sendingLogs"
          @click="sendLogs">
          <span v-if="sendingLogs">Sending...</span>
          <span v-else>Send Logs</span>
        </button>
      </div>

      <p
        v-if="sendLogsStatus"
        class="text-xs mt-2"
        :class="sendLogsSuccess ? 'text-green-400' : 'text-red-400'">
        {{ sendLogsStatus }}
      </p>
    </div>

    <!-- Note about error logs -->
    <div class="pt-2 border-t border-theme-border">
      <p class="text-xs text-theme-text-muted">
        <span class="font-medium">Note:</span>
        Error messages will always be shown in the console regardless of this setting, as they are
        important for debugging issues.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { useDebugSettingsStore } from "@/stores/debugSettings"
import { useUserStore } from "@/stores/user"
import { apiService } from "@/services/api"
import { getLogBuffer } from "@/utils/debug"
import { PhBug } from "@phosphor-icons/vue"

declare const __APP_VERSION__: string

const debugStore = useDebugSettingsStore()
const userStore = useUserStore()

const debugLogsEnabled = computed(() => debugStore.isDebugLogsEnabled)

const appVersion = __APP_VERSION__

const sendingLogs = ref(false)
const sendLogsStatus = ref("")
const sendLogsSuccess = ref(false)

function toggleDebugLogs() {
  debugStore.toggleDebugLogs(!debugLogsEnabled.value)
}

async function sendLogs() {
  if (!userStore.currentUser) {
    sendLogsStatus.value = "You must be logged in to send logs"
    sendLogsSuccess.value = false
    return
  }

  sendingLogs.value = true
  sendLogsStatus.value = ""

  try {
    const logs = getLogBuffer()
    if (logs.length === 0) {
      sendLogsStatus.value = "No logs to send"
      sendLogsSuccess.value = false
      return
    }

    const logMessages = logs.map((log) => log.message)
    await apiService.sendLogs(
      userStore.currentUser.id,
      userStore.currentUser.nickname,
      appVersion,
      logMessages,
    )
    sendLogsStatus.value = "Logs sent successfully!"
    sendLogsSuccess.value = true
  } catch (error) {
    console.error("Failed to send logs:", error)
    sendLogsStatus.value = "Failed to send logs"
    sendLogsSuccess.value = false
  } finally {
    sendingLogs.value = false
  }
}
</script>
