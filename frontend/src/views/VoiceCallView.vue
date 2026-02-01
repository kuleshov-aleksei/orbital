<template>
  <div class="voice-call-view flex-1 flex flex-col" data-testid="voice-call-view">
    <!-- Room Header -->
    <RoomHeader
      v-model:screen-share-layout="screenShareLayout"
      v-model:is-user-grid-visible="isUserGridVisible"
      :room-name="currentRoom?.name || 'Voice Room'"
      :user-count="users.length"
      :screen-share-count="screenShareData.length"
      :is-mobile="isMobile"
      @leave-room="$emit('leave-room')"
      @show-room-list="$emit('show-room-list')"
      @toggle-user-sidebar="$emit('toggle-user-sidebar')"
    />

    <!-- Screen Share Quality Modal -->
    <ScreenShareQualityModal
      :is-open="showQualityModal"
      @select-quality="handleQualitySelected"
      @cancel="showQualityModal = false"
    />

    <!-- Main Call Area -->
    <main class="flex-1 flex flex-col min-h-0 overflow-hidden">
      <!-- Screen Share Area -->
      <ScreenShareArea
        v-if="screenShareData.length > 0"
        :screen-shares="screenShareData"
        :is-user-grid-visible="isUserGridVisible"
        :layout="screenShareLayout"
        class="flex-shrink-0 m-4"
        @update:layout="screenShareLayout = $event"
        @toggle-user-grid="isUserGridVisible = !isUserGridVisible"
      />

      <!-- User Grid -->
      <UserGrid
        :users="users"
        :remote-streams="remoteStreams"
        :peer-connection-states="peerConnectionStates"
        :remote-stream-volumes="props.remoteStreamVolumes"
        :user-screen-share-states="userScreenShareStates"
        :is-deafened="isDeafened"
        :is-visible="isUserGridVisible"
        :screen-share-count="screenShareData.length"
        @volume-change="handleVolumeChange"
        @mute-toggle="handleMuteToggle"
        @audio-level="handleAudioLevel"
      />

        <!-- Audio Controls -->
        <div class="bg-gray-800 border-t border-gray-700 px-6 py-4">
          <AudioControls
            :is-muted="isMuted"
            :is-deafened="isDeafened"
            :is-screen-sharing="isScreenSharing"
            @toggle-mute="toggleMute"
            @toggle-deafen="toggleDeafen"
            @toggle-screen-share="toggleScreenShare"
            @leave-room="$emit('leave-room')"
          />
        </div>
      </main>
      
      <!-- Debug Dashboard -->
      <DebugDashboard
        ref="debugDashboardRef"
        :users="props.users"
        :peer-connections="peerConnections"
        :get-connection-quality="getConnectionQuality"
        :local-screen-shares="localScreenShareDebugData"
        :remote-screen-shares="remoteScreenShareDebugData"
      />
  </div>
</template>

 <script setup lang="ts">
 import { computed, ref, useTemplateRef, watch } from 'vue'
 import AudioControls from '@/components/AudioControls.vue'
 import DebugDashboard from '@/components/DebugDashboard.vue'
 import RoomHeader from '@/components/RoomHeader.vue'
 import ScreenShareArea from '@/components/ScreenShareArea.vue'
 import ScreenShareQualityModal from '@/components/ScreenShareQualityModal.vue'
 import UserGrid from '@/components/UserGrid.vue'
 import { useWebRTC } from '@/composables'
 import { useAudioSettingsStore } from '@/stores/audioSettings'
 import type { User, ScreenShareQuality } from '@/types'

interface Props {
  roomId: string
  roomName: string
  users: User[]
  remoteStreamVolumes: Map<string, number>
  isMobile?: boolean
  modelValueMuted?: boolean
  modelValueDeafened?: boolean
  modelValueScreenSharing?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isMobile: false,
  modelValueMuted: false,
  modelValueDeafened: false,
  modelValueScreenSharing: false
})

