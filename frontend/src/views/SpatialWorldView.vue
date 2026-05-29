<template>
  <div
    class="spatial-world-view flex flex-1 min-h-0 relative"
    :class="{ 'pointer-events-none': !isConnected }"
    data-testid="spatial-world-view">
    <div ref="worldContainer" class="absolute inset-0" />

    <div class="relative z-10 flex flex-col flex-1">
      <!-- Room Header -->
      <RoomHeader
        :room-name="currentRoom?.name || 'Spatial Room'"
        :screen-share-count="0"
        :screen-share-layout="'grid'"
        :is-mobile="isMobile"
        @leave-room="$emit('leave-room')"
        @show-room-list="$emit('show-room-list')"
        @toggle-user-sidebar="$emit('toggle-user-sidebar')" />

      <!-- Audio Controls -->
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
        <AudioControls
          v-model:model-value-muted="isMuted"
          v-model:model-value-deafened="isDeafened"
          :is-mobile="isMobile"
          @leave-room="$emit('leave-room')" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import { RoomEvent, ParticipantEvent } from "livekit-client"
import type { RemoteParticipant } from "livekit-client"
import AudioControls from "@/components/AudioControls.vue"
import RoomHeader from "@/components/RoomHeader.vue"
import { useLiveKit } from "@/composables"
import { useSpatialPosition } from "@/composables/useSpatialPosition"
import { useSpatialAudio } from "@/composables/useSpatialAudio"
import { useGameInput } from "@/composables/useGameInput"
import { useUserStore } from "@/stores"
import { createWorldRenderer } from "@/world/WorldRenderer"
import { createCharacterSprite } from "@/world/CharacterSprite"
import { registerDefaultCharacters, getAnimations } from "@/world/ResourceManager"
import {
  SPAWN_POSITION,
  PLAYER_SPEED,
  WORLD_BOUNDARIES,
  EARSHOT_RADIUS,
  TICK_RATE,
} from "@/world/WorldConfig"
import type { User } from "@/types"
import type { AnimationTextures } from "@/world/ResourceManager"
import type { AnimationState } from "@/world/CharacterSprite"

interface Props {
  roomId: string
  roomName: string
  users: User[]
  remoteStreamVolumes: Map<string, number>
  isMobile?: boolean
  modelValueMuted?: boolean
  modelValueDeafened?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isMobile: false,
  modelValueMuted: false,
  modelValueDeafened: false,
})

const userStore = useUserStore()

const emit = defineEmits<{
  "leave-room": []
  "show-room-list": []
  "toggle-user-sidebar": []
  "update:modelValueMuted": [value: boolean]
  "update:modelValueDeafened": [value: boolean]
}>()

const worldContainer = ref<HTMLElement | null>(null)

const currentRoom = computed(() => ({
  name: props.roomName || "Spatial Room",
}))

// Initialize LiveKit
const {
  room,
  localParticipant,
  remoteParticipants,
  remoteAudioTracks,
  isConnected,
  initializeLiveKit,
  cleanup: cleanupLiveKit,
  applyMuteState,
  applyDeafenState,
} = useLiveKit({
  roomId: props.roomId,
  roomName: props.roomName,
  users: props.users,
  remoteStreamVolumes: props.remoteStreamVolumes,
  onVolumeChange: () => {},
  onPingUpdate: () => {},
})

// Spatial position sharing
const spatialPosition = useSpatialPosition({ room, localParticipant })
const { localPosition, remotePositions, updateLocalPosition, startPositionSync, stopPositionSync } =
  spatialPosition

// Spatial audio
const spatialAudio = useSpatialAudio({
  remoteAudioTracks,
  localPosition,
  remotePositions,
})
const { initializeAudio, resumeAudio, updateAudioPositions } = spatialAudio

// Game input
const gameInput = useGameInput()
const { direction, startListening, stopListening } = gameInput

// World renderer
const worldRenderer = createWorldRenderer()

// Local character
let localCharacterAnimations: AnimationTextures | null = null
let localCharacterDisplay: ReturnType<typeof createCharacterSprite> | null = null
const remoteCharacterDisplays = new Map<string, ReturnType<typeof createCharacterSprite>>()
const cancelledCharacterCreations = new Set<string>()

// Game loop (requestAnimationFrame)
let animationFrameId: number | null = null
let lastFrameTime = 0

// Mute/deafen
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

// Determine animation from direction
function getAnimation(dir: { x: number; y: number }): AnimationState {
  const moving = dir.x !== 0 || dir.y !== 0
  if (moving) {
    return dir.x >= 0 ? "walk_right" : "walk_left"
  }
  return "idle_right"
}

// Setup world and characters
async function setupWorld() {
  if (!worldContainer.value) return

  await worldRenderer.init(worldContainer.value)

  // Create local character
  localCharacterAnimations = await getAnimations("targ")
  localCharacterDisplay = createCharacterSprite(
    userStore.nickname,
    localCharacterAnimations,
  )

  // Spawn at center — use updateLocalPosition to sync internal _myPosition
  updateLocalPosition({ ...SPAWN_POSITION })
  localCharacterDisplay.setPosition(SPAWN_POSITION.x, SPAWN_POSITION.y)
  worldRenderer.addCharacter("local", localCharacterDisplay)
}

