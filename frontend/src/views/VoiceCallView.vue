<template>
  <div
    class="voice-call-view flex-1 flex flex-col min-h-0 relative"
    :class="{ 'pointer-events-none': !isConnected }"
    data-testid="voice-call-view">
    <!-- Audio Manager - Handles all audio playback centrally -->
    <AudioManager
      :volumes="props.remoteStreamVolumes"
      :is-deafened="isDeafened"
      :muted-users="mutedUsers" />

    <!-- Room Header -->
    <RoomHeader
      v-model:screen-share-layout="screenShareLayout"
      :room-name="currentRoom?.name || 'Voice Room'"
      :screen-share-count="screenShareData.length"
      :camera-count="cameraData.length"
      :is-mobile="isMobile"
      @leave-room="$emit('leave-room')"
      @show-room-list="$emit('show-room-list')"
      @toggle-user-sidebar="$emit('toggle-user-sidebar')" />

    <!-- Screen Share Quality Modal handled by parent -->

    <!-- Main Call Area -->
    <div class="relative flex flex-1 flex-col min-h-0 overflow-hidden max-h-[80svh]">
      <!-- Use v-show instead of v-if to keep both components mounted and preserve audio elements -->
      <!-- Screen Share Area - Shows users in side panel when screen sharing or camera is active -->
      <ScreenShareArea
        v-show="
          screenShareData.length > 0 || cameraData.length > 0 || availableScreenShares.length > 0
        "
        :screen-shares="screenShareData"
        :available-screen-shares="availableScreenShares"
        :camera-streams="cameraData"
        :layout="screenShareLayout"
        :users="users"
        :remote-stream-volumes="props.remoteStreamVolumes"
        :user-screen-share-states="userScreenShareStates"
        :user-camera-states="userCameraStates"
        :is-deafened="isDeafened"
        :current-user-id="currentUserId"
        :current-user-is-sharing="isScreenSharing"
        :current-user-camera-enabled="isCameraEnabled"
        :get-participant-stats="getParticipantStats"
        class="m-4"
        @update:layout="screenShareLayout = $event"
        @subscribe-screen-share="subscribeToScreenShare"
        @unsubscribe-screen-share="unsubscribeFromScreenShare" />

      <!-- User Grid - Only shown when no screen shares or cameras (audio-only mode) -->
      <UserGrid
        v-show="
          screenShareData.length === 0 &&
          cameraData.length === 0 &&
          availableScreenShares.length === 0
        "
        :users="users"
        :remote-stream-volumes="props.remoteStreamVolumes"
        :user-screen-share-states="userScreenShareStates"
        :user-camera-states="userCameraStates"
        :is-deafened="isDeafened"
        :is-visible="
          screenShareData.length === 0 &&
          cameraData.length === 0 &&
          availableScreenShares.length === 0
        "
        :current-user-camera-enabled="isCameraEnabled"
        :get-participant-stats="getParticipantStats" />
    </div>

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
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, useTemplateRef, watch } from "vue"
import AudioControls from "@/components/AudioControls.vue"
import RoomHeader from "@/components/RoomHeader.vue"
import { useLiveKit, useVoiceActivity } from "@/composables"
import {
  useAudioSettingsStore,
  useCallStore,
  useUserStore,
  useAppStore,
  useRoomStore,
} from "@/stores"
import type { User, ScreenShareQuality } from "@/types"

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
const AudioManager = defineAsyncComponent(() => import("@/components/AudioManager.vue"))
const ScreenShareArea = defineAsyncComponent(() => import("@/components/ScreenShareArea.vue"))
const UserGrid = defineAsyncComponent(() => import("@/components/UserGrid.vue"))

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

// UI State (layout and display preferences)
const screenShareLayout = ref<"grid" | "focus">("focus")
const audioControlsRef = useTemplateRef<InstanceType<typeof AudioControls>>("audioControlsRef")

// Audio settings store
const audioSettingsStore = useAudioSettingsStore()

// Stores
const callStore = useCallStore()
const appStore = useAppStore()
const roomStore = useRoomStore()

// Track muted users for AudioManager
const mutedUsers = ref<Set<string>>(new Set())

