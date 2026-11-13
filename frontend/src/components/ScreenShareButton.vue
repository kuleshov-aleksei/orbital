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
          : isLocked
            ? 'bg-theme-bg-tertiary text-theme-text-muted cursor-not-allowed'
            : 'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary',
      ]"
      :title="buttonTitle"
      @click="handleClick">
      <PhMonitorPlay :class="iconClasses" />
    </button>

    <!-- Lock Icon Overlay when not permitted -->
    <div
      v-if="isLocked"
      class="absolute bottom-1 right-1 bg-theme-bg-secondary rounded-full p-0.5 border border-theme-border">
      <PhLock class="w-3 h-3 text-theme-text-muted" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { PhMonitorPlay, PhLock } from "@phosphor-icons/vue"
import { useCallStore, useUserStore, useRoomStore, usePermissionsStore } from "@/stores"
import { Permission } from "@/types/permissions"
import { useScreenShareSupport } from "@/composables/useScreenShareSupport"
import { useSounds } from "@/services/sounds"

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

// Sounds
const { playScreenShareStart, playScreenShareStop } = useSounds()

// Computed properties
const roomStore = useRoomStore()
const permissionsStore = usePermissionsStore()
// UI hint only: the backend LiveKit grant is what actually blocks publishing.
// Turning it off is always allowed.
const isLocked = computed(
  () =>
    !isScreenSharing.value &&
    !permissionsStore.can(Permission.Screenshare, { roomId: roomStore.activeRoomId }),
)

const buttonTitle = computed(() => {
  if (isLocked.value) {
    return userStore.isGuest
      ? "Sign in to share your screen"
      : "You don't have permission to share your screen here"
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
      return "h-9 w-12 rounded-lg"
    case "lg":
      return "h-10 w-14 rounded-lg"
    case "md":
    default:
      return "w-10 h-10 rounded-full"
  }
})

// Icon size classes
const iconClasses = computed(() => {
  switch (props.size) {
    case "sm":
      return "w-5 h-5"
    case "lg":
      return "w-5 h-5"
    case "md":
    default:
      return "w-5 h-5"
  }
})

// Handle button click
const handleClick = () => {
  // Not allowed here: guests are prompted to sign in, others just can't
  if (isLocked.value) {
    if (userStore.isGuest) {
      emit("auth-required")
    }
    return
  }

  // Otherwise, toggle screen share
  toggleScreenShare()
}

// Toggle screen share - LiveKit handles all signaling
const toggleScreenShare = () => {
  const newValue = !isScreenSharing.value

  // If starting screen share, emit event so parent can show quality modal
  if (newValue) {
    emit("start-screen-share")
    return
  }

  // Play sound
  playScreenShareStop()

  // If stopping, handle immediately
  // Note: LiveKit will emit LocalTrackUnpublished event which updates state
  isScreenSharing.value = newValue

  // Update call store
  callStore.setScreenSharing(newValue)
}

// Method to be called by parent after quality is selected
// Note: LiveKit handles all screen sharing signaling internally;
// the actual publish happens in VoiceCallView via startScreenShareWithQuality
const confirmStartScreenShare = () => {
  const newValue = true

  // Play sound
  playScreenShareStart()

  isScreenSharing.value = newValue

  // Update call store
  callStore.setScreenSharing(newValue)
}

// Expose method for parent to call after quality selection
// toggle: lets a wrapping row (mobile call sheet) act as the button's hit area
defineExpose({
  confirmStartScreenShare,
  toggle: handleClick,
})
</script>

<style scoped>
/* Styles removed - now uses global .control-button from style.css */
</style>
