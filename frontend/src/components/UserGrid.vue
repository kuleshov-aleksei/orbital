<template>
  <div
    v-show="isVisible || screenShareCount === 0"
    class="flex-1 p-4 lg:p-6 overflow-y-auto"
  >
    <div v-if="users.length > 0" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-6xl mx-auto">
      <div
        v-for="user in users"
        :key="user.id"
        class="relative"
      >
        <AudioStream
          :user-id="user.id"
          :user-nickname="user.nickname || 'Unknown'"
          :stream="remoteStreams.get(user.id)"
          :connection-state="peerConnectionStates.get(user.id)"
          :initial-volume="remoteStreamVolumes.get(user.id) || 80"
          :is-deafened="isDeafened"
          :is-screen-sharing="userScreenShareStates.get(user.id)?.isSharing || false"
          :screen-share-quality="userScreenShareStates.get(user.id)?.quality"
          @volume-change="(userId, volume) => $emit('volume-change', userId, volume)"
          @mute-toggle="(userId, isMuted) => $emit('mute-toggle', userId, isMuted)"
          @audio-level="(userId, level, isSpeaking) => $emit('audio-level', userId, level, isSpeaking)"
        />
      </div>
    </div>

    <!-- Empty State -->
    <EmptyState v-else />
  </div>
</template>

<script setup lang="ts">
import AudioStream from '@/components/AudioStream.vue'
import EmptyState from '@/components/EmptyState.vue'
import type { User, ScreenShareState } from '@/types'

interface Props {
  users: User[]
  remoteStreams: Map<string, MediaStream>
  peerConnectionStates: Map<string, string>
  remoteStreamVolumes: Map<string, number>
  userScreenShareStates: Map<string, ScreenShareState>
  isDeafened: boolean
  isVisible: boolean
  screenShareCount: number
}

defineProps<Props>()

defineEmits<{
  'volume-change': [userId: string, volume: number]
  'mute-toggle': [userId: string, isMuted: boolean]
  'audio-level': [userId: string, level: number, isSpeaking: boolean]
}>()
</script>