// Initialize LiveKit composable - destructure for template reactivity
const {
  localStream,
  isConnected,
  isScreenSharing,
  isCameraEnabled,
  userScreenShareStates,
  userCameraStates,
  screenShareData,
  availableScreenShares,
  cameraData,
  handleMuteToggle,
  startScreenShare,
  startElectronScreenShare,
  stopScreenShare,
  startCamera,
  stopCamera,
  getParticipantStats,
  applyMuteState,
  applyDeafenState,
  reinitializeAudioStream,
  initializeLiveKit,
  subscribeToScreenShare,
  unsubscribeFromScreenShare,
  cleanup,
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

// Sync local audio level to store for reactivity
watch(
  audioLevel,
  (level) => {
    roomStore.setLocalAudioLevel(level)
  },
  { immediate: true },
)

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
    // Always emit to ensure parent v-model stays in sync
    emit("update:modelValueMuted", newValue)
  },
)

watch(
  () => callStore.isDeafened,
  (newValue) => {
    console.log(`🎧 Call store deafen state changed: ${newValue}`)
    void applyDeafenState(newValue)
    // Always emit to ensure parent v-model stays in sync
    emit("update:modelValueDeafened", newValue)
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
  async (newRoomId, oldRoomId) => {
    // Only react to actual room changes (not null/undefined)
    if (!newRoomId) return

    // If switching rooms (not initial join), cleanup old LiveKit connection first
    // This handles the case where user clicks a different room card directly
    if (oldRoomId && oldRoomId !== newRoomId && isConnected.value) {
      await cleanup()
    }

    // Initialize LiveKit connection
    appStore.setConnecting(true)
    try {
      await initializeLiveKit()
    } catch (error) {
      console.error("Error initializing LiveKit:", error)
    } finally {
      appStore.setConnecting(false)
    }

    // Apply deafen state (mute remote audio) - this doesn't affect local tracks
    void applyDeafenState(callStore.isDeafened)

    // Note: applyMuteState is not called here because initializeLiveKit already
    // handles the initial mute state during connection
    // Sync with parent v-model
    if (props.modelValueMuted !== callStore.isMuted) {
      emit("update:modelValueMuted", callStore.isMuted)
    }
    if (props.modelValueDeafened !== callStore.isDeafened) {
      emit("update:modelValueDeafened", callStore.isDeafened)
    }
  },
  { immediate: true },
)

// Watch for screen sharing state changes from UI and call stopScreenShare when needed
watch(
  () => isScreenSharing.value,
  async (newValue, oldValue) => {
    // If changing from true to false, we need to stop the screen share
    if (oldValue === true && newValue === false) {
      try {
        await stopScreenShare()
      } catch (error) {
        console.error("[VoiceCallView] Error stopping screen share:", error)
      }
    }
  },
)

// Event handlers

// Watch for mute state changes from context menu (via roomStore)
watch(
  () => roomStore.localMutedUsers,
  (newMutedUsers) => {
    mutedUsers.value = new Set(newMutedUsers)
  },
  { deep: true },
)

// Also watch for specific user mute changes and apply to LiveKit
watch(
  () => Array.from(roomStore.localMutedUsers),
  (currentMuted, previous) => {
    const prevSet = new Set(previous || [])
    const currSet = new Set(currentMuted || [])

    // Find newly muted users
    currSet.forEach((userId) => {
      if (!prevSet.has(userId)) {
        handleMuteToggle(userId, true)
      }
    })

    // Find newly unmuted users
    prevSet.forEach((userId) => {
      if (!currSet.has(userId)) {
        handleMuteToggle(userId, false)
      }
    })
  },
)

// Start screen share wrapper - called by parent (AppLayout)
const startScreenShareWithQuality = async (quality: string) => {
  try {
    // Start the actual LiveKit screen share
    await startScreenShare(quality as ScreenShareQuality)
    // Tell AudioControls to update state and send WebSocket message
    const audioControls = audioControlsRef.value as unknown as {
      confirmStartScreenShare?: (quality: ScreenShareQuality) => Promise<void>
    } | null
    if (audioControls?.confirmStartScreenShare) {
      await audioControls.confirmStartScreenShare(quality as ScreenShareQuality)
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
const startElectronScreenShareWithQuality = async (
  quality: string,
  audio: boolean,
  sourceId: string,
) => {
  try {
    await startElectronScreenShare(quality as ScreenShareQuality, audio, sourceId)
  } catch (error) {
    console.error("Failed to start Electron screen share:", error)
  }
}

defineExpose({
  startScreenShare: startScreenShareWithQuality,
  startElectronScreenShare: startElectronScreenShareWithQuality,
})
</script>
