<template>
  <div class="bg-gray-800 px-6 py-4 border-b border-gray-700">
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <PhBug class="w-5 h-5 text-blue-400" />

        <h2 class="text-lg font-semibold text-white">WebRTC Debug Dashboard</h2>

        <div class="flex items-center space-x-2 text-sm text-gray-400">
          <div class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>

          <span>Live</span>
        </div>
      </div>
      
      <!-- Tabs -->
      <div class="flex items-center space-x-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="[
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            activeTab === tab.id
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          ]"
          @click="$emit('tab-change', tab.id)"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PhBug } from '@phosphor-icons/vue'

interface Tab {
  id: 'metrics' | 'network' | 'logs' | 'issues' | 'ice-candidates'
  label: string
}

interface Props {
  activeTab: Tab['id']
  tabs: Tab[]
}

defineProps<Props>()

defineEmits<{
  'tab-change': [tabId: Tab['id']]
}>()
</script>