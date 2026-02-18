<template>
  <div class="screen-share-area bg-gray-800 rounded-lg overflow-hidden flex flex-col">
    <!-- Screen Share Content -->
    <div class="p-2 flex-1 min-h-0 flex flex-col">
      <!-- Focus Layout: Main stream (70%) + user panel (30%) side by side -->
      <div v-if="props.layout === 'focus'" class="flex flex-row h-full gap-4">
        <!-- Main focused stream - 70% width (screen share or camera) -->
        <div class="flex-[7] min-w-0 min-h-0">
          <!-- Screen Share in main area -->
          <ScreenStream
            v-if="focusedStream?.type === 'screen'"
            :key="focusedStream.userId"
            :user-id="focusedStream.userId"
            :user-nickname="focusedStream.userNickname"
            :video-track="focusedStream.videoTrack"
            :audio-track="focusedStream.audioTrack"
            :quality="focusedStream.quality"
            :connection-state="focusedStream.connectionState"
            :is-focused="true"
            :show-focus-button="false"
            :is-self-view="focusedStream.isSelfView"
            class="h-full" />
          <!-- Camera in main area -->
          <CameraStream
            v-else-if="focusedStream?.type === 'camera'"
            :key="focusedStream.userId"
            :user-id="focusedStream.userId"
            :user-nickname="focusedStream.userNickname"
            :video-track="focusedStream.videoTrack"
            :connection-state="focusedStream.connectionState"
            :is-focused="true"
            :is-self-view="focusedStream.isSelfView"
            class="h-full" />
        </div>

        <!-- User panel for participants - 30% width -->
        <div class="flex-[3] min-w-0 flex flex-col gap-3 overflow-y-auto">
          <ParticipantCard
            v-for="participant in allParticipants"
            :key="participant.userId"
            v-model:model-value-show-camera-as-main="
              participantShowCameraAsMain[participant.userId]
            "
            :user-id="participant.userId"
            :user-nickname="participant.userNickname"
            :screen-share-stream="participant.screenShareStream"
            :camera-stream="participant.cameraStream"
            :initial-volume="participant.initialVolume"
            :is-deafened="participant.isDeafened"
            :is-screen-sharing="participant.isScreenSharing"
            :is-camera-enabled="participant.isCameraEnabled"
            :screen-share-quality="participant.screenShareQuality"
            :is-current-user="participant.isCurrentUser"
            :external-audio-level="participant.externalAudioLevel"
            :stats="participant.stats"
            :is-viewing="isParticipantViewingMainStream(participant.userId)"
            :force-audio-mode="
              !isParticipantViewingMainStream(participant.userId) &&
              !participant.isScreenSharing &&
              !participant.isCameraEnabled
            "
            :is-compact="true"
            @card-click="handleParticipantCardClick(participant.userId)"
            @mute-toggle="$emit('mute-toggle', $event)" />
        </div>
      </div>

      <!-- Grid Layout: All screens and cameras side by side -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
        <!-- Combine screen shares and cameras, sort by user ID to keep same user's streams together -->
        <template v-for="item in sortedVideoStreams" :key="item.userId">
          <!-- Screen Share -->
          <ScreenStream
            v-if="item.type === 'screen'"
            :user-id="item.userId"
            :user-nickname="item.userNickname"
            :video-track="item.videoTrack"
            :audio-track="item.audioTrack"
            :quality="item.quality"
            :connection-state="item.connectionState"
            :is-focused="false"
            :show-focus-button="sortedVideoStreams.length > 1"
            :is-self-view="item.isSelfView"
            class="h-full"
            @make-focused="setFocusedShare(item.userId)" />
          <!-- Camera -->
          <CameraStream
            v-else
            :user-id="item.userId"
            :user-nickname="item.userNickname"
            :video-track="item.videoTrack"
            :connection-state="item.connectionState"
            :is-focused="false"
            :is-self-view="item.isSelfView"
            :is-compact="true"
            class="h-full"
            @dblclick="setFocusedShare(item.userId)" />
        </template>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-if="screenShares.length === 0"
      class="px-4 py-8 text-center flex-1 flex flex-col items-center justify-center">
      <PhMonitorPlay class="w-12 h-12 text-gray-600 mx-auto mb-2" />

      <p class="text-gray-400">No active screen shares</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue"
