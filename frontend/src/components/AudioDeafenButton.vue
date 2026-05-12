<template>
  <button
    type="button"
    class="control-button"
    :class="[
      sizeClasses,
      isDeafened
        ? 'bg-red-600 hover:bg-red-700 text-white'
        : 'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary',
    ]"
    :title="isDeafened ? 'Undeafen' : 'Deafen'"
    @click="toggleDeafen">
    <Transition name="icon-toggle" mode="out-in">
      <!-- Headphones with slash when deafened -->
      <div v-if="isDeafened" :key="'deafened'" :class="iconWrapperClasses">
        <PhHeadphones :class="iconClasses" />

        <div class="absolute inset-0 flex items-center justify-center">
          <div :class="slashClasses"></div>
        </div>
      </div>
      <!-- Normal headphones when not deafened -->
      <PhHeadphones v-else :key="'undeafened'" :class="iconClasses" />
    </Transition>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { PhHeadphones } from "@phosphor-icons/vue"
import { useCallStore, useUserStore, useRoomStore } from "@/stores"
import { useSounds } from "@/services/sounds"
import { wsService } from "@/services/websocket"

interface Props {
  modelValue: boolean
  size?: "sm" | "md" | "lg"
}

const props = withDefaults(defineProps<Props>(), {
  size: "md",
})

const emit = defineEmits<{
  "update:modelValue": [value: boolean]
}>()

// Stores
const callStore = useCallStore()
const userStore = useUserStore()
const roomStore = useRoomStore()

// Sounds
const { playDeafen, playUndeafen } = useSounds()

// Computed v-model
const isDeafened = computed({
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

// Wrapper for positioned elements
const iconWrapperClasses = computed(() => {
  return `${iconClasses.value} relative`
})

// Slash line size
const slashClasses = computed(() => {
  const baseClasses = "bg-current rotate-45"
  switch (props.size) {
    case "sm":
      return `${baseClasses} w-4 h-0.5`
    case "lg":
      return `${baseClasses} w-6 h-0.5`
    case "md":
    default:
      return `${baseClasses} w-5 h-0.5`
  }
})

// Toggle deafen - presence store will sync with LiveKit
const toggleDeafen = async () => {
  const newValue = !isDeafened.value

  // Play sound locally (remote users hear it via presence.ts)
  if (newValue) {
    playDeafen()
  } else {
    playUndeafen()
  }

  // Update call store (presence store watches this and syncs with LiveKit)
  // This also handles auto-mute on deafen and restore-mute on undeafen
  callStore.setDeafened(newValue)

  // Send to server for global state sync (users outside the call will see the state)
  const roomId = roomStore.activeRoomId
  if (roomId) {
    wsService.sendDeafenState(roomId, newValue)
  }

  // Immediately update room store for local user so UI updates right away
  // Use callStore.isMuted to get the actual current mute state after setDeafened
  roomStore.updateUserStatus(userStore.userId, {
    is_deafened: newValue,
    is_muted: callStore.isMuted,
  })
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