async function addRemoteCharacter(id: string, nickname: string) {
  if (remoteCharacterDisplays.has(id)) return
  const anims = await getAnimations("vita")

  // Check for disconnect while loading
  if (cancelledCharacterCreations.has(id)) {
    cancelledCharacterCreations.delete(id)
    return
  }

  const display = createCharacterSprite(nickname, anims)

  // Start at spawn if no position data received yet
  const existingPos = remotePositions.value.get(id)
  display.setPosition(existingPos?.x ?? SPAWN_POSITION.x, existingPos?.y ?? SPAWN_POSITION.y)

  remoteCharacterDisplays.set(id, display)
  worldRenderer.addCharacter(id, display)
}

function removeRemoteCharacter(id: string) {
  const display = remoteCharacterDisplays.get(id)
  if (display) {
    worldRenderer.removeCharacter(id)
    remoteCharacterDisplays.delete(id)
  }
}

// Game tick with frame-rate-independent delta
function gameTick(delta: number) {
  if (!localCharacterDisplay) return

  // Normalize delta to 60fps frames for consistent speed
  const frameDelta = Math.min(delta / (1000 / 60), 3)

  // Process input with normalized direction (diagonal moves same speed as cardinal)
  const rawDir = direction.value
  const magnitude = Math.sqrt(rawDir.x * rawDir.x + rawDir.y * rawDir.y)
  const moving = magnitude > 0.01
  const dir = moving
    ? { x: rawDir.x / magnitude, y: rawDir.y / magnitude }
    : rawDir

  if (moving) {
    const pos = localPosition.value
    let newX = pos.x + dir.x * PLAYER_SPEED * frameDelta
    let newY = pos.y + dir.y * PLAYER_SPEED * frameDelta
    newX = Math.max(WORLD_BOUNDARIES.minX, Math.min(WORLD_BOUNDARIES.maxX, newX))
    newY = Math.max(WORLD_BOUNDARIES.minY, Math.min(WORLD_BOUNDARIES.maxY, newY))
    updateLocalPosition({ x: newX, y: newY })
  }

  // Update local character visuals
  localCharacterDisplay.setPosition(localPosition.value.x, localPosition.value.y)
  localCharacterDisplay.setAnimation(getAnimation(dir))

  // Update remote character visuals
  remotePositions.value.forEach((pos, id) => {
    const display = remoteCharacterDisplays.get(id)
    if (display) {
      display.setPosition(pos.x, pos.y)
    }
  })

  // Update camera
  worldRenderer.setCameraTarget(localPosition.value.x, localPosition.value.y)
  worldRenderer.updateCamera()

  // Update earshot radius visual
  worldRenderer.updateEarshotRadius(localPosition.value.x, localPosition.value.y, EARSHOT_RADIUS)

  // Update spatial audio positions
  updateAudioPositions(localPosition.value, remotePositions.value)
}

function handleParticipantConnected(participant: RemoteParticipant) {
  const identity = participant.identity
  const user = props.users.find((u) => u.id === identity)
  void addRemoteCharacter(identity, user?.nickname || identity).then(() => {
    // Listen for speaking changes on this participant
    participant.on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) => {
      remoteCharacterDisplays.get(identity)?.setSpeaking(speaking)
    })
    remoteCharacterDisplays.get(identity)?.setSpeaking(participant.isSpeaking)
  })
}

function handleParticipantDisconnected(participant: RemoteParticipant) {
  const identity = participant.identity
  cancelledCharacterCreations.add(identity)
  removeRemoteCharacter(identity)
}

onMounted(async () => {
  registerDefaultCharacters()

  // Initialize AudioContext early so connectTrack() succeeds when tracks arrive
  initializeAudio()

  // Resume AudioContext on user gesture (browser autoplay policy)
  const resumeAudioOnGesture = () => {
    void resumeAudio()
    document.removeEventListener("click", resumeAudioOnGesture)
    document.removeEventListener("touchstart", resumeAudioOnGesture)
  }
  document.addEventListener("click", resumeAudioOnGesture)
  document.addEventListener("touchstart", resumeAudioOnGesture)

  await initializeLiveKit()

  // Register room event listeners for future participants
  const lkRoom = room.value
  if (lkRoom) {
    lkRoom.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
    lkRoom.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
  }

  // Start position sync early — sends immediately and listens for incoming data
  startPositionSync()

  // Must init world BEFORE adding characters (cameraContainer is created in init)
  await setupWorld()

  // Listen for local speaking indicator
  const lp = localParticipant.value
  if (lp) {
    lp.on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) => {
      localCharacterDisplay?.setSpeaking(speaking)
    })
    localCharacterDisplay?.setSpeaking(lp.isSpeaking)
  }

  // Now add existing participants — renderer is ready
  for (const [, participant] of remoteParticipants.value) {
    handleParticipantConnected(participant)
  }

  startListening()

  // Start game loop with requestAnimationFrame
  lastFrameTime = performance.now()
  function frame(timestamp: number) {
    const delta = timestamp - lastFrameTime
    lastFrameTime = timestamp
    gameTick(delta)
    animationFrameId = requestAnimationFrame(frame)
  }
  animationFrameId = requestAnimationFrame(frame)
})

onUnmounted(async () => {
  // Cancel game loop
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }

  // Clean up room event listeners
  const lkRoom = room.value
  if (lkRoom) {
    lkRoom.off(RoomEvent.ParticipantConnected, handleParticipantConnected)
    lkRoom.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
  }

  // Clean up local speaking listener
  const lp = localParticipant.value
  if (lp) {
    lp.off(ParticipantEvent.IsSpeakingChanged)
  }

  stopListening()
  stopPositionSync()

  worldRenderer.destroy()
  await cleanupLiveKit()
})
</script>

<style scoped>
.spatial-world-view {
  background: #1a1a2e;
}
</style>
