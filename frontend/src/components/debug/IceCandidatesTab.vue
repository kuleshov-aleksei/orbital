<template>
  <div class="p-6">
    <div class="space-y-6">
      <div
        v-for="[userId, iceCandidates] in iceCandidatesMap"
        :key="userId"
        class="space-y-4"
      >
        <!-- Peer Header -->
        <div class="flex items-center space-x-3">
          <div class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          <h3 class="text-base font-medium text-white">
            {{ getUserNickname(userId) }}
          </h3>
          <div class="text-xs text-gray-400">
            {{ iceCandidates.length }} candidate{{ iceCandidates.length !== 1 ? 's' : '' }}
          </div>
        </div>

        <!-- ICE Candidates Cards -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <IceCandidateCard
            v-for="(candidate, index) in iceCandidates"
            :key="index"
            :candidate="candidate"
            @copy="onCopyCandidate"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RTCIceCandidate } from '@/types'
import IceCandidateCard from './IceCandidateCard.vue'

interface Props {
  iceCandidatesMap: Map<string, RTCIceCandidate[]>
  getUserNickname: (userId: string) => string
}

defineProps<Props>()

const emit = defineEmits<{
  copyCandidate: [candidate: RTCIceCandidate]
}>()

const onCopyCandidate = (candidate: RTCIceCandidate) => {
  emit('copyCandidate', candidate)
}
</script>