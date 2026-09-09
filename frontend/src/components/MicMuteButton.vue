<template>
  <button
    type="button"
    class="control-button relative"
    :class="[
      sizeClasses,
      isMuted
        ? 'bg-red-600 hover:bg-red-700 text-white'
        : 'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary',
    ]"
    :title="buttonTitle"
    @click="toggleMute">
    <Transition name="icon-toggle" mode="out-in">
      <PhMicrophoneSlash v-if="isMuted" key="muted" :class="iconClasses" />

      <PhMicrophone v-else key="unmuted" :class="iconClasses" />
    </Transition>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { PhMicrophone, PhMicrophoneSlash } from "@phosphor-icons/vue"
import { useCallStore, useUserStore, useRoomStore } from "@/stores"
import { useSounds } from "@/services/sounds"
import { isElectron } from "@/services/electron"
import { wsService } from "@/services/websocket"

interface Props {
  modelValue: boolean
  size?: "sm" | "md" | "lg"
  corner?: "all" | "left" | "right"
}

const props = withDefaults(defineProps<Props>(), {
  size: "md",
  corner: "all",
})

const emit = defineEmits<{
  "update:modelValue": [value: boolean]
}>()

// Stores
const callStore = useCallStore()
const userStore = useUserStore()
const roomStore = useRoomStore()

// Sounds
const { playMute, playUnmute } = useSounds()

// Computed v-model
const isMuted = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit("update:modelValue", value)
  },
})

// Show hotkey hint (M) only in web browser mode
const showHotkey = !isElectron()

const buttonTitle = computed(() => {
  const base = isMuted.value ? "Unmute" : "Mute"
  return showHotkey ? `${base} (M)` : base
})

// Corner radius classes (for split-button look with the quick-settings caret)
const cornerClasses = computed(() => {
  switch (props.corner) {
    case "left":
      return "rounded-l-lg"
    case "right":
      return "rounded-r-lg"
    default:
      return "rounded-lg"
  }
})

// Size classes based on prop
const sizeClasses = computed(() => {
  switch (props.size) {
    case "sm":
      return `h-8 w-10 ${cornerClasses.value}`
    case "lg":
      return `h-10 w-14 ${cornerClasses.value}`
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

// Toggle mute - presence store will sync with LiveKit
const toggleMute = async () => {
  const newValue = !isMuted.value
  isMuted.value = newValue

  // Play sound locally (remote users hear it via presence.ts)
  if (newValue) {
    playMute()
  } else {
    playUnmute()
  }

  // Update call store (presence store watches this and syncs with LiveKit)
  callStore.setMuted(newValue)

  // Send to server for global state sync (users outside the call will see the state)
  const roomId = roomStore.activeRoomId
  if (roomId) {
    wsService.sendMuteState(roomId, newValue)
  }

  // Immediately update room store for local user so UI updates right away
  roomStore.updateUserStatus(userStore.userId, { is_muted: newValue })
}
</script>

<style scoped>
.icon-toggle-enter-active {
  transition:
    opacity 150ms var(--ease-out-smooth),
    transform 150ms var(--ease-out-smooth);
}

.icon-toggle-leave-active {
  transition:
    opacity 100ms var(--ease-out-smooth),
    transform 100ms var(--ease-out-smooth);
}

.icon-toggle-enter-from {
  opacity: 0;
  transform: scale(0.8);
}

.icon-toggle-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

@media (prefers-reduced-motion: reduce) {
  .icon-toggle-enter-active,
  .icon-toggle-leave-active {
    transition: none;
  }

  .icon-toggle-enter-from,
  .icon-toggle-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
