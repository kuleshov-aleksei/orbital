<template>
  <div
    class="spatial-world-view flex flex-1 min-h-0 relative"
    :class="{ 'pointer-events-none': !isConnected }"
    data-testid="spatial-world-view">
    <div ref="worldContainer" class="absolute inset-0" />

    <div class="relative z-[100] flex flex-col flex-1" style="pointer-events: none">
      <!-- Room Header (clickable through the canvas) -->
      <div style="pointer-events: auto">
        <RoomHeader
          :room-name="currentRoom?.name || 'Spatial Room'"
          :screen-share-count="0"
          :screen-share-layout="'grid'"
          :is-mobile="isMobile"
          @leave-room="$emit('leave-room')"
          @show-room-list="$emit('show-room-list')"
          @toggle-user-sidebar="$emit('toggle-user-sidebar')" />
      </div>

      <!-- Right Toolbar -->
      <div
        class="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-40"
        style="pointer-events: auto">
        <!-- Character picker toggle -->
        <div class="relative">
          <button
            type="button"
            class="w-10 h-10 rounded-xl bg-theme-bg-secondary border border-theme-border flex items-center justify-center text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-all duration-200"
            title="Character"
            @click="showCharacterPicker = !showCharacterPicker">
            <PhUserCircle class="w-5 h-5" />
          </button>
          <CharacterPicker
            :visible="showCharacterPicker"
            :selected="selectedCharacter"
            @select="onSelectCharacter" />
        </div>

        <!-- Prop creation (placeholder) -->
        <button
          type="button"
          class="w-10 h-10 rounded-xl bg-theme-bg-secondary border border-theme-border flex items-center justify-center text-theme-text-muted/40 cursor-not-allowed transition-all duration-200"
          title="Props (coming soon)"
          disabled>
          <PhMagicWand class="w-5 h-5" />
        </button>
      </div>

      <!-- Click-outside overlay for picker -->
      <div
        v-if="showCharacterPicker"
        class="fixed inset-0 z-30"
        style="pointer-events: auto"
        @click="showCharacterPicker = false" />

      <!-- Boombox Modal (proximity-based) -->
      <div
        v-if="showBoomboxModal"
        class="absolute bottom-20 left-1/2 -translate-x-1/2 z-50"
        style="pointer-events: auto">
        <BoomboxModal
          :is-playing="boomboxIsPlaying"
          :am-i-playing="boomboxAmIPlaying()"
          :current-track-id="boomboxTrackId"
          :current-track-name="boomboxTrackName"
          :owner-nickname="boomboxOwnerNick"
          :boombox-volume="boomboxVolume"
          :playlist="playlist"
          @update:boombox-volume="boomboxVolume = $event"
          @play="(trackId, trackName, url) => boomboxPlay(trackId, trackName, url)"
          @stop="boomboxStop"
          @queue="(trackId, trackName) => queueTrack(trackId, trackName)"
          @skip="skipTrack" />
      </div>

      <!-- Audio Controls (clickable through the canvas) -->
      <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-30" style="pointer-events: auto">
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
import { ref, computed, watch, onMounted, onUnmounted, useTemplateRef } from "vue"
import { Container, Sprite, Assets, SCALE_MODES } from "pixi.js"
import { RoomEvent, ParticipantEvent } from "livekit-client"
import type { RemoteParticipant } from "livekit-client"
import AudioControls from "@/components/AudioControls.vue"
import RoomHeader from "@/components/RoomHeader.vue"
import CharacterPicker from "@/components/CharacterPicker.vue"
import BoomboxModal from "@/components/BoomboxModal.vue"
import type { CharacterKey } from "@/components/CharacterPicker.vue"
import { PhUserCircle, PhMagicWand } from "@phosphor-icons/vue"
import { useLiveKit, useBoombox } from "@/composables"
import { useSpatialPosition } from "@/composables/useSpatialPosition"
import { useSpatialAudio } from "@/composables/useSpatialAudio"
import { useGameInput } from "@/composables/useGameInput"
import { useUserStore } from "@/stores"
import { createWorldRenderer } from "@/world/WorldRenderer"
import { createCharacterSprite } from "@/world/CharacterSprite"
import { getAnimations, getRegisteredKeys } from "@/world/ResourceManager"
import {
  SPAWN_POSITION,
  PLAYER_SPEED,
  WORLD_BOUNDARIES,
  EARSHOT_RADIUS,
  BOOMBOX_POSITION,
  BOOMBOX_INTERACT_DISTANCE,
} from "@/world/WorldConfig"
import { assetPath } from "@/utils/assetPath"
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
const CHARACTER_KEY = "orbital_character"
function loadCharacter(): CharacterKey {
  const stored = localStorage.getItem(CHARACTER_KEY)
  const knownKeys = getRegisteredKeys()
  if (stored && knownKeys.includes(stored)) {
    return stored as CharacterKey
  }
  return "targ"
}

