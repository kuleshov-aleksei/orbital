<template>
  <button
    type="button"
    data-testid="audio-deafen-button"
    class="control-button"
    :class="[
      sizeClasses,
      isDeafened
        ? 'bg-red-600 hover:bg-red-700 text-white'
        : 'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary',
    ]"
    :title="buttonTitle"
    @click="handleToggleDeafen">
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
import { useRoomStore } from "@/stores"
import { useMuteDeafenToggle } from "@/composables/useMuteDeafenToggle"
import { isElectron } from "@/services/electron"

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
const roomStore = useRoomStore()

// Shared mute/deafen toggle logic (sounds + store + ws sync)
const { toggleDeafen } = useMuteDeafenToggle()

// Show hotkey hint (D) only in web browser mode (hidden in spatial rooms where D is disabled)
const showHotkey = !isElectron() && roomStore.activeRoom?.type !== "spatial_audio"

const buttonTitle = computed(() => {
  const base = isDeafened.value ? "Undeafen" : "Deafen"
  return showHotkey ? `${base} (D)` : base
})

// Computed v-model
const isDeafened = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit("update:modelValue", value)
  },
})

// Corner radius classes (for split-button look with the mute button)
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

// Wrapper for positioned elements
const iconWrapperClasses = computed(() => {
  return `${iconClasses.value} relative`
})

// Slash line size
const slashClasses = computed(() => {
  const baseClasses = "bg-current rotate-45"
  switch (props.size) {
    case "sm":
      return `${baseClasses} w-5 h-0.5`
    case "lg":
      return `${baseClasses} w-6 h-0.5`
    case "md":
    default:
      return `${baseClasses} w-5 h-0.5`
  }
})

// Toggle deafen - presence store will sync with LiveKit
const handleToggleDeafen = () => {
  toggleDeafen()
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
