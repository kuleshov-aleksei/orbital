<template>
  <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
    <h3 class="text-sm font-medium text-white mb-3">
      {{ getUserNickname(userId) }}
    </h3>
    
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
      <div>
        <div class="text-gray-500 mb-1">ICE State</div>
        <div class="text-white font-mono">
          {{ debugInfo.iceState }}
        </div>
      </div>
      <div>
        <div class="text-gray-500 mb-1">Connection State</div>
        <div class="text-white font-mono">
          {{ debugInfo.connectionState }}
        </div>
      </div>
      <div>
        <div class="text-gray-500 mb-1">Signaling State</div>
        <div class="text-white font-mono">
          {{ debugInfo.signalingState }}
        </div>
      </div>
      <div>
        <div class="text-gray-500 mb-1">Gathering State</div>
        <div class="text-white font-mono">
          {{ debugInfo.iceGatheringState }}
        </div>
      </div>
    </div>

    <!-- Candidates -->
    <div class="mt-4 space-y-2">
      <div class="text-xs text-gray-500">Local Candidates</div>
      <div class="bg-gray-900 rounded p-2 max-h-24 overflow-y-auto">
        <div
          v-for="(candidate, index) in debugInfo.localCandidates"
          :key="'local-' + index"
          class="text-xs font-mono text-gray-400 mb-1"
        >
          {{ formatCandidate(candidate) }}
        </div>
      </div>
      
      <div class="text-xs text-gray-500">Remote Candidates</div>
      <div class="bg-gray-900 rounded p-2 max-h-24 overflow-y-auto">
        <div
          v-for="(candidate, index) in debugInfo.remoteCandidates"
          :key="'remote-' + index"
          class="text-xs font-mono text-gray-400 mb-1"
        >
          {{ formatCandidate(candidate) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DebugInfo } from '@/types'

interface Props {
  userId: string
  debugInfo: DebugInfo
  getUserNickname: (userId: string) => string
}

defineProps<Props>()

const formatCandidate = (candidate: RTCIceCandidateInit): string => {
  if (!candidate.candidate) return 'Empty candidate'
  return candidate.candidate.split('\n')[0] || candidate.candidate
}
</script>