const emit = defineEmits<{
  'leave-room': []
  'volume-change': [userId: string, volume: number]
  'show-room-list': []
  'toggle-user-sidebar': []
  'update:modelValueMuted': [value: boolean]
  'update:modelValueDeafened': [value: boolean]
  'update:modelValueScreenSharing': [value: boolean]
  'ping-update': [ping: number, quality: 'excellent' | 'good' | 'fair' | 'poor']
}>()

// UI State (layout and display preferences)
const showQualityModal = ref(false)
const isUserGridVisible = ref(true)
const screenShareLayout = ref<'grid' | 'focus'>('focus')
const debugDashboardRef = useTemplateRef<InstanceType<typeof DebugDashboard>>('debugDashboardRef')

// Debug logging callback
const onDebugLog = (message: string, level: 'info' | 'warning' | 'error' = 'info', userId?: string) => {
  if (debugDashboardRef.value && debugDashboardRef.value.addLog) {
    debugDashboardRef.value.addLog(message, level, userId)
  }
}

// Audio settings store
const audioSettingsStore = useAudioSettingsStore()

// Initialize WebRTC composable - destructure for template reactivity
const {
  remoteStreams,
  peerConnections,
  peerConnectionStates,
  isScreenSharing,
  userScreenShareStates,
  screenShareData,
  localScreenShareDebugData,
  remoteScreenShareDebugData,
  handleMuteToggle,
  handleAudioLevel,
  startScreenShare,
  stopScreenShare,
  getConnectionQuality,
  applyMuteState,
  applyDeafenState,
  reinitializeAudioStream
} = useWebRTC({
  roomId: props.roomId,
  roomName: props.roomName,
  users: props.users,
  remoteStreamVolumes: props.remoteStreamVolumes,
  onVolumeChange: (userId: string, volume: number) => {
    emit('volume-change', userId, volume)
  },
  onPingUpdate: (ping: number, quality: 'excellent' | 'good' | 'fair' | 'poor') => {
    emit('ping-update', ping, quality)
  },
  onDebugLog
})

// Computed properties for v-model support
const isMuted = computed({
  get: () => props.modelValueMuted,
  set: (value) => {
    emit('update:modelValueMuted', value)
    applyMuteState(value)
  }
})

const isDeafened = computed({
  get: () => props.modelValueDeafened,
  set: (value) => {
    emit('update:modelValueDeafened', value)
    applyDeafenState(value)
  }
})

// Current room info
const currentRoom = computed(() => {
  return {
    name: props.roomName || 'Voice Room',
    id: props.roomId
  }
})

// Watch for audio settings changes and reinitialize stream
watch(() => audioSettingsStore.settings, async (newSettings, oldSettings) => {
  // Only reinitialize if settings actually changed and we're in a call
  if (props.roomId && newSettings !== oldSettings) {
    console.log('Audio settings changed, reinitializing audio stream...')
    await reinitializeAudioStream()
  }
}, { deep: true })

// Event handlers
const handleVolumeChange = (userId: string, volume: number) => {
  console.log(`🔊 Volume changed for user ${userId}: ${volume}`)
  emit('volume-change', userId, volume)
}

const toggleMute = () => {
  isMuted.value = !isMuted.value
}

const toggleDeafen = () => {
  isDeafened.value = !isDeafened.value
  console.log('Deafen status:', isDeafened.value)
}

const toggleScreenShare = () => {
  console.log("toggleScreenShare called, isScreenSharing: " + isScreenSharing.value)
  if (isScreenSharing.value) {
    stopScreenShare()
    emit('update:modelValueScreenSharing', false)
  } else {
    showQualityModal.value = true
  }
}

const handleQualitySelected = async (quality: ScreenShareQuality, shareAudio: boolean) => {
  showQualityModal.value = false
  
  try {
    await startScreenShare(quality, shareAudio)
    emit('update:modelValueScreenSharing', true)
  } catch (error) {
    console.error('Failed to start screen share:', error)
    onDebugLog(`Failed to start screen share: ${(error as Error).message}`, 'error')
  }
}

// Expose methods for parent component access
defineExpose({
  toggleScreenShare
})
</script>
