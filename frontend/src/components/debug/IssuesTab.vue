<template>
  <div class="p-6">
    <div class="space-y-4">
      <ConnectionIssuesCard
        v-for="[userId, issues] in connectionIssues"
        :key="userId"
        :user-id="userId"
        :issues="issues"
        :get-user-nickname="getUserNickname"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ConnectionQuality } from '@/types'
import ConnectionIssuesCard from './ConnectionIssuesCard.vue'

interface Props {
  connectionIssues: Map<string, { quality: ConnectionQuality['quality'], issues: string[], suggestions: string[] }>
  getUserNickname: (userId: string) => string
}

defineProps<Props>()
</script>