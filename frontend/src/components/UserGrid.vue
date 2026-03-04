<template>
  <div v-show="isVisible" class="flex-1 p-4 lg:p-6 overflow-y-auto">
    <div
      v-if="users.length > 0"
      class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-6xl mx-auto">
      <div v-for="user in users" :key="user.id" class="relative">
        <ParticipantCard
          :user-id="user.id"
          :user-nickname="user.nickname || 'Unknown'"
          :screen-share-stream="null"
          :initial-volume="remoteStreamVolumes.get(user.id) || 80"
          :is-deafened="isDeafened"
          :is-screen-sharing="userScreenShareStates.get(user.id)?.isSharing || false"
          :screen-share-quality="userScreenShareStates.get(user.id)?.quality"
          :is-current-user="user.id === currentUserId"
          :stats="getParticipantStats?.(user.id)"
          :force-audio-mode="true" />
      </div>
    </div>

    <!-- Empty State -->
    <EmptyState v-else />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import ParticipantCard from "@/components/ParticipantCard.vue"
import EmptyState from "@/components/EmptyState.vue"
import { useUserStore } from "@/stores"
import type { User } from "@/types"
import type { ScreenShareQuality } from "@/types"

interface Props {
  users: User[]
  remoteStreamVolumes: Map<string, number>
  userScreenShareStates: Map<string, { isSharing: boolean; quality?: ScreenShareQuality }>
  isDeafened: boolean
  isVisible: boolean
  getParticipantStats?: (userId: string) => {
    ping: number
    jitter: number
    packetLoss: number
    bitrate: number
  }
}

defineProps<Props>()

const userStore = useUserStore()
const currentUserId = computed(() => userStore.userId)
</script>
