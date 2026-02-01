<template>
  <div class="p-6">
    <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-medium text-white">Connection Logs</h3>

        <button
          type="button"
          class="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
          @click="$emit('clearLogs')"
        >
          Clear Logs
        </button>
      </div>
      
      <div class="space-y-2 max-h-96 overflow-y-auto">
        <div
          v-for="log in logs"
          :key="log.id"
          class="flex items-start space-x-3 text-xs p-2 rounded"
          :class="getLogStyle(log.level)"
        >
          <span class="text-gray-500 font-mono">{{ formatTime(log.timestamp) }}</span>

          <span class="font-mono">{{ log.userId || 'System' }}</span>

          <span class="flex-1">{{ log.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ConnectionLog } from '@/types'

interface Props {
  logs: ConnectionLog[]
}

defineProps<Props>()

defineEmits<{
  clearLogs: []
}>()

const getLogStyle = (level: 'info' | 'warning' | 'error'): string => {
  switch (level) {
    case 'error': return 'bg-red-900/30 text-red-300'
    case 'warning': return 'bg-yellow-900/30 text-yellow-300'
    default: return 'bg-gray-900/30 text-gray-300'
  }
}

const formatTime = (timestamp: Date): string => {
  return timestamp.toLocaleTimeString()
}
</script>