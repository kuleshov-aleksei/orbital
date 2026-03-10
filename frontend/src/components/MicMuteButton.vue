<template>
  <button
    type="button"
    class="control-button relative"
    :class="[
      sizeClasses,
      isMuted
        ? 'bg-red-600 hover:bg-red-700 text-white'
        : isSpeaking
          ? 'bg-green-600 hover:bg-green-700 text-white'
          : 'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary',
    ]"
    :title="isMuted ? 'Unmute' : 'Mute'"
    @click="toggleMute">
    <PhMicrophoneSlash
      v-if="isMuted"
      :class="[iconClasses, isSpeaking && !isMuted ? 'animate-pulse' : '']" />

    <PhMicrophone v-else :class="[iconClasses, isSpeaking ? 'animate-pulse' : '']" />

    <!-- Pulsating ring when speaking -->
    <span
      v-if="isSpeaking && !isMuted"
      class="absolute inset-0 rounded-full animate-ping bg-green-400 opacity-30" />
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { PhMicrophone, PhMicrophoneSlash } from "@phosphor-icons/vue"
import { useCallStore, useUserStore, useRoomStore } from "@/stores"
import { useSounds } from "@/services/sounds"
import { wsService } from "@/services/websocket"

interface Props {
  modelValue: boolean
  size?: "sm" | "md" | "lg"
  isSpeaking?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: "md",
  isSpeaking: false,
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

// Size classes based on prop
const sizeClasses = computed(() => {
  switch (props.size) {
    case "sm":
      return "w-8 h-8 rounded-full"
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
  wsService.sendMuteState(newValue)

  // Immediately update room store for local user so UI updates right away
  roomStore.updateUserStatus(userStore.userId, { is_muted: newValue })
}
</script>

<style scoped>
.control-button {
  @apply flex items-center justify-center transition-colors duration-200;
}
</style>
