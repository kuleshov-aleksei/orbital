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
import { PhUserCircle } from "@phosphor-icons/vue"
import { useLiveKit, useBoombox } from "@/composables"
import { useSpatialPosition } from "@/composables/useSpatialPosition"
import { useSpatialAudio } from "@/composables/useSpatialAudio"
import { useGameInput } from "@/composables/useGameInput"
import { useUserStore } from "@/stores"
import { createWorldRenderer } from "@/world/WorldRenderer"
import { createCharacterSprite } from "@/world/CharacterSprite"
import { getAnimations, getRegisteredKeys } from "@/world/ResourceManager"
import {
  PLAYER_SPEED,
  EARSHOT_RADIUS,
  BOOMBOX_INTERACT_DISTANCE,
  PLAYER_HITBOX,
} from "@/world/WorldConfig"
import { loadWorld } from "@/world/WorldData"
import type { WorldData } from "@/world/WorldTypes"
import {
  createCollisionSystem,
  createCollisionDebugOverlay,
  updateCollisionDebugOverlay,
} from "@/world/CollisionSystem"
import type { CollisionSystem } from "@/world/CollisionSystem"
import { createTilemapRenderer } from "@/world/TilemapRenderer"
import type { TilemapRenderer } from "@/world/TilemapRenderer"
import { createWorldObjectSprite } from "@/world/WorldObjectSprite"
import type { WorldObjectDisplay } from "@/world/WorldObjectSprite"
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
  worldId?: string
}

