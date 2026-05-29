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
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import AudioControls from "@/components/AudioControls.vue"
import RoomHeader from "@/components/RoomHeader.vue"
import { useLiveKit } from "@/composables"
import { useSpatialPosition } from "@/composables/useSpatialPosition"
import { useSpatialAudio } from "@/composables/useSpatialAudio"
import { useGameInput } from "@/composables/useGameInput"
import { createWorldRenderer } from "@/world/WorldRenderer"
import { createCharacterSprite } from "@/world/CharacterSprite"
import { registerDefaultCharacters, getAnimations } from "@/world/ResourceManager"
import {
  SPAWN_POSITION,
  PLAYER_SPEED,
  WORLD_BOUNDARIES,
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
const { initializeAudio, updateAudioPositions } = spatialAudio

// Game input
const gameInput = useGameInput()
const { direction, startListening, stopListening } = gameInput

// World renderer
const worldRenderer = createWorldRenderer()

// Local character
let localCharacterAnimations: AnimationTextures | null = null
let localCharacterDisplay: ReturnType<typeof createCharacterSprite> | null = null
const remoteCharacterDisplays = new Map<string, ReturnType<typeof createCharacterSprite>>()

// Tick loop
let tickInterval: ReturnType<typeof setInterval> | null = null

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
  registerDefaultCharacters()

  await worldRenderer.init(worldContainer.value)

  // Create local character
  localCharacterAnimations = await getAnimations("targ")
  localCharacterDisplay = createCharacterSprite(
    props.users[0]?.nickname || "You",
    localCharacterAnimations,
  )

  // Spawn at center
  localPosition.value = { ...SPAWN_POSITION }
  localCharacterDisplay.setPosition(SPAWN_POSITION.x, SPAWN_POSITION.y)
  worldRenderer.addCharacter("local", localCharacterDisplay)

  // Setup existing remote participants
  remoteParticipants.value.forEach((participant) => {
    const user = props.users.find((u) => u.id === participant.identity)
    void addRemoteCharacter(participant.identity, user?.nickname || "Unknown")
  })
}

async function addRemoteCharacter(id: string, nickname: string) {
  if (remoteCharacterDisplays.has(id)) return
  const anims = await getAnimations("vita")
  const display = createCharacterSprite(nickname, anims)
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

// Game tick
function gameTick() {
  if (!localCharacterDisplay) return

  // Process input
  const dir = direction.value
  const moving = dir.x !== 0 || dir.y !== 0

  if (moving) {
    const pos = localPosition.value
    let newX = pos.x + dir.x * PLAYER_SPEED
    let newY = pos.y + dir.y * PLAYER_SPEED
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

  // Update spatial audio positions
  updateAudioPositions(localPosition.value, remotePositions.value)
}

// Watch for new remote participants
watch(
  () => Array.from(remoteParticipants.value.keys()),
  (participants, oldParticipants) => {
    const oldSet = new Set(oldParticipants || [])
    participants.forEach((id) => {
      if (!oldSet.has(id)) {
        const user = props.users.find((u) => u.id === id)
        void addRemoteCharacter(id, user?.nickname || "Unknown")
      }
    })
    oldSet.forEach((id) => {
      if (!participants.includes(id)) {
        removeRemoteCharacter(id)
      }
    })
  },
)

onMounted(async () => {
  await initializeLiveKit()

  // Initialize audio context on user gesture
  const initAudio = () => {
    initializeAudio()
    document.removeEventListener("click", initAudio)
    document.removeEventListener("touchstart", initAudio)
  }
  document.addEventListener("click", initAudio)
  document.addEventListener("touchstart", initAudio)

  await setupWorld()
  startPositionSync()
  startListening()

  // Start game tick
  tickInterval = setInterval(gameTick, 1000 / TICK_RATE)
})

onUnmounted(async () => {
  stopListening()
  stopPositionSync()

  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }

  worldRenderer.destroy()
  await cleanupLiveKit()
})
</script>

<style scoped>
.spatial-world-view {
  background: #1a1a2e;
}
</style>
