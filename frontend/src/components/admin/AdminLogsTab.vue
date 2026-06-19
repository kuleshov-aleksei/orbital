<template>
  <div class="bg-gray-800 rounded-lg border border-gray-700">
    <div class="p-4 border-b border-gray-700 flex items-center justify-between">
      <h2 class="text-lg font-semibold text-white">Debug Logs</h2>
      <div class="flex items-center gap-4">
        <span class="text-sm text-gray-400">{{ logs.length }} logs</span>
        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          :disabled="loadingLogs"
          @click="loadLogs">
          <span v-if="loadingLogs">Loading...</span>
          <span v-else>Refresh</span>
        </button>
      </div>
    </div>

    <div class="divide-y divide-gray-700">
      <div
        v-for="log in logs"
        :key="log.id"
        class="p-4 flex items-center justify-between hover:bg-gray-700/50 transition-colors">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-medium text-white">{{ log.username }}</span>
            <span class="text-xs px-2 py-0.5 bg-gray-600 text-gray-300 rounded">
              ID: {{ log.user_id.slice(0, 8) }}...
            </span>
            <span
              v-if="log.version"
              class="text-xs px-2 py-0.5 bg-indigo-600/20 text-indigo-400 rounded">
              {{ log.version }}
            </span>
          </div>
          <div class="text-sm text-gray-400">
            {{ formatDate(log.created_at) }} • {{ log.log_filename }}
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
            @click="viewLog(log.id)">
            View
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
            @click="downloadLog(log)">
            Download
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
            :disabled="deletingLogId === log.id"
            @click="confirmDeleteLog(log.id)">
            <span v-if="deletingLogId === log.id">Deleting...</span>
            <span v-else>Delete</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="logs.length === 0 && !loadingLogs" class="p-8 text-center">
      <PhFileText class="w-12 h-12 text-gray-600 mx-auto mb-4" />
      <p class="text-gray-400">No debug logs found</p>
    </div>
  </div>

  <!-- View Log Modal -->
  <div
    v-if="showLogModal"
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    @click.self="showLogModal = false">
    <div
      class="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="text-lg font-semibold text-white">Debug Log</h3>
          <p class="text-sm text-gray-400">
            {{ selectedLog?.username }} ({{ selectedLog?.user_id }}) •
            {{ formatDate(selectedLog?.created_at || "") }}
          </p>
        </div>
        <button type="button" class="text-gray-400 hover:text-white" @click="showLogModal = false">
          <PhX class="w-6 h-6" />
        </button>
      </div>
      <div class="flex-1 overflow-auto bg-gray-900 rounded p-4">
        <pre class="text-sm text-green-400 font-mono whitespace-pre-wrap">{{ logContent }}</pre>
      </div>
    </div>
  </div>

  <!-- Delete Log Confirmation Modal -->
  <div
    v-if="showDeleteLogModal"
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    @click.self="showDeleteLogModal = false">
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4">
      <h3 class="text-lg font-semibold text-white mb-4">Delete Log</h3>
      <p class="text-gray-300 mb-6">
        Are you sure you want to delete this debug log? This action cannot be undone.
      </p>
      <div class="flex justify-end gap-3">
        <button
          type="button"
          class="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          @click="showDeleteLogModal = false">
          Cancel
        </button>
        <button
          type="button"
          class="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
          @click="deleteLog">
          Delete
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue"
import { apiService } from "@/services/api"
import type { DebugLog } from "@/types"
import { PhFileText, PhX } from "@phosphor-icons/vue"

const logs = ref<DebugLog[]>([])
const loadingLogs = ref(false)
const deletingLogId = ref<number | null>(null)
const showLogModal = ref(false)
const selectedLog = ref<DebugLog | null>(null)
const logContent = ref("")
const showDeleteLogModal = ref(false)
const logToDelete = ref<number | null>(null)

const formatDate = (dateStr: string): string => {
  if (!dateStr) return ""
  return new Date(dateStr).toLocaleString()
}

const loadLogs = async () => {
  loadingLogs.value = true
  try {
    logs.value = await apiService.getLogs()
  } catch (error) {
    console.error("Failed to load logs:", error)
  } finally {
    loadingLogs.value = false
  }
}

const viewLog = async (logId: number) => {
  try {
    const response = await apiService.getLog(logId)
    selectedLog.value = response.log
    logContent.value = response.content
    showLogModal.value = true
  } catch (error) {
    console.error("Failed to load log:", error)
  }
}

const downloadLog = async (log: DebugLog) => {
  try {
    const response = await apiService.getLog(log.id)
    const blob = new Blob([response.content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = response.log.log_filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error("Failed to download log:", error)
  }
}

const confirmDeleteLog = (logId: number) => {
  logToDelete.value = logId
  showDeleteLogModal.value = true
}

const deleteLog = async () => {
  if (!logToDelete.value) return
  deletingLogId.value = logToDelete.value
  showDeleteLogModal.value = false
  try {
    await apiService.deleteLog(logToDelete.value)
    await loadLogs()
  } catch (error) {
    console.error("Failed to delete log:", error)
  } finally {
    deletingLogId.value = null
    logToDelete.value = null
  }
}

onMounted(() => {
  void loadLogs()
})
</script>