const userStore = useUserStore()
const selectedCharacter = ref<CharacterKey>(loadCharacter())
const showCharacterPicker = ref(false)

const worldContainer = useTemplateRef<HTMLElement>("worldContainer")

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
const spatialPosition = useSpatialPosition({
  room,
  localParticipant,
  characterKey: selectedCharacter,
  onCharacterChange: (participantId, characterKey) => {
    changeRemoteCharacter(participantId, characterKey)
  },
  onRemoteMove: (participantId, dx, dy) => {
    const display = remoteCharacterDisplays.get(participantId)
    if (!display) return
    const threshold = 5.0
    if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
      const facingRight = dx > 0 || (dx === 0 && (lastRemoteFacing.get(participantId) ?? true))
      display.setAnimation(getAnimation({ x: dx, y: dy }), facingRight)
      lastRemoteFacing.set(participantId, facingRight)
    } else {
      display.setAnimation("idle", lastRemoteFacing.get(participantId) ?? true)
    }
  },
})
const {
  localPosition,
  remotePositions,
  remoteCharacterKeys,
  updateLocalPosition,
  startPositionSync,
  stopPositionSync,
  sendCharacterChange,
} = spatialPosition

// Boombox
const boomboxPosition = ref({ ...BOOMBOX_POSITION })
const boombox = useBoombox({
  lkRoom: room,
  localParticipant,
  remoteAudioTracks,
  remoteParticipants,
})
const {
  isPlaying: boomboxIsPlaying,
  currentTrackId: boomboxTrackId,
  currentTrackName: boomboxTrackName,
  ownerNickname: boomboxOwnerNick,
  boomboxTrack: boomboxTrack,
  boomboxVolume,
  playlist,
  play: boomboxPlay,
  stop: boomboxStop,
  amIPlaying: boomboxAmIPlaying,
  queueTrack,
  skipTrack,
  updateLocalSpatial: boomboxUpdateLocalSpatial,
  scanRemoteParticipantsForBoombox,
  handleAttributesChanged: handleBoomboxAttributesChanged,
} = boombox

// Spatial audio
const spatialAudio = useSpatialAudio({
  remoteAudioTracks,
  localPosition,
  remotePositions,
  boomboxTrack,
  boomboxPosition,
})
const { initializeAudio, resumeAudio, updateAudioPositions } = spatialAudio

// Game input
const gameInput = useGameInput()
const { direction, startListening, stopListening } = gameInput

// World renderer
const worldRenderer = createWorldRenderer()

// Boombox world object
let boomboxContainer: Container | null = null
const showBoomboxModal = ref(false)
let boomboxSprite: Sprite | null = null

// Local character
let localCharacterAnimations: AnimationTextures | null = null
let localCharacterDisplay: ReturnType<typeof createCharacterSprite> | null = null
const remoteCharacterDisplays = new Map<string, ReturnType<typeof createCharacterSprite>>()
const cancelledCharacterCreations = new Set<string>()
const lastRemoteFacing = new Map<string, boolean>()

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
  if (dir.x === 0 && dir.y === 0) return "idle"
  if (dir.y < 0) return "walk_up"
  if (dir.y > 0) return "walk_down"
  if (dir.x < 0) return "walk_left"
  return "walk_right"
}