import { PhMonitorPlay } from "@phosphor-icons/vue"
import ScreenStream from "./ScreenStream.vue"
import CameraStream from "./CameraStream.vue"
import ParticipantCard from "./ParticipantCard.vue"
import type { ScreenShareQuality, User } from "@/types"
import type {
  RemoteVideoTrack,
  RemoteAudioTrack,
  LocalVideoTrack,
  LocalAudioTrack,
} from "livekit-client"

const props = defineProps<Props>()

const emit = defineEmits<{
  "toggle-user-grid": []
  "update:layout": [layout: "grid" | "focus"]
  "mute-toggle": [userId: string, isMuted: boolean]
}>()

// Cache for MediaStream objects to prevent recreation on every render
const streamCache = ref<Map<string, MediaStream>>(new Map())

interface ScreenShare {
  userId: string
  userNickname: string
  videoTrack: RemoteVideoTrack | LocalVideoTrack | null
  audioTrack: RemoteAudioTrack | LocalAudioTrack | null
  quality: ScreenShareQuality
  connectionState?: string
  isSelfView?: boolean
}

interface ParticipantData {
  userId: string
  userNickname: string
  screenShareStream: MediaStream | null
  cameraStream: MediaStream | null
  initialVolume?: number
  isDeafened?: boolean
  isScreenSharing?: boolean
  isCameraEnabled?: boolean
  screenShareQuality?: ScreenShareQuality
  isCurrentUser?: boolean
  externalAudioLevel?: number
  stats?: {
    ping: number
    jitter: number
    packetLoss: number
    bitrate: number
    kind: string
  }
}

interface CameraStream {
  userId: string
  userNickname: string
  videoTrack: RemoteVideoTrack | LocalVideoTrack | null
  connectionState?: string
  isSelfView?: boolean
}

type VideoStreamItem =
  | (ScreenShare & { type: "screen"; sortKey: string })
  | (CameraStream & { type: "camera"; sortKey: string })

interface Props {
  screenShares: ScreenShare[]
  cameraStreams: CameraStream[]
  layout: "grid" | "focus"
  users: User[]
  remoteStreamVolumes: Map<string, number>
  userScreenShareStates: Map<string, { isSharing: boolean; quality?: ScreenShareQuality }>
  userCameraStates: Map<string, boolean>
  isDeafened: boolean
  currentUserAudioLevel?: number
  currentUserId: string
  currentUserIsSharing?: boolean
  currentUserCameraEnabled?: boolean
  getParticipantStats?: (userId: string) => {
    ping: number
    jitter: number
    packetLoss: number
    bitrate: number
  }
}

const localLayout = computed({
  get: () => props.layout,
  set: (value) => emit("update:layout", value),
})
const focusedUserId = ref<string | null>(null)

// Track which stream type to show for each user (true = camera as main, false = screen as main)
const userShowCameraAsMain = ref<Map<string, boolean>>(new Map())

// Normalize userId by removing -self suffix for consistent lookup
const normalizeUserId = (userId: string): string => {
  return userId.replace(/-self$/, "")
}

// Get the showCameraAsMain state for a user
const getUserShowCameraAsMain = (userId: string): boolean => {
  const normalizedId = normalizeUserId(userId)
  return userShowCameraAsMain.value.get(normalizedId) ?? false
}

// Toggle the stream view for a user
const toggleUserStreamView = (userId: string) => {
  const normalizedId = normalizeUserId(userId)
  const currentValue = getUserShowCameraAsMain(normalizedId)
  const newValue = !currentValue
  userShowCameraAsMain.value.set(normalizedId, newValue)
}

