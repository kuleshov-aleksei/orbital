<template>
  <div class="relative inline-block">
    <!-- Camera Button -->
    <button
      type="button"
      class="control-button"
      :class="[
        sizeClasses,
        isCameraEnabled
          ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
          : isGuest
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white',
      ]"
      :title="buttonTitle"
      @click="handleClick">
      <PhCamera :class="iconClasses" />
    </button>

    <!-- Lock Icon Overlay for Guests -->
    <div
      v-if="isGuest"
      class="absolute -bottom-1 -right-1 bg-gray-800 rounded-full p-0.5 border border-gray-700">
      <PhLock class="w-3 h-3 text-gray-500" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { PhCamera, PhLock } from "@phosphor-icons/vue"
import { useCallStore, useUserStore } from "@/stores"
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
  "toggle-camera": [enabled: boolean]
  "auth-required": []
}>()

// Stores
const callStore = useCallStore()
const userStore = useUserStore()

// Sounds
const { toggleOn, toggleOff } = useSounds()

// Computed properties
const isGuest = computed(() => userStore.isGuest)

const buttonTitle = computed(() => {
  if (isGuest.value) {
    return "Login required for camera"
  }
  return isCameraEnabled.value ? "Turn Off Camera" : "Turn On Camera"
})

// Computed v-model
const isCameraEnabled = computed({
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

  // Toggle camera
  const newValue = !isCameraEnabled.value
  isCameraEnabled.value = newValue

  // Play sound
  if (newValue) {
    toggleOn()
  } else {
    toggleOff()
  }

  // Update call store
  callStore.setCameraEnabled(newValue)

  // Emit toggle event
  emit("toggle-camera", newValue)
}
</script>

<style scoped>
.control-button {
  @apply flex items-center justify-center transition-colors duration-200;
}
</style>