const props = withDefaults(defineProps<Props>(), {
  isMobile: false,
  modelValueMuted: false,
  modelValueDeafened: false,
  worldId: "default",
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
const boomboxPosition = ref({ x: 0, y: -200 })
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

const spatialAudio = useSpatialAudio({
  remoteAudioTracks,
  localPosition,
  remotePositions,
  boomboxTrack,
  boomboxPosition,
  boomboxVolume,
})
const { initializeAudio, resumeAudio, updateAudioPositions } = spatialAudio

const gameInput = useGameInput()
const { direction, startListening, stopListening } = gameInput

const worldRenderer = createWorldRenderer()

let boomboxContainer: Container | null = null
const showBoomboxModal = ref(false)
let boomboxSprite: Sprite | null = null

let localCharacterAnimations: AnimationTextures | null = null
let localCharacterDisplay: ReturnType<typeof createCharacterSprite> | null = null
const remoteCharacterDisplays = new Map<string, ReturnType<typeof createCharacterSprite>>()
const cancelledCharacterCreations = new Set<string>()
const lastRemoteFacing = new Map<string, boolean>()

let worldData: WorldData | null = null
let collisionSystem: CollisionSystem | null = null
let showCollisionDebug = false
let collisionDebugOverlay: Container | null = null
let onKeyDown: ((e: KeyboardEvent) => void) | null = null
let tilemapRenderer: TilemapRenderer | null = null
const worldObjectDisplays: WorldObjectDisplay[] = []

let animationFrameId: number | null = null
let lastFrameTime = 0

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

function getAnimation(dir: { x: number; y: number }): AnimationState {
  if (dir.x === 0 && dir.y === 0) return "idle"
  if (dir.y < 0) return "walk_up"
  if (dir.y > 0) return "walk_down"
  if (dir.x < 0) return "walk_left"
  return "walk_right"
}

async function setupWorld() {
  if (!worldContainer.value) return

  worldData = await loadWorld(props.worldId)

  await worldRenderer.init(worldContainer.value)

  boomboxPosition.value = worldData.props.find((p) => p.id === "boombox") ?? { x: 0, y: -200 }

  collisionSystem = createCollisionSystem(worldData)

  if (worldData.sources.length > 0) {
    tilemapRenderer = await createTilemapRenderer(props.worldId, worldData)
    worldRenderer.addTilemapBackground(tilemapRenderer.backgroundContainer)
    worldRenderer.addTilemapBackgroundDecoration(tilemapRenderer.backgroundDecorationContainer)
    worldRenderer.addTilemapGround(tilemapRenderer.groundContainer)
    worldRenderer.addTilemapGroundDecoration(tilemapRenderer.groundDecorationContainer)
    worldRenderer.addTilemapDecoration(tilemapRenderer.decorationContainer)
    worldRenderer.addTilemapSky(tilemapRenderer.skyContainer)

    for (const objConfig of worldData.objects) {
      const obj = createWorldObjectSprite(objConfig, (sourceId, tileId) =>
        tilemapRenderer!.getTileTexture(sourceId, tileId),
      )
      worldRenderer.addWorldObject(obj.container)
      worldObjectDisplays.push(obj)
    }
  }

  localCharacterAnimations = await getAnimations(selectedCharacter.value)
  localCharacterDisplay = createCharacterSprite(userStore.nickname, localCharacterAnimations)

  const spawn = worldData.spawn
  updateLocalPosition({ ...spawn })
  localCharacterDisplay.setPosition(spawn.x, spawn.y)
  localCharacterDisplay.setMuted(isMuted.value)
  worldRenderer.addCharacter("local", localCharacterDisplay)

  // Create boombox world object
  const bx = boomboxPosition.value
  const container = new Container()
  container.x = bx.x
  container.y = bx.y
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

  scanRemoteParticipantsForBoombox()
}

async function addRemoteCharacter(id: string, nickname: string) {
  if (remoteCharacterDisplays.has(id)) return

  const knownKey = remoteCharacterKeys.value.get(id) ?? "targ"
  const anims = await getAnimations(knownKey)

  if (cancelledCharacterCreations.has(id)) {
    cancelledCharacterCreations.delete(id)
    return
  }
  if (remoteCharacterDisplays.has(id)) return

  const display = createCharacterSprite(nickname, anims)

  const spawn = worldData?.spawn ?? { x: 10, y: 0 }
  const existingPos = remotePositions.value.get(id)
  display.setPosition(existingPos?.x ?? spawn.x, existingPos?.y ?? spawn.y)

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

let lastFacingRight = true
function gameTick(delta: number) {
  if (!localCharacterDisplay || !worldData) return

  const frameDelta = Math.min(delta / (1000 / 60), 3)

  const rawDir = direction.value
  const magnitude = Math.sqrt(rawDir.x * rawDir.x + rawDir.y * rawDir.y)
  const moving = magnitude > 0.01
  const dir = moving ? { x: rawDir.x / magnitude, y: rawDir.y / magnitude } : rawDir

  if (moving) {
    const pos = localPosition.value
    const velocity = {
      x: dir.x * PLAYER_SPEED * frameDelta,
      y: dir.y * PLAYER_SPEED * frameDelta,
    }
    const resolved = collisionSystem
      ? collisionSystem.resolveMovement(pos, velocity, PLAYER_HITBOX)
      : { x: pos.x + velocity.x, y: pos.y + velocity.y }
    updateLocalPosition(resolved)
  }

  if (dir.x !== 0) lastFacingRight = dir.x > 0

  localCharacterDisplay.setPosition(localPosition.value.x, localPosition.value.y)
  localCharacterDisplay.setAnimation(getAnimation(dir), lastFacingRight)

  if (showCollisionDebug && collisionDebugOverlay) {
    updateCollisionDebugOverlay(
      collisionDebugOverlay,
      localPosition.value.x,
      localPosition.value.y,
      PLAYER_HITBOX.width / 2,
      PLAYER_HITBOX.height / 2,
    )
  }

  remotePositions.value.forEach((pos, id) => {
    const display = remoteCharacterDisplays.get(id)
    if (display) {
      display.setPosition(pos.x, pos.y)
    }
  })

  worldRenderer.setCameraTarget(localPosition.value.x, localPosition.value.y)
  worldRenderer.updateCamera()

  worldRenderer.updateEarshotRadius(localPosition.value.x, localPosition.value.y, EARSHOT_RADIUS)

  updateAudioPositions(localPosition.value, remotePositions.value)

  if (boomboxAmIPlaying()) {
    boomboxUpdateLocalSpatial(localPosition.value, boomboxPosition.value)
  }

  const bx = boomboxPosition.value
  const dx = localPosition.value.x - bx.x
  const dy = localPosition.value.y - bx.y
  const distToBoombox = Math.sqrt(dx * dx + dy * dy)
  showBoomboxModal.value = distToBoombox < BOOMBOX_INTERACT_DISTANCE

  if (boomboxSprite && boomboxIsPlaying.value) {
    const pulse = 2.0 + Math.sin(performance.now() / 300) * 0.08
    boomboxSprite.scale.set(pulse)
  } else if (boomboxSprite) {
    boomboxSprite.scale.set(2.0)
  }

  if (tilemapRenderer) {
    const size = worldRenderer.getScreenSize()
    tilemapRenderer.update(
      localPosition.value.x,
      localPosition.value.y,
      size.width,
      size.height,
      delta,
    )
  }

  for (const obj of worldObjectDisplays) {
    obj.update(delta)
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

  const lp = localParticipant.value
  if (lp) {
    localCharacterDisplay.setSpeaking(lp.isSpeaking)
  }

  localCharacterDisplay.setMuted(isMuted.value)

  void sendCharacterChange(key)
}

async function changeRemoteCharacter(id: string, characterKey: string) {
  cancelledCharacterCreations.add(id)

  const spawn = worldData?.spawn ?? { x: 10, y: 0 }
  const pos = remotePositions.value.get(id) ?? spawn
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
    participant.on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) => {
      remoteCharacterDisplays.get(identity)?.setSpeaking(speaking)
    })
    remoteCharacterDisplays.get(identity)?.setSpeaking(participant.isSpeaking)

    participant.on(ParticipantEvent.AttributesChanged, (changedAttributes) => {
      if ("is_muted" in changedAttributes) {
        remoteCharacterDisplays.get(identity)?.setMuted(changedAttributes.is_muted === "true")
      }
      handleBoomboxAttributesChanged(changedAttributes, identity)
    })
    remoteCharacterDisplays.get(identity)?.setMuted(participant.attributes.is_muted === "true")
  })
  void sendCharacterChange(selectedCharacter.value)
}

