<template>
  <div class="voice-call-view flex-1 flex flex-col" data-testid="voice-call-view">
    <!-- Audio Manager - Handles all audio playback centrally -->
    <AudioManager
      :audio-tracks="remoteAudioTracks"
      :volumes="props.remoteStreamVolumes"
      :is-deafened="isDeafened"
      :muted-users="mutedUsers" />

    <!-- Room Header -->
    <RoomHeader
      v-model:screen-share-layout="screenShareLayout"
      v-model:is-user-grid-visible="isUserGridVisible"
      :room-name="currentRoom?.name || 'Voice Room'"
      :user-count="users.length"
      :screen-share-count="screenShareData.length"
      :camera-count="cameraData.length"
      :is-mobile="isMobile"
      @leave-room="$emit('leave-room')"
      @show-room-list="$emit('show-room-list')"
      @toggle-user-sidebar="$emit('toggle-user-sidebar')" />

    <!-- Screen Share Quality Modal handled by parent -->

    <!-- Main Call Area -->
    <main class="relative flex flex-1 flex-col min-h-0 overflow-hidden">
      <!-- Content Container - allows scrolling if needed -->
      <div class="flex-1 min-h-0 overflow-auto">
        <!-- Use v-show instead of v-if to keep both components mounted and preserve audio elements -->
        <!-- Screen Share Area - Shows users in side panel when screen sharing or camera is active -->
        <ScreenShareArea
          v-show="screenShareData.length > 0 || cameraData.length > 0"
          :screen-shares="screenShareData"
          :camera-streams="cameraData"
          :layout="screenShareLayout"
          :users="users"
          :remote-stream-volumes="props.remoteStreamVolumes"
          :user-screen-share-states="userScreenShareStates"
          :user-camera-states="userCameraStates"
          :is-deafened="isDeafened"
          :current-user-audio-level="audioLevel"
          :current-user-id="currentUserId"
          :current-user-is-sharing="isScreenSharing"
          :current-user-camera-enabled="isCameraEnabled"
          :get-participant-stats="getParticipantStats"
          class="m-4 max-h-[70vh]"
          @update:layout="screenShareLayout = $event"
          @toggle-user-grid="isUserGridVisible = !isUserGridVisible"
          @mute-toggle="handleUserMuteToggle" />

        <!-- User Grid - Only shown when no screen shares or cameras (audio-only mode) -->
        <UserGrid
          v-show="screenShareData.length === 0 && cameraData.length === 0"
          :users="users"
          :remote-stream-volumes="props.remoteStreamVolumes"
          :user-screen-share-states="userScreenShareStates"
          :user-camera-states="userCameraStates"
          :is-deafened="isDeafened"
          :is-visible="screenShareData.length === 0 && cameraData.length === 0"
          :current-user-audio-level="audioLevel"
          :current-user-camera-enabled="isCameraEnabled"
          :get-participant-stats="getParticipantStats"
          @mute-toggle="handleUserMuteToggle" />
      </div>

      <!-- Audio Controls - Fixed at bottom center -->
      <div class="flex-shrink-0 flex justify-center px-4 py-3 bg-gray-900/80 backdrop-blur-sm border-t border-gray-700/50">
        <AudioControls
          ref="audioControlsRef"
          v-model:model-value-muted="isMuted"
          v-model:model-value-deafened="isDeafened"
          v-model:model-value-screen-sharing="isScreenSharing"
          v-model:model-value-camera-enabled="cameraEnabled"
          :is-speaking="isSpeaking"
          :is-mobile="isMobile"
          @start-screen-share="$emit('request-screen-share')"
          @toggle-camera="handleCameraToggle"
          @auth-required="$emit('show-room-list')"
          @leave-room="$emit('leave-room')" />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue"
import AudioControls from "@/components/AudioControls.vue"
import AudioManager from "@/components/AudioManager.vue"
import RoomHeader from "@/components/RoomHeader.vue"
import ScreenShareArea from "@/components/ScreenShareArea.vue"
import UserGrid from "@/components/UserGrid.vue"
import { useLiveKit, useVoiceActivity } from "@/composables"
import { useAudioSettingsStore, useCallStore, useUserStore } from "@/stores"
import type { User, ScreenShareQuality } from "@/types"

