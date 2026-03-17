<template>
  <div v-if="isScreenShareSupported" class="relative inline-block">
    <!-- Screen Share Button -->
    <button
      type="button"
      class="control-button"
      :class="[
        sizeClasses,
        isScreenSharing
          ? 'bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent'
          : isGuest
            ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
            : 'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary',
      ]"
      :title="buttonTitle"
      @click="handleClick">
      <PhMonitorPlay :class="iconClasses" />
    </button>

    <!-- Lock Icon Overlay for Guests -->
    <div
      v-if="isGuest"
      class="absolute -bottom-1 -right-1 bg-theme-bg-secondary rounded-full p-0.5 border border-theme-border">
      <PhLock class="w-3 h-3 text-theme-text-muted" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { PhMonitorPlay, PhLock } from "@phosphor-icons/vue"
import { useCallStore, useUserStore } from "@/stores"
import { useScreenShareSupport } from "@/composables/useScreenShareSupport"
import { useSounds } from "@/services/sounds"
import { useAprilCaptcha } from "@/composables/useAprilCaptcha"

interface Props {
  modelValue: boolean
  size?: "sm" | "md" | "lg"
}

const props = withDefaults(defineProps<Props>(), {
  size: "md",
})

const emit = defineEmits<{
  "update:modelValue": [value: boolean]
  "start-screen-share": []
  "auth-required": []
}>()

// Stores and composables
const callStore = useCallStore()
const userStore = useUserStore()
const { isScreenShareSupported } = useScreenShareSupport()

// Captcha
const { showForAction } = useAprilCaptcha()

// Sounds
const { playScreenShareStart, playScreenShareStop } = useSounds()

// Computed properties
const isGuest = computed(() => userStore.isGuest)

const buttonTitle = computed(() => {
  if (isGuest.value) {
    return "Sign in to share your screen"
  }
  return isScreenSharing.value ? "Stop Sharing" : "Share Screen"
})

// Computed v-model
const isScreenSharing = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit("update:modelValue", value)
  },
})

// Size classes based on prop
const sizeClasses = computed(() => {
  switch (props.size) {
    case "sm":
      return "w-9 h-9 rounded-lg"
    case "lg":
      return "w-12 h-12 rounded-full"
    case "md":
    default:
      return "w-10 h-10 rounded-full"
  }
})

// Icon size classes
const iconClasses = computed(() => {
  switch (props.size) {
    case "sm":
      return "w-4 h-4"
    case "lg":
      return "w-5 h-5"
    case "md":
    default:
      return "w-5 h-5"
  }
})

// Handle button click
const handleClick = () => {
  // If user is a guest, emit auth-required event
  if (isGuest.value) {
    emit("auth-required")
    return
  }

  // Otherwise, toggle screen share
  toggleScreenShare()
}

// Toggle screen share - LiveKit handles all signaling
const toggleScreenShare = () => {
  const newValue = !isScreenSharing.value

  // If starting screen share, show captcha first
  if (newValue) {
    showForAction("screenshare", () => {
      emit("start-screen-share")
    })
    return
  }

  // If stopping, handle immediately without captcha
  playScreenShareStop()

  // Note: LiveKit will emit LocalTrackUnpublished event which updates state
  isScreenSharing.value = newValue

  // Update call store
  callStore.setScreenSharing(newValue)
}

// Method to be called by parent after quality is selected
// Note: LiveKit handles all screen sharing signaling internally
const confirmStartScreenShare = () => {
  const newValue = true

  // Play sound
  playScreenShareStart()

  isScreenSharing.value = newValue

  // Update call store
  callStore.setScreenSharing(newValue)
}

// Expose method for parent to call after quality selection
defineExpose({
  confirmStartScreenShare,
})
</script>

<style scoped>
/* Styles removed - now uses global .control-button from style.css */
</style>