// Set initial focus to first available stream (screen share preferred, then camera)
watch(
  [() => props.screenShares.length, () => props.cameraStreams.length],
  ([newScreenLength, newCameraLength]) => {
    const hasScreens = newScreenLength > 0
    const hasCameras = newCameraLength > 0

    if (!focusedUserId.value) {
      // No focus set yet - pick first available
      if (hasScreens) {
        focusedUserId.value = props.screenShares[0].userId
      } else if (hasCameras) {
        focusedUserId.value = props.cameraStreams[0].userId
      }
    } else if (newScreenLength === 0 && newCameraLength === 0) {
      // All streams removed, clear focus
      focusedUserId.value = null
    } else if (focusedUserId.value) {
      // Check if focused stream still exists
      const screenExists = props.screenShares.find((s) => s.userId === focusedUserId.value)
      const cameraExists = props.cameraStreams.find((c) => c.userId === focusedUserId.value)

      if (!screenExists && !cameraExists) {
        // Focused stream stopped - pick next available
        if (hasScreens) {
          focusedUserId.value = props.screenShares[0]?.userId || null
        } else if (hasCameras) {
          focusedUserId.value = props.cameraStreams[0]?.userId || null
        } else {
          focusedUserId.value = null
        }
      }
    }
  },
  { immediate: true },
)

// Get the currently focused stream (either screen share or camera)
const focusedStream = computed((): VideoStreamItem | null => {
  if (!focusedUserId.value) {
    // No focus set - return first available (screen share preferred)
    if (props.screenShares.length > 0) {
      const share = props.screenShares[0]
      return { ...share, type: "screen" as const, sortKey: `${share.userId}-0` }
    }
    if (props.cameraStreams.length > 0) {
      const camera = props.cameraStreams[0]
      return { ...camera, type: "camera" as const, sortKey: `${camera.userId}-1` }
    }
    return null
  }

  // Check if focused user has both screen share and camera
  const screenShare = props.screenShares.find((s) => s.userId === focusedUserId.value)
  const camera = props.cameraStreams.find((c) => c.userId === focusedUserId.value)

  if (screenShare && camera) {
    // User has both - check which one should be shown as main
    const showCamera = getUserShowCameraAsMain(focusedUserId.value)
    if (showCamera) {
      return { ...camera, type: "camera" as const, sortKey: `${camera.userId}-1` }
    } else {
      return { ...screenShare, type: "screen" as const, sortKey: `${screenShare.userId}-0` }
    }
  } else if (screenShare) {
    return { ...screenShare, type: "screen" as const, sortKey: `${screenShare.userId}-0` }
  } else if (camera) {
    return { ...camera, type: "camera" as const, sortKey: `${camera.userId}-1` }
  }

  // Focused stream not found - return first available
  if (props.screenShares.length > 0) {
    const share = props.screenShares[0]
    return { ...share, type: "screen" as const, sortKey: `${share.userId}-0` }
  }
  if (props.cameraStreams.length > 0) {
    const cam = props.cameraStreams[0]
    return { ...cam, type: "camera" as const, sortKey: `${cam.userId}-1` }
  }

  return null
})

// Check if a participant's stream is currently being viewed in the main area
const isParticipantViewingMainStream = (userId: string): boolean => {
  if (!focusedStream.value) return false
  return userId === focusedStream.value.userId || userId + "-self" === focusedStream.value.userId
}

// Combine screen shares and cameras, sorted by user ID to keep same user's streams together
// Screen shares come before cameras for the same user
const sortedVideoStreams = computed((): VideoStreamItem[] => {
  const screenItems: VideoStreamItem[] = props.screenShares.map((share) => ({
    ...share,
    type: "screen" as const,
    sortKey: `${share.userId.replace("-self", "")}-0`,
  }))

  const cameraItems: VideoStreamItem[] = props.cameraStreams.map((camera) => ({
    ...camera,
    type: "camera" as const,
    sortKey: `${camera.userId.replace("-self", "")}-1`,
  }))

  return [...screenItems, ...cameraItems].sort((a, b) => a.sortKey.localeCompare(b.sortKey))
})

// Get track SID for cache key
const getTrackKey = (userId: string, videoTrack: { sid?: string } | null): string => {
  return `${userId}:${videoTrack?.sid || "none"}`
}