interface Props {
  roomId: string
  roomName: string
  users: User[]
  remoteStreamVolumes: Map<string, number>
  isMobile?: boolean
  modelValueMuted?: boolean
  modelValueDeafened?: boolean
  modelValueScreenSharing?: boolean
  modelValueCameraEnabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isMobile: false,
  modelValueMuted: false,
  modelValueDeafened: false,
  modelValueScreenSharing: false,
  modelValueCameraEnabled: false,
})

const emit = defineEmits<{
  "leave-room": []
  "show-room-list": []
  "toggle-user-sidebar": []
  "update:modelValueMuted": [value: boolean]
  "update:modelValueDeafened": [value: boolean]
  "update:modelValueScreenSharing": [value: boolean]
  "update:modelValueCameraEnabled": [value: boolean]
  "ping-update": [ping: number, quality: "excellent" | "good" | "fair" | "poor"]
  "request-screen-share": []
}>()

// UI State (layout and display preferences)
const isUserGridVisible = ref(true)
const screenShareLayout = ref<"grid" | "focus">("focus")
const audioControlsRef = useTemplateRef<InstanceType<typeof AudioControls>>("audioControlsRef")

// Audio settings store
const audioSettingsStore = useAudioSettingsStore()

// Stores
const callStore = useCallStore()

// Track muted users for AudioManager
const mutedUsers = ref<Set<string>>(new Set())

// Initialize LiveKit composable - destructure for template reactivity
const {
  localStream,
  remoteAudioTracks,
  isScreenSharing,
  isCameraEnabled,
  userScreenShareStates,
  userCameraStates,
  screenShareData,
  cameraData,
  handleMuteToggle,
  startScreenShare,
  startCamera,
  stopCamera,
  getParticipantStats,
  applyMuteState,
  applyDeafenState,
  reinitializeAudioStream,
  initializeLiveKit,
} = useLiveKit({
  roomId: props.roomId,
  roomName: props.roomName,
  users: props.users,
  remoteStreamVolumes: props.remoteStreamVolumes,
  onVolumeChange: (userId: string, volume: number) => {
    // Volume changes are handled by the component
    console.log(`Volume change for ${userId}: ${volume}`)
  },
  onPingUpdate: (ping: number, quality: "excellent" | "good" | "fair" | "poor") => {
    emit("ping-update", ping, quality)
  },
})

// Voice Activity Detection for local user
const { audioLevel, isSpeaking } = useVoiceActivity({
  stream: localStream,
  isMuted: computed(() => props.modelValueMuted),
})

// Computed properties for v-model support
const isMuted = computed({
  get: () => props.modelValueMuted,
  set: (value) => {
    emit("update:modelValueMuted", value)
    void applyMuteState(value)
  },
})

const isDeafened = computed({
  get: () => props.modelValueDeafened,
  set: (value) => {
    emit("update:modelValueDeafened", value)
    void applyDeafenState(value)
  },
})

const cameraEnabled = computed({
  get: () => props.modelValueCameraEnabled,
  set: (value) => {
    emit("update:modelValueCameraEnabled", value)
    // Note: Camera toggle is handled by @toggle-camera event handler (handleCameraToggle)
    // to avoid duplicate calls from both v-model and the event
  },
})

// Current room info
const currentRoom = computed(() => {
  return {
    name: props.roomName || "Voice Room",
    id: props.roomId,
  }
})

// Current user info
const userStore = useUserStore()
const currentUserId = computed(() => userStore.userId)

// Track reinitialization state
let isReinitializing = false

// Watch specifically for noise suppression algorithm changes
watch(
  () => audioSettingsStore.noiseSuppressionAlgorithm,
  async (newAlgorithm, oldAlgorithm) => {
    // Only reinitialize if algorithm actually changed and we're in a call
    if (props.roomId && newAlgorithm !== oldAlgorithm && !isReinitializing) {
      console.log(
        `Noise suppression algorithm changed from ${oldAlgorithm} to ${newAlgorithm}, reinitializing audio stream...`,
      )

      isReinitializing = true
      try {
        await reinitializeAudioStream()
      } finally {
        isReinitializing = false
      }
    }
  },
)

