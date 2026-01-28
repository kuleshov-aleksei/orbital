<template>
  <div class="p-6">
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <MetricsCard
        v-for="[userId, stats] in statsMap"
        :key="userId"
        :user-id="userId"
        :stats="stats"
        :connection-quality="getConnectionQuality(userId)"
        :get-user-nickname="getUserNickname"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ConnectionStats, ConnectionQuality } from '@/types'
import MetricsCard from './MetricsCard.vue'

interface Props {
  statsMap: Map<string, ConnectionStats>
  getConnectionQuality: (userId: string) => ConnectionQuality
  getUserNickname: (userId: string) => string
}

defineProps<Props>()
</script>