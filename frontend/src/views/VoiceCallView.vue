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

    <!-- Screen Share Quality Modal handled by parent -->

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
        :peer-connection-retries="peerConnectionRetries"
        :remote-stream-volumes="props.remoteStreamVolumes"
        :user-screen-share-states="userScreenShareStates"
        :is-deafened="isDeafened"
        :is-visible="isUserGridVisible"
        :screen-share-count="screenShareData.length"
        :peer-connections="peerConnections"
        @mute-toggle="handleMuteToggle"
        @audio-level="handleAudioLevel"
      />

        <!-- Audio Controls -->
        <div class="bg-gray-800 border-t border-gray-700 px-6 py-4">
          <AudioControls
            ref="audioControlsRef"
            v-model:model-value-muted="isMuted"
            v-model:model-value-deafened="isDeafened"
            v-model:model-value-screen-sharing="isScreenSharing"
            @start-screen-share="$emit('request-screen-share')"
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
        :local-stream="localStream"
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
  import UserGrid from '@/components/UserGrid.vue'
 import { useWebRTC } from '@/composables'
import { useAudioSettingsStore, useCallStore } from '@/stores'
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
  'show-room-list': []
  'toggle-user-sidebar': []
  'update:modelValueMuted': [value: boolean]
  'update:modelValueDeafened': [value: boolean]
  'update:modelValueScreenSharing': [value: boolean]
  'ping-update': [ping: number, quality: 'excellent' | 'good' | 'fair' | 'poor']
  'request-screen-share': []
}>()

// UI State (layout and display preferences)
const isUserGridVisible = ref(true)
const screenShareLayout = ref<'grid' | 'focus'>('focus')
const debugDashboardRef = useTemplateRef<InstanceType<typeof DebugDashboard>>('debugDashboardRef')
const audioControlsRef = useTemplateRef<InstanceType<typeof AudioControls>>('audioControlsRef')

// Debug logging callback
const onDebugLog = (message: string, level: 'info' | 'warning' | 'error' = 'info', userId?: string) => {
  if (debugDashboardRef.value && debugDashboardRef.value.addLog) {
    debugDashboardRef.value.addLog(message, level, userId)
  }
}

// Audio settings store
const audioSettingsStore = useAudioSettingsStore()

// Stores
const callStore = useCallStore()

// Initialize WebRTC composable - destructure for template reactivity
const {
  localStream,
  remoteStreams,
  peerConnections,
  peerConnectionStates,
  peerConnectionRetries,
  isScreenSharing,
  userScreenShareStates,
  screenShareData,
  localScreenShareDebugData,
  remoteScreenShareDebugData,
  handleMuteToggle,
  handleAudioLevel,
  startScreenShare,
  getConnectionQuality,
  applyMuteState,
  applyDeafenState,
  reinitializeAudioStream
} = useWebRTC({
  roomId: props.roomId,
  roomName: props.roomName,
  users: props.users,
  remoteStreamVolumes: props.remoteStreamVolumes,
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

// Track reinitialization state
let isReinitializing = false

// Watch specifically for noise suppression algorithm changes
watch(() => audioSettingsStore.noiseSuppressionAlgorithm, async (newAlgorithm, oldAlgorithm) => {
  // Only reinitialize if algorithm actually changed and we're in a call
  if (props.roomId && newAlgorithm !== oldAlgorithm && !isReinitializing) {
    console.log(`Noise suppression algorithm changed from ${oldAlgorithm} to ${newAlgorithm}, reinitializing audio stream...`)
    
    isReinitializing = true
    try {
      await reinitializeAudioStream()
    } finally {
      isReinitializing = false
    }
  }
})

// Watch call store mute/deafen state and apply to WebRTC audio
// This ensures sidebar controls affect the actual audio
watch(() => callStore.isMuted, (newValue) => {
  console.log(`🎤 Call store mute state changed: ${newValue}`)
  applyMuteState(newValue)
  // Sync with parent v-model if different
  if (props.modelValueMuted !== newValue) {
    emit('update:modelValueMuted', newValue)
  }
})

watch(() => callStore.isDeafened, (newValue) => {
  console.log(`🎧 Call store deafen state changed: ${newValue}`)
  applyDeafenState(newValue)
  // Sync with parent v-model if different
  if (props.modelValueDeafened !== newValue) {
    emit('update:modelValueDeafened', newValue)
  }
})

// Apply initial mute/deafen state from store when joining a room
watch(() => props.roomId, (newRoomId) => {
  if (newRoomId) {
    console.log(`📞 Joined room ${newRoomId}, applying mute/deafen state from store`)
    // Apply current store state to audio
    applyMuteState(callStore.isMuted)
    applyDeafenState(callStore.isDeafened)
    // Sync with parent v-model
    if (props.modelValueMuted !== callStore.isMuted) {
      emit('update:modelValueMuted', callStore.isMuted)
    }
    if (props.modelValueDeafened !== callStore.isDeafened) {
      emit('update:modelValueDeafened', callStore.isDeafened)
    }
  }
}, { immediate: true })

// Event handlers


// Start screen share wrapper - called by parent (AppLayout)
const startScreenShareWithQuality = async (quality: string, shareAudio: boolean) => {
  try {
    // Start the actual WebRTC screen share
    await startScreenShare(quality as ScreenShareQuality, shareAudio)
    // Tell AudioControls to update state and send WebSocket message
    audioControlsRef.value?.confirmStartScreenShare(quality as ScreenShareQuality, shareAudio)
  } catch (error) {
    console.error('Failed to start screen share:', error)
    onDebugLog(`Failed to start screen share: ${(error as Error).message}`, 'error')
  }
}

// Expose methods to parent component
defineExpose({ startScreenShare: startScreenShareWithQuality })
</script>
