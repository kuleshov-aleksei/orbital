<template>
  <div class="screen-share-area bg-gray-800 rounded-lg overflow-hidden flex flex-col">
    <!-- Screen Share Content -->
    <div class="p-2 flex-1 min-h-0 flex flex-col">
      <!-- Focus Layout: Main screen (70%) + user panel (30%) side by side -->
      <div v-if="props.layout === 'focus'" class="flex flex-row h-full gap-4">
        <!-- Main focused screen - 70% width -->
        <div v-if="focusedShare" class="flex-[7] min-w-0 min-h-0">
          <ScreenStream
            :user-id="focusedShare.userId"
            :user-nickname="focusedShare.userNickname"
            :stream="focusedShare.stream"
            :quality="focusedShare.quality"
            :connection-state="focusedShare.connectionState"
            :is-focused="true"
            :show-focus-button="false"
            :is-self-view="focusedShare.isSelfView"
            class="h-full"
          />
        </div>
        
        <!-- User panel for participants - 30% width -->
        <div class="flex-[3] min-w-0 flex flex-col gap-3 overflow-y-auto">
          <ParticipantCard
            v-for="participant in allParticipants"
            :key="participant.userId"
            :user-id="participant.userId"
            :user-nickname="participant.userNickname"
            :audio-stream="participant.audioStream"
            :screen-share-stream="participant.screenShareStream"
            :connection-state="participant.connectionState"
            :connection-retry-count="participant.connectionRetryCount"
            :initial-volume="participant.initialVolume"
            :is-deafened="participant.isDeafened"
            :is-screen-sharing="participant.isScreenSharing"
            :screen-share-quality="participant.screenShareQuality"
            :peer-connection="participant.peerConnection"
            :is-current-user="participant.isCurrentUser"
            :external-audio-level="participant.externalAudioLevel"
            :force-audio-mode="(participant.userId !== focusedShare?.userId && participant.userId + '-self' !== focusedShare?.userId) && !participant.isScreenSharing"
            @card-click="handleParticipantClick(participant.userId)"
            @mute-toggle="$emit('mute-toggle', $event)"
            @audio-level="$emit('audio-level', $event)"
          />
        </div>
      </div>
      
      <!-- Grid Layout: All screens side by side -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
        <ScreenStream
          v-for="share in screenShares"
          :key="share.userId"
          :user-id="share.userId"
          :user-nickname="share.userNickname"
          :stream="share.stream"
          :quality="share.quality"
          :connection-state="share.connectionState"
          :is-focused="false"
          :show-focus-button="screenShares.length > 1"
          :is-self-view="share.isSelfView"
          class="h-full"
          @make-focused="setFocusedShare(share.userId)"
        />
      </div>
    </div>
    
    <!-- Empty State -->
    <div v-if="screenShares.length === 0" class="px-4 py-8 text-center flex-1 flex flex-col items-center justify-center">
      <PhMonitorPlay class="w-12 h-12 text-gray-600 mx-auto mb-2" />

      <p class="text-gray-400">No active screen shares</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  PhMonitorPlay
} from '@phosphor-icons/vue'
import ScreenStream from './ScreenStream.vue'
import ParticipantCard from './ParticipantCard.vue'
import type { ScreenShareQuality, User } from '@/types'

interface ScreenShare {
  userId: string
  userNickname: string
  stream: MediaStream | null
  quality: ScreenShareQuality
  connectionState?: string
  isSelfView?: boolean
}

interface ParticipantData {
  userId: string
  userNickname: string
  audioStream: MediaStream | null
  screenShareStream: MediaStream | null
  connectionState?: string
  connectionRetryCount?: number
  initialVolume?: number
  isDeafened?: boolean
  isScreenSharing?: boolean
  screenShareQuality?: ScreenShareQuality
  peerConnection?: RTCPeerConnection
  isCurrentUser?: boolean
  externalAudioLevel?: number
}

interface Props {
  screenShares: ScreenShare[]
  isUserGridVisible: boolean
  layout: 'grid' | 'focus'
  users: User[]
  remoteStreams: Map<string, MediaStream>
  peerConnectionStates: Map<string, string>
  peerConnectionRetries: Map<string, number>
  remoteStreamVolumes: Map<string, number>
  userScreenShareStates: Map<string, { isSharing: boolean; quality?: ScreenShareQuality }>
  peerConnections: Map<string, RTCPeerConnection>
  isDeafened: boolean
  currentUserAudioLevel?: number
  currentUserId: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'toggle-user-grid': []
  'update:layout': [layout: 'grid' | 'focus']
  'mute-toggle': [userId: string, isMuted: boolean]
  'audio-level': [userId: string, level: number, isSpeaking: boolean]
}>()

const localLayout = computed({
  get: () => props.layout,
  set: (value) => emit('update:layout', value)
})
const focusedUserId = ref<string | null>(null)

// Set initial focus to first screen share
watch(() => props.screenShares.length, (newLength, oldLength) => {
  if (newLength > 0 && (oldLength === 0 || !focusedUserId.value)) {
    // If first share added or no focus set, focus on first
    focusedUserId.value = props.screenShares[0].userId
  } else if (newLength === 0) {
    // If all shares removed, clear focus
    focusedUserId.value = null
  } else if (focusedUserId.value && !props.screenShares.find(s => s.userId === focusedUserId.value)) {
    // If focused user stopped sharing, focus on first available
    focusedUserId.value = props.screenShares[0]?.userId || null
  }
}, { immediate: true })

const focusedShare = computed(() => {
  if (!focusedUserId.value) return props.screenShares[0] || null
  return props.screenShares.find(s => s.userId === focusedUserId.value) || props.screenShares[0] || null
})

// Build participant data for all users
const allParticipants = computed((): ParticipantData[] => {
  return props.users.map(user => {
    // Look for screen share by user id - for current user also check for '-self' suffix (self-view)
    let screenShare = props.screenShares.find(s => s.userId === user.id)
    const isCurrentUser = user.id === props.currentUserId
    
    // For current user, also check for self-view (userId + '-self')
    if (isCurrentUser && !screenShare) {
      screenShare = props.screenShares.find(s => s.userId === user.id + '-self')
    }
    
    return {
      userId: user.id,
      userNickname: user.nickname || 'Unknown',
      audioStream: props.remoteStreams.get(user.id) || null,
      screenShareStream: screenShare?.stream || null,
      connectionState: props.peerConnectionStates.get(user.id),
      connectionRetryCount: props.peerConnectionRetries.get(user.id) || 0,
      initialVolume: props.remoteStreamVolumes.get(user.id) || 80,
      isDeafened: props.isDeafened,
      isScreenSharing: props.userScreenShareStates.get(user.id)?.isSharing || false,
      screenShareQuality: props.userScreenShareStates.get(user.id)?.quality,
      peerConnection: props.peerConnections.get(user.id),
      isCurrentUser,
      externalAudioLevel: isCurrentUser ? props.currentUserAudioLevel : undefined
    }
  })
})

const setFocusedShare = (userId: string) => {
  focusedUserId.value = userId
  // Switch to focus layout when user clicks on a participant
  if (props.layout === 'grid') {
    localLayout.value = 'focus'
  }
}

const handleParticipantClick = (userId: string) => {
  // If user has a screen share, focus on it
  // Check for both regular userId and self-view userId (userId + '-self')
  const screenShare = props.screenShares.find(s => s.userId === userId || s.userId === userId + '-self')
  if (screenShare) {
    setFocusedShare(screenShare.userId)
  }
}
</script>

<style scoped>
.screen-share-area {
  /* Uses flex layout to fit available space */
}
</style>