// Setup world and characters
async function setupWorld() {
  if (!worldContainer.value) return

  await worldRenderer.init(worldContainer.value)

  // Create local character
  localCharacterAnimations = await getAnimations(selectedCharacter.value)
  localCharacterDisplay = createCharacterSprite(userStore.nickname, localCharacterAnimations)

  // Spawn at center — use updateLocalPosition to sync internal _myPosition
  updateLocalPosition({ ...SPAWN_POSITION })
  localCharacterDisplay.setPosition(SPAWN_POSITION.x, SPAWN_POSITION.y)
  localCharacterDisplay.setMuted(isMuted.value)
  worldRenderer.addCharacter("local", localCharacterDisplay)

  // Create boombox world object
  const container = new Container()
  container.x = BOOMBOX_POSITION.x
  container.y = BOOMBOX_POSITION.y
  boomboxContainer = container

  try {
    const texture = await Assets.load(assetPath("/assets/world/boombox.png"))
    const sprite = new Sprite(texture)
    texture.baseTexture.scaleMode = SCALE_MODES.NEAREST
    sprite.anchor.set(0.5, 0.5)
    sprite.scale.set(2.0)
    container.addChild(sprite)
    boomboxSprite = sprite
  } catch (e) {
    console.warn("[Boombox] Failed to load boombox sprite:", e)
    const fallback = new Sprite()
    fallback.anchor.set(0.5, 0.5)
    container.addChild(fallback)
  }

  worldRenderer.addWorldObject(container)

  // Scan remote participants for boombox state (important for late joiners)
  scanRemoteParticipantsForBoombox()
}

