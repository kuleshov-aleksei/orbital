<template>
  <!-- Mobile: compact bar with a pull-up sheet for everything else -->
  <MobileCallControls
    v-if="isMobile"
    ref="mobileControlsRef"
    v-model:muted="isMuted"
    v-model:deafened="isDeafened"
    v-model:screen-sharing="isScreenSharing"
    v-model:camera-enabled="isCameraEnabled"
    :is-spatial-room="isSpatialRoom"
    :has-multiple-cameras="hasMultipleCameras"
    @start-screen-share="$emit('start-screen-share')"
    @toggle-camera="$emit('toggle-camera', $event)"
    @flip-camera="handleFlipCamera"
    @auth-required="$emit('auth-required')"
    @leave-room="handleLeaveRoom" />

  <div
    v-else
    data-testid="audio-controls"
    class="flex items-center shrink-0 justify-center gap-2 px-4 py-3">
    <!-- Group: Mute + Audio quick-settings caret + Deafen -->
    <div :class="groupClass">
      <div class="flex items-center">
        <MicMuteButton v-model="isMuted" size="lg" corner="left" />
        <AudioControlsDropdown :muted="isMuted" />
      </div>
      <AudioDeafenButton v-model="isDeafened" size="lg" />
    </div>

    <!-- Group: Camera + Screen Share -->
    <div v-if="!isSpatialRoom" :class="groupClass">
      <div class="flex items-center">
        <CameraButton
          v-model="isCameraEnabled"
          size="lg"
          :corner="hasMultipleCameras ? 'left' : 'all'"
          @toggle-camera="$emit('toggle-camera', $event)"
          @auth-required="$emit('auth-required')" />
        <button
          v-if="hasMultipleCameras"
          type="button"
          class="h-10 w-6 rounded-r-lg flex items-center justify-center transition-colors cursor-pointer bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary"
          title="Switch Camera"
          @click="handleFlipCamera">
          <PhArrowsClockwise class="w-4 h-4 pointer-events-none" />
        </button>
      </div>
      <ScreenShareButton
        ref="screenShareButtonRef"
        v-model="isScreenSharing"
        size="lg"
        @start-screen-share="$emit('start-screen-share')" />
    </div>

    <!-- Group: Soundboard -->
    <div :class="groupClass">
      <SoundboardButton />
    </div>

    <!-- Stop Watching -->
    <button
      v-if="callStore.watchingUserIds.size > 0"
      type="button"
      class="control-button h-12 w-16 rounded-lg bg-amber-600 hover:bg-amber-700"
      title="Stop watching"
      @click="callStore.triggerStopWatching()">
      <PhImageBroken class="w-5 h-5" />
    </button>

    <!-- Leave Room -->
    <button
      v-else
      type="button"
      class="control-button h-12 w-16 rounded-lg bg-red-600 hover:bg-red-700"
      title="Leave Room"
      @click="handleLeaveRoom">
      <PhSignOut class="w-5 h-5" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, useTemplateRef } from "vue"
import { PhSignOut, PhImageBroken, PhArrowsClockwise } from "@phosphor-icons/vue"
import MicMuteButton from "@/components/MicMuteButton.vue"
import AudioDeafenButton from "@/components/AudioDeafenButton.vue"
import ScreenShareButton from "@/components/ScreenShareButton.vue"
import CameraButton from "@/components/CameraButton.vue"
import AudioControlsDropdown from "@/components/AudioControlsDropdown.vue"
import SoundboardButton from "@/components/soundboard/SoundboardButton.vue"
import MobileCallControls from "@/components/MobileCallControls.vue"
import { useCallStore, useRoomStore, useVideoSettingsStore } from "@/stores"

interface Props {
  modelValueMuted?: boolean
  modelValueDeafened?: boolean
  modelValueScreenSharing?: boolean
  modelValueCameraEnabled?: boolean
  isMobile?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValueMuted: false,
  modelValueDeafened: false,
  modelValueScreenSharing: false,
  modelValueCameraEnabled: false,
  isMobile: false,
})

const emit = defineEmits<{
  "update:modelValueMuted": [value: boolean]
  "update:modelValueDeafened": [value: boolean]
  "update:modelValueScreenSharing": [value: boolean]
  "update:modelValueCameraEnabled": [value: boolean]
  "start-screen-share": []
  "toggle-camera": [enabled: boolean]
  "flip-camera": []
  "auth-required": []
  "leave-room": []
}>()

const groupClass = "flex items-center gap-1.5 p-1.5 rounded-xl bg-theme-bg-secondary"

// Template refs
const screenShareButtonRef =
  useTemplateRef<InstanceType<typeof ScreenShareButton>>("screenShareButtonRef")
const mobileControlsRef =
  useTemplateRef<InstanceType<typeof MobileCallControls>>("mobileControlsRef")

// Stores
const callStore = useCallStore()
const roomStore = useRoomStore()
const videoSettingsStore = useVideoSettingsStore()

// Whether room is spatial (hide camera/screenshare)
const isSpatialRoom = computed(() => roomStore.activeRoom?.type === "spatial_audio")

// Show the switch-camera button only when more than one camera is available
const hasMultipleCameras = computed(() => videoSettingsStore.availableDevices.length > 1)

const refreshCameras = async () => {
  await videoSettingsStore.enumerateDevices()
}

const handleFlipCamera = async () => {
  await refreshCameras()
  emit("flip-camera")
}

onMounted(async () => {
  if (!isSpatialRoom.value) {
    await refreshCameras()
    navigator.mediaDevices?.addEventListener("devicechange", refreshCameras)
  }
})

onUnmounted(() => {
  navigator.mediaDevices?.removeEventListener("devicechange", refreshCameras)
})

// Methods
const handleLeaveRoom = () => {
  emit("leave-room")
}

// Computed v-model bindings
const isMuted = computed({
  get: () => props.modelValueMuted,
  set: (value) => emit("update:modelValueMuted", value),
})

const isDeafened = computed({
  get: () => props.modelValueDeafened,
  set: (value) => emit("update:modelValueDeafened", value),
})

const isScreenSharing = computed({
  get: () => props.modelValueScreenSharing,
  set: (value) => emit("update:modelValueScreenSharing", value),
})

const isCameraEnabled = computed({
  get: () => props.modelValueCameraEnabled,
  set: (value) => emit("update:modelValueCameraEnabled", value),
})

// Confirm screen share start (called by parent after quality selection)
const confirmStartScreenShare = async () => {
  if (props.isMobile) {
    mobileControlsRef.value?.confirmStartScreenShare()
    return
  }
  const button = screenShareButtonRef.value as unknown as {
    confirmStartScreenShare?: () => Promise<void>
  } | null
  if (button?.confirmStartScreenShare) {
    await button.confirmStartScreenShare()
  }
}

// Expose for parent component
defineExpose({
  confirmStartScreenShare,
})
</script>
