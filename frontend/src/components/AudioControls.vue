<template>
  <div class="audio-controls">
    <div class="flex items-center justify-center space-x-4">
      <!-- Mute/Unmute -->
      <MicMuteButton v-model="isMuted" size="lg" />

      <!-- Deafen/Undeafen -->
      <AudioDeafenButton v-model="isDeafened" size="lg" />

      <!-- Screen Share -->
      <ScreenShareButton 
        ref="screenShareButtonRef"
        v-model="isScreenSharing" 
        size="lg" 
        @start-screen-share="$emit('start-screen-share')"
      />

      <!-- Leave Room -->
      <button
        type="button"
        class="control-button bg-red-600 hover:bg-red-700"
        @click="$emit('leave-room')"
      >
        <PhSignOut class="w-5 h-5" />
      </button>

      <!-- Debug -->
      <button
        type="button"
        :class="[
          'control-button',
          modelValueDebugVisible
            ? 'bg-red-600 hover:bg-red-700'
            : 'bg-gray-700 hover:bg-gray-600'
        ]"
        @click="toggleDebug"
      >
        <PhBug :class="['w-5 h-5', modelValueDebugVisible && 'animate-pulse']" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { PhSignOut, PhBug } from '@phosphor-icons/vue'
import MicMuteButton from '@/components/MicMuteButton.vue'
import AudioDeafenButton from '@/components/AudioDeafenButton.vue'
import ScreenShareButton from '@/components/ScreenShareButton.vue'
import type { ScreenShareQuality } from '@/types'

interface Props {
  modelValueMuted?: boolean
  modelValueDeafened?: boolean
  modelValueScreenSharing?: boolean
  modelValueDebugVisible?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValueMuted: false,
  modelValueDeafened: false,
  modelValueScreenSharing: false,
  modelValueDebugVisible: false
})

const emit = defineEmits<{
  'update:modelValueMuted': [value: boolean]
  'update:modelValueDeafened': [value: boolean]
  'update:modelValueScreenSharing': [value: boolean]
  'update:modelValueDebugVisible': [value: boolean]
  'start-screen-share': []
  'leave-room': []
}>()

// Template refs
const screenShareButtonRef = useTemplateRef<InstanceType<typeof ScreenShareButton>>('screenShareButtonRef')

// Computed v-model bindings
const isMuted = computed({
  get: () => props.modelValueMuted,
  set: (value) => emit('update:modelValueMuted', value)
})

const isDeafened = computed({
  get: () => props.modelValueDeafened,
  set: (value) => emit('update:modelValueDeafened', value)
})

const isScreenSharing = computed({
  get: () => props.modelValueScreenSharing,
  set: (value) => emit('update:modelValueScreenSharing', value)
})

// Methods
const toggleDebug = () => {
  emit('update:modelValueDebugVisible', !props.modelValueDebugVisible)
}

// Confirm screen share start (called by parent after quality selection)
const confirmStartScreenShare = async (quality: ScreenShareQuality, hasAudio: boolean) => {
  const button = screenShareButtonRef.value as unknown as { confirmStartScreenShare?: (quality: ScreenShareQuality, hasAudio: boolean) => Promise<void> } | null
  if (button?.confirmStartScreenShare) {
    await button.confirmStartScreenShare(quality, hasAudio)
  }
}

// Expose for parent component
defineExpose({
  confirmStartScreenShare
})
</script>

<style scoped>
.control-button {
  @apply w-12 h-12 rounded-full flex items-center justify-center transition-colors duration-200;
}
</style>