async function addRemoteCharacter(id: string, nickname: string) {
  if (remoteCharacterDisplays.has(id)) return

  // Use known character key from position data, fall back to "targ"
  const knownKey = remoteCharacterKeys.value.get(id) ?? "targ"
  const anims = await getAnimations(knownKey)

  // Check for disconnect or character change while loading
  if (cancelledCharacterCreations.has(id)) {
    cancelledCharacterCreations.delete(id)
    return
  }
  // Another create (from changeRemoteCharacter) may have finished while we were loading
  if (remoteCharacterDisplays.has(id)) return

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
let lastFacingRight = true
function gameTick(delta: number) {
  if (!localCharacterDisplay) return

  // Normalize delta to 60fps frames for consistent speed
  const frameDelta = Math.min(delta / (1000 / 60), 3)

  // Process input with normalized direction (diagonal moves same speed as cardinal)
  const rawDir = direction.value
  const magnitude = Math.sqrt(rawDir.x * rawDir.x + rawDir.y * rawDir.y)
  const moving = magnitude > 0.01
  const dir = moving ? { x: rawDir.x / magnitude, y: rawDir.y / magnitude } : rawDir

  if (moving) {
    const pos = localPosition.value
    let newX = pos.x + dir.x * PLAYER_SPEED * frameDelta
    let newY = pos.y + dir.y * PLAYER_SPEED * frameDelta
    newX = Math.max(WORLD_BOUNDARIES.minX, Math.min(WORLD_BOUNDARIES.maxX, newX))
    newY = Math.max(WORLD_BOUNDARIES.minY, Math.min(WORLD_BOUNDARIES.maxY, newY))
    updateLocalPosition({ x: newX, y: newY })
  }

  // Track last horizontal facing direction
  if (dir.x !== 0) lastFacingRight = dir.x > 0

  // Update local character visuals
  localCharacterDisplay.setPosition(localPosition.value.x, localPosition.value.y)
  localCharacterDisplay.setAnimation(getAnimation(dir), lastFacingRight)

  // Update remote character positions
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

  // Update DJ's local boombox spatialization
  if (boomboxAmIPlaying()) {
    boomboxUpdateLocalSpatial(localPosition.value, BOOMBOX_POSITION)
  }

  // Boombox proximity detection
  const dx = localPosition.value.x - BOOMBOX_POSITION.x
  const dy = localPosition.value.y - BOOMBOX_POSITION.y
  const distToBoombox = Math.sqrt(dx * dx + dy * dy)
  showBoomboxModal.value = distToBoombox < BOOMBOX_INTERACT_DISTANCE

  // Boombox scale pulse animation
  if (boomboxSprite && boomboxIsPlaying.value) {
    const pulse = 2.0 + Math.sin(performance.now() / 300) * 0.08
    boomboxSprite.scale.set(pulse)
  } else if (boomboxSprite) {
    boomboxSprite.scale.set(2.0)
  }
}

async function changeCharacter(key: CharacterKey) {
  selectedCharacter.value = key
  if (!localCharacterDisplay) return

  worldRenderer.removeCharacter("local")
  localCharacterDisplay = null
  localCharacterAnimations = await getAnimations(key)
  localCharacterDisplay = createCharacterSprite(userStore.nickname, localCharacterAnimations)
  localCharacterDisplay.setPosition(localPosition.value.x, localPosition.value.y)
  worldRenderer.addCharacter("local", localCharacterDisplay)

  // Re-apply speaking state
  const lp = localParticipant.value
  if (lp) {
    localCharacterDisplay.setSpeaking(lp.isSpeaking)
  }

  // Re-apply mute state
  localCharacterDisplay.setMuted(isMuted.value)

  // Broadcast to other participants
  void sendCharacterChange(key)
}

async function changeRemoteCharacter(id: string, characterKey: string) {
  cancelledCharacterCreations.add(id)

  const pos = remotePositions.value.get(id) ?? SPAWN_POSITION
  const user = props.users.find((u) => u.id === id)
  const nickname = user?.nickname || id

  removeRemoteCharacter(id)
  const anims = await getAnimations(characterKey)
  cancelledCharacterCreations.delete(id)

  const display = createCharacterSprite(nickname, anims)
  display.setPosition(pos.x, pos.y)
  remoteCharacterDisplays.set(id, display)
  worldRenderer.addCharacter(id, display)

  const lkRoom = room.value
  const participant = lkRoom?.remoteParticipants.get(id)
  if (participant) {
    display.setSpeaking(participant.isSpeaking)
    display.setMuted(participant.attributes.is_muted === "true")
  }
}

watch(selectedCharacter, (key) => {
  localStorage.setItem(CHARACTER_KEY, key)
})

watch(isMuted, (muted) => {
  localCharacterDisplay?.setMuted(muted)
})

function onSelectCharacter(key: CharacterKey) {
  showCharacterPicker.value = false
  void changeCharacter(key)
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

    // Listen for mute attribute changes
    participant.on(ParticipantEvent.AttributesChanged, (changedAttributes) => {
      if ("is_muted" in changedAttributes) {
        remoteCharacterDisplays.get(identity)?.setMuted(changedAttributes.is_muted === "true")
      }
      // Forward boombox attribute changes to boombox composable
      handleBoomboxAttributesChanged(changedAttributes, identity)
    })
    remoteCharacterDisplays.get(identity)?.setMuted(participant.attributes.is_muted === "true")
  })
  // Broadcast our character so the new participant sees the right sprite immediately
  void sendCharacterChange(selectedCharacter.value)
}

function handleParticipantDisconnected(participant: RemoteParticipant) {
  const identity = participant.identity
  cancelledCharacterCreations.add(identity)
  removeRemoteCharacter(identity)
  scanRemoteParticipantsForBoombox()
}

onMounted(async () => {
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

  // Must init world BEFORE listening for remote data (cameraContainer is created in init)
  await setupWorld()

  // Start position sync after world is ready — listens for incoming data
  startPositionSync()
  // Broadcast our current character so remote participants see the right sprite
  void sendCharacterChange(selectedCharacter.value)

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

  if (boomboxContainer && worldRenderer) {
    worldRenderer.removeWorldObject(boomboxContainer)
    boomboxContainer.destroy({ children: true })
    boomboxContainer = null
    boomboxSprite = null
  }

  // Stop boombox (safe to call even if not playing — guards internally)
  await boomboxStop()

  worldRenderer.destroy()
  await cleanupLiveKit()
})
</script>

<style scoped>
.spatial-world-view {
  background: #1a1a2e;
}
</style>