// Watch call store mute/deafen state and apply to LiveKit audio
// This ensures sidebar controls affect the actual audio
watch(
  () => callStore.isMuted,
  (newValue) => {
    console.log(`🎤 Call store mute state changed: ${newValue}`)
    void applyMuteState(newValue)
    // Sync with parent v-model if different
    if (props.modelValueMuted !== newValue) {
      emit("update:modelValueMuted", newValue)
    }
  },
)

watch(
  () => callStore.isDeafened,
  (newValue) => {
    console.log(`🎧 Call store deafen state changed: ${newValue}`)
    void applyDeafenState(newValue)
    // Sync with parent v-model if different
    if (props.modelValueDeafened !== newValue) {
      emit("update:modelValueDeafened", newValue)
    }
  },
)

watch(
  () => callStore.isCameraEnabled,
  (newValue) => {
    // Sync with parent v-model if different
    if (props.modelValueCameraEnabled !== newValue) {
      emit("update:modelValueCameraEnabled", newValue)
    }
  },
)

// Apply initial mute/deafen state from store when joining a room
watch(
  () => props.roomId,
  async (newRoomId) => {
    if (newRoomId) {
      console.log(
        `📞 Joined room ${newRoomId}, initializing LiveKit and applying mute/deafen state from store`,
      )

      // Initialize LiveKit connection
      // Note: cleanup() is called from onUnmounted when component unmounts,
      // which happens when switching rooms. We don't need to call it here
      // to avoid race conditions with the new connection.
      let connected = false
      try {
        connected = await initializeLiveKit()
        if (connected) {
          console.log(`✅ LiveKit connected to room ${newRoomId}`)
        } else {
          console.error(`❌ Failed to connect LiveKit to room ${newRoomId}`)
        }
      } catch (error) {
        console.error(`❌ Error initializing LiveKit:`, error)
      }

      // Apply deafen state (mute remote audio) - this doesn't affect local tracks
      void applyDeafenState(callStore.isDeafened)

      // Note: applyMuteState is not called here because initializeLiveKit already
      // handles the initial mute state during connection (see useLiveKit.ts:460-463).
      // Calling it again immediately can cause race conditions with track publishing.
      // Sync with parent v-model
      if (props.modelValueMuted !== callStore.isMuted) {
        emit("update:modelValueMuted", callStore.isMuted)
      }
      if (props.modelValueDeafened !== callStore.isDeafened) {
        emit("update:modelValueDeafened", callStore.isDeafened)
      }
    }
  },
  { immediate: true },
)

// Event handlers

// Handle user mute toggle from ParticipantCard - updates muted users set
const handleUserMuteToggle = (userId: string, isMuted: boolean): void => {
  if (isMuted) {
    mutedUsers.value.add(userId)
  } else {
    mutedUsers.value.delete(userId)
  }
  // Also call the original LiveKit mute handler
  handleMuteToggle(userId, isMuted)
}

// Start screen share wrapper - called by parent (AppLayout)
const startScreenShareWithQuality = async (quality: string, shareAudio: boolean) => {
  try {
    // Start the actual LiveKit screen share
    await startScreenShare(quality as ScreenShareQuality, shareAudio)
    // Tell AudioControls to update state and send WebSocket message
    const audioControls = audioControlsRef.value as unknown as {
      confirmStartScreenShare?: (quality: ScreenShareQuality, hasAudio: boolean) => Promise<void>
    } | null
    if (audioControls?.confirmStartScreenShare) {
      await audioControls.confirmStartScreenShare(quality as ScreenShareQuality, shareAudio)
    }
  } catch (error) {
    console.error("Failed to start screen share:", error)
  }
}

// Handle camera toggle from AudioControls
const handleCameraToggle = async (enabled: boolean) => {
  try {
    if (enabled && !isCameraEnabled.value) {
      await startCamera()
    } else if (!enabled && isCameraEnabled.value) {
      await stopCamera()
    }
  } catch (error) {
    console.error("Failed to toggle camera:", error)
  }
}

// Expose methods to parent component
defineExpose({ startScreenShare: startScreenShareWithQuality })
</script>