function handleParticipantDisconnected(participant: RemoteParticipant) {
  const identity = participant.identity
  cancelledCharacterCreations.add(identity)
  removeRemoteCharacter(identity)
  scanRemoteParticipantsForBoombox()
}

function toggleCollisionDebug() {
  showCollisionDebug = !showCollisionDebug
  if (showCollisionDebug && worldData && collisionDebugOverlay === null) {
    collisionDebugOverlay = createCollisionDebugOverlay(worldData)
    worldRenderer.addCollisionDebug(collisionDebugOverlay)
  } else if (!showCollisionDebug && collisionDebugOverlay !== null) {
    worldRenderer.removeCollisionDebug(collisionDebugOverlay)
    collisionDebugOverlay.destroy({ children: true })
    collisionDebugOverlay = null
  }
}

onMounted(async () => {
  initializeAudio()

  const resumeAudioOnGesture = () => {
    void resumeAudio()
    document.removeEventListener("click", resumeAudioOnGesture)
    document.removeEventListener("touchstart", resumeAudioOnGesture)
  }
  document.addEventListener("click", resumeAudioOnGesture)
  document.addEventListener("touchstart", resumeAudioOnGesture)

  onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "c" || e.key === "C") {
      toggleCollisionDebug()
    }
  }
  document.addEventListener("keydown", onKeyDown)

  await initializeLiveKit()

  const lkRoom = room.value
  if (lkRoom) {
    lkRoom.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
    lkRoom.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
  }

  await setupWorld()

  startPositionSync()
  void sendCharacterChange(selectedCharacter.value)

  const lp = localParticipant.value
  if (lp) {
    lp.on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) => {
      localCharacterDisplay?.setSpeaking(speaking)
    })
    localCharacterDisplay?.setSpeaking(lp.isSpeaking)
  }

  for (const [, participant] of remoteParticipants.value) {
    handleParticipantConnected(participant)
  }

  startListening()

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
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }

  document.removeEventListener("keydown", onKeyDown)

  if (collisionDebugOverlay) {
    worldRenderer.removeCollisionDebug(collisionDebugOverlay)
    collisionDebugOverlay.destroy({ children: true })
    collisionDebugOverlay = null
  }

  const lkRoom = room.value
  if (lkRoom) {
    lkRoom.off(RoomEvent.ParticipantConnected, handleParticipantConnected)
    lkRoom.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
  }

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

  for (const obj of worldObjectDisplays) {
    obj.destroy()
  }
  worldObjectDisplays.length = 0

  if (tilemapRenderer) {
    worldRenderer.removeTilemapBackground(tilemapRenderer.backgroundContainer)
    worldRenderer.removeTilemapBackgroundDecoration(tilemapRenderer.backgroundDecorationContainer)
    worldRenderer.removeTilemapGround(tilemapRenderer.groundContainer)
    worldRenderer.removeTilemapGroundDecoration(tilemapRenderer.groundDecorationContainer)
    worldRenderer.removeTilemapDecoration(tilemapRenderer.decorationContainer)
    worldRenderer.removeTilemapSky(tilemapRenderer.skyContainer)
    tilemapRenderer.destroy()
    tilemapRenderer = null
  }

  await boomboxStop()

  worldRenderer.destroy()
  await cleanupLiveKit()

  worldData = null
  collisionSystem = null
})
</script>

<style scoped>
.spatial-world-view {
  background: #1a1a2e;
}
</style>
