<template>
  <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-medium text-white">
        {{ getUserNickname(userId) }}
      </h3>

      <div
        class="px-2 py-1 text-xs rounded-full"
        :class="getIssuesBadgeClass(issues.quality)"
      >
        {{ issues.quality.toUpperCase() }}
      </div>
    </div>

    <div v-if="issues.issues.length > 0" class="space-y-2">
      <div class="text-xs text-gray-500 mb-2">Detected Issues:</div>

      <div
        v-for="issue in issues.issues"
        :key="issue"
        class="flex items-center space-x-2 text-xs"
      >
        <PhWarning class="w-3 h-3 text-yellow-400" />

        <span class="text-gray-300">{{ issue }}</span>
      </div>
    </div>

    <div v-if="issues.suggestions.length > 0" class="mt-4 space-y-2">
      <div class="text-xs text-gray-500 mb-2">Suggested Actions:</div>

      <div
        v-for="suggestion in issues.suggestions"
        :key="suggestion"
        class="flex items-start space-x-2 text-xs"
      >
        <PhInfo class="w-3 h-3 text-blue-400 mt-0.5" />

        <span class="text-gray-300">{{ suggestion }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PhWarning, PhInfo } from '@phosphor-icons/vue'

interface Props {
  userId: string
  issues: { quality: string, issues: string[], suggestions: string[] }
  getUserNickname: (userId: string) => string
}

defineProps<Props>()

const getIssuesBadgeClass = (quality: string): string => {
  switch (quality) {
    case 'EXCELLENT': return 'bg-green-600 text-white'
    case 'GOOD': return 'bg-blue-600 text-white'
    case 'FAIR': return 'bg-yellow-600 text-white'
    case 'POOR': return 'bg-red-600 text-white'
    default: return 'bg-gray-600 text-white'
  }
}
</script>