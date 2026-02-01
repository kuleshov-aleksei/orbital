<template>
  <div class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden hover:border-gray-600 transition-colors">
    <!-- Card Header -->
    <div class="flex items-center justify-between px-4 py-3 bg-gray-750 border-b border-gray-700">
      <div class="flex items-center space-x-3">
          <div 
            class="w-3 h-3 rounded-full"
            :class="getCandidateTypeColor(candidate?.type)"
          ></div>

          <div class="text-sm font-medium text-white">
            {{ candidate?.type?.toUpperCase() || 'UNKNOWN' }}
          </div>

        <div class="text-xs text-gray-400">
          Component {{ candidate?.component || 'N/A' }}
        </div>
      </div>

      <button
        type="button"
        class="flex items-center space-x-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
        @click="copyCandidate"
      >
        <PhCopy class="w-3 h-3" />

        <span>Copy</span>
      </button>
    </div>

    <!-- Card Content -->
    <div class="p-4 space-y-3">
      <!-- Endpoint -->
      <div class="flex items-center justify-between">
        <div class="text-xs text-gray-500">Endpoint</div>

        <div class="text-sm font-mono text-blue-400">
          {{ candidate?.protocol?.toUpperCase() || 'N/A' }}://{{ candidate?.address || 'N/A' }}:{{ candidate?.port || 'N/A' }}
        </div>
      </div>

      <!-- Priority -->
      <div class="flex items-center justify-between">
        <div class="text-xs text-gray-500">Priority</div>

        <div class="text-sm font-mono text-green-400">
          {{ candidate?.priority?.toLocaleString() || 'N/A' }}
        </div>
      </div>

      <!-- Foundation -->
      <div class="flex items-center justify-between">
        <div class="text-xs text-gray-500">Foundation</div>

        <div class="text-sm font-mono text-yellow-400">
          {{ candidate?.foundation || 'N/A' }}
        </div>
      </div>

      <!-- SDP Info -->
      <div class="grid grid-cols-2 gap-3 pt-3 border-t border-gray-700">
        <div>
          <div class="text-xs text-gray-500 mb-1">SDP Mid</div>

          <div class="text-sm font-mono text-gray-300">
            {{ candidate?.sdpMid || 'N/A' }}
          </div>
        </div>

        <div>
          <div class="text-xs text-gray-500 mb-1">SDP MLine Index</div>

          <div class="text-sm font-mono text-gray-300">
            {{ candidate?.sdpMLineIndex || 'N/A' }}
          </div>
        </div>
      </div>

      <!-- Username Fragment (if available) -->
      <div v-if="candidate.usernameFragment" class="pt-2 border-t border-gray-700">
        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-500">Username Fragment</div>

          <div class="text-sm font-mono text-purple-400">
            {{ candidate?.usernameFragment || 'N/A' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PhCopy } from '@phosphor-icons/vue'
import type { RTCIceCandidate } from '@/types'

interface Props {
  candidate: RTCIceCandidate
}

const props = defineProps<Props>()

const copyCandidate = async () => {
  if (!props.candidate) {
    console.warn('Candidate is null or undefined')
    return
  }
  
  try {
    const candidateJson = JSON.stringify(props.candidate, null, 2)
    await navigator.clipboard.writeText(candidateJson)
    console.log('ICE candidate copied to clipboard')
  } catch (error) {
    console.error('Failed to copy candidate:', error)
  }
}

const getCandidateTypeColor = (type?: string): string => {
  if (!type) return 'bg-gray-400'
  switch (type.toLowerCase()) {
    case 'host': return 'bg-green-400'
    case 'srflx': return 'bg-blue-400'
    case 'prflx': return 'bg-yellow-400'
    case 'relay': return 'bg-purple-400'
    default: return 'bg-gray-400'
  }
}
</script>