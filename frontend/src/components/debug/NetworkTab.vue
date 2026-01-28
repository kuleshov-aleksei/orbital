<template>
  <div class="p-6">
    <div class="space-y-4">
      <NetworkPathCard
        v-for="[userId, debugInfo] in networkInfo"
        :key="userId"
        :user-id="userId"
        :debug-info="debugInfo"
        :get-user-nickname="getUserNickname"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DebugInfo } from '@/types'
import NetworkPathCard from './NetworkPathCard.vue'

interface Props {
  networkInfo: Map<string, DebugInfo>
  getUserNickname: (userId: string) => string
}

defineProps<Props>()
</script>