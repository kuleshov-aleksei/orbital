<template>
  <div
    class="flex items-center justify-center space-x-4 flex-shrink-0 px-4 py-3 bg-gray-900/80 backdrop-blur-sm border-t border-gray-700/50">
    <!-- Mute/Unmute -->
    <MicMuteButton v-model="isMuted" :is-speaking="isSpeaking" size="lg" />

    <!-- Deafen/Undeafen -->
    <AudioDeafenButton v-model="isDeafened" size="lg" />

    <!-- Screen Share -->
    <ScreenShareButton
      ref="screenShareButtonRef"
      v-model="isScreenSharing"
      size="lg"
      @start-screen-share="$emit('start-screen-share')" />

    <!-- Camera -->
    <CameraButton
      v-model="isCameraEnabled"
      size="lg"
      @toggle-camera="$emit('toggle-camera', $event)"
      @auth-required="$emit('auth-required')" />

    <!-- Settings (mobile only) -->
    <button
      v-if="isMobile"
      type="button"
      class="control-button bg-gray-700 hover:bg-gray-600"
      title="Settings"
      @click="openSettings">
      <PhGearSix class="w-5 h-5" />
    </button>

    <!-- Leave Room -->
    <button
      type="button"
      class="control-button bg-red-600 hover:bg-red-700"
      @click="$emit('leave-room')">
      <PhSignOut class="w-5 h-5" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from "vue"
import { PhSignOut, PhGearSix } from "@phosphor-icons/vue"
import MicMuteButton from "@/components/MicMuteButton.vue"
import AudioDeafenButton from "@/components/AudioDeafenButton.vue"
import ScreenShareButton from "@/components/ScreenShareButton.vue"
import CameraButton from "@/components/CameraButton.vue"
import { useModalStore } from "@/stores"
import type { ScreenShareQuality } from "@/types"

interface Props {
  modelValueMuted?: boolean
  modelValueDeafened?: boolean
  modelValueScreenSharing?: boolean
  modelValueCameraEnabled?: boolean
  isSpeaking?: boolean
  isMobile?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValueMuted: false,
  modelValueDeafened: false,
  modelValueScreenSharing: false,
  modelValueCameraEnabled: false,
  isSpeaking: false,
  isMobile: false,
})

const emit = defineEmits<{
  "update:modelValueMuted": [value: boolean]
  "update:modelValueDeafened": [value: boolean]
  "update:modelValueScreenSharing": [value: boolean]
  "update:modelValueCameraEnabled": [value: boolean]
  "start-screen-share": []
  "toggle-camera": [enabled: boolean]
  "auth-required": []
  "leave-room": []
}>()

// Template refs
const screenShareButtonRef =
  useTemplateRef<InstanceType<typeof ScreenShareButton>>("screenShareButtonRef")

// Stores
const modalStore = useModalStore()

// Methods
const openSettings = () => {
  modalStore.openUserSettingsModal()
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
const confirmStartScreenShare = async (quality: ScreenShareQuality, hasAudio: boolean) => {
  const button = screenShareButtonRef.value as unknown as {
    confirmStartScreenShare?: (quality: ScreenShareQuality, hasAudio: boolean) => Promise<void>
  } | null
  if (button?.confirmStartScreenShare) {
    await button.confirmStartScreenShare(quality, hasAudio)
  }
}

// Expose for parent component
defineExpose({
  confirmStartScreenShare,
})
</script>

<style scoped>
.control-button {
  @apply w-12 h-12 rounded-full flex items-center justify-center transition-colors duration-200;
}
</style>