// Build participant data for all users
const allParticipants = computed((): ParticipantData[] => {
  const currentCacheKeys = new Set<string>()

  const result = props.users.map((user) => {
    // Look for screen share by user id - for current user also check for '-self' suffix (self-view)
    let screenShare = props.screenShares.find((s) => s.userId === user.id)
    let camera = props.cameraStreams.find((c) => c.userId === user.id)
    const isCurrentUser = user.id === props.currentUserId

    // For current user, also check for self-view (userId + '-self')
    if (isCurrentUser && !screenShare) {
      screenShare = props.screenShares.find((s) => s.userId === user.id + "-self")
    }
    if (isCurrentUser && !camera) {
      camera = props.cameraStreams.find((c) => c.userId === user.id + "-self")
    }

    // For current user, use props; for others, use state maps
    const isScreenSharing = isCurrentUser
      ? props.currentUserIsSharing || false
      : props.userScreenShareStates.get(user.id)?.isSharing || false
    const isCameraEnabled = isCurrentUser
      ? props.currentUserCameraEnabled || false
      : props.userCameraStates.get(user.id) || false

    // Create or retrieve cached MediaStream from tracks for sidebar preview (ParticipantCard)
    let screenShareStream: MediaStream | null = null
    if (screenShare?.videoTrack) {
      const cacheKey = getTrackKey(user.id, screenShare.videoTrack)
      currentCacheKeys.add(cacheKey)

      const cachedStream = streamCache.value.get(cacheKey)
      if (cachedStream) {
        // Use cached stream
        screenShareStream = cachedStream
      } else {
        // Create new MediaStream and cache it
        const tracks: MediaStreamTrack[] = [screenShare.videoTrack.mediaStreamTrack]
        if (screenShare.audioTrack) {
          tracks.push(screenShare.audioTrack.mediaStreamTrack)
        }
        screenShareStream = new MediaStream(tracks)
        streamCache.value.set(cacheKey, screenShareStream)
      }
    }

    // Create camera stream
    let cameraStream: MediaStream | null = null
    if (camera?.videoTrack) {
      const cacheKey = getTrackKey(user.id + "-camera", camera.videoTrack)
      currentCacheKeys.add(cacheKey)

      const cachedStream = streamCache.value.get(cacheKey)
      if (cachedStream) {
        cameraStream = cachedStream
      } else {
        cameraStream = new MediaStream([camera.videoTrack.mediaStreamTrack])
        streamCache.value.set(cacheKey, cameraStream)
      }
    }

    return {
      userId: user.id,
      userNickname: user.nickname || "Unknown",
      screenShareStream,
      cameraStream,
      initialVolume: props.remoteStreamVolumes.get(user.id) || 80,
      isDeafened: props.isDeafened,
      isScreenSharing,
      isCameraEnabled,
      screenShareQuality: props.userScreenShareStates.get(user.id)?.quality,
      isCurrentUser,
      externalAudioLevel: isCurrentUser ? props.currentUserAudioLevel : undefined,
      stats: props.getParticipantStats?.(user.id),
    }
  })

  // Clean up cached streams that are no longer needed
  for (const [key] of streamCache.value) {
    if (!currentCacheKeys.has(key)) {
      streamCache.value.delete(key)
    }
  }

  return result
})

// Computed object for v-model binding with ParticipantCards
const participantShowCameraAsMain = computed({
  get: () => {
    const obj: Record<string, boolean> = {}
    allParticipants.value.forEach((p) => {
      const normalizedId = normalizeUserId(p.userId)
      obj[p.userId] = getUserShowCameraAsMain(normalizedId)
    })
    return obj
  },
  set: (value: Record<string, boolean>) => {
    Object.entries(value).forEach(([userId, showCamera]) => {
      const normalizedId = normalizeUserId(userId)
      userShowCameraAsMain.value.set(normalizedId, showCamera)
    })
  },
})

// Handle ParticipantCard click - toggle focused user if already focused, otherwise set focus
const handleParticipantCardClick = (userId: string) => {
  // If this participant is already focused and has both streams, toggle the view
  if (focusedUserId.value === userId || focusedUserId.value === userId + "-self") {
    const participant = allParticipants.value.find((p) => p.userId === userId)
    if (participant?.isScreenSharing && participant?.isCameraEnabled) {
      toggleUserStreamView(userId)
      return
    }
  }
  // Otherwise just set focus to this user
  setFocusedShare(userId)
}

const setFocusedShare = (userId: string) => {
  focusedUserId.value = userId
  // Switch to focus layout when user clicks on a participant
  if (props.layout === "grid") {
    localLayout.value = "focus"
  }
}

// Cleanup on unmount
onUnmounted(() => {
  streamCache.value.clear()
})
</script>

<style scoped>
.screen-share-area {
  /* Uses flex layout to fit available space */
}
</style>
