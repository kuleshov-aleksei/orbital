<template>
  <button
    type="button"
    class="control-button"
    :class="[
      sizeClasses,
      isDeafened
        ? 'bg-red-600 hover:bg-red-700 text-white'
        : 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white'
    ]"
    :title="isDeafened ? 'Undeafen' : 'Deafen'"
    @click="toggleDeafen"
  >
    <!-- Headphones with slash when deafened -->
    <div v-if="isDeafened" :class="iconWrapperClasses">
      <PhHeadphones :class="iconClasses" />

      <div class="absolute inset-0 flex items-center justify-center">
        <div :class="slashClasses"></div>
      </div>
    </div>
    <!-- Normal headphones when not deafened -->
    <PhHeadphones v-else :class="iconClasses" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PhHeadphones } from '@phosphor-icons/vue'
import { useCallStore, useUserStore, useRoomStore } from '@/stores'

interface Props {
  modelValue: boolean
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md'
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

// Stores
const callStore = useCallStore()
const userStore = useUserStore()
const roomStore = useRoomStore()

// Computed v-model
const isDeafened = computed({
  get: () => props.modelValue,
  set: (value) => {
    emit('update:modelValue', value)
  }
})

// Size classes based on prop
const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'w-8 h-8 rounded-full'
    case 'lg':
      return 'w-12 h-12 rounded-full'
    case 'md':
    default:
      return 'w-10 h-10 rounded-full'
  }
})

// Icon size classes
const iconClasses = computed(() => {
  switch (props.size) {
    case 'sm':
      return 'w-4 h-4'
    case 'lg':
      return 'w-5 h-5'
    case 'md':
    default:
      return 'w-5 h-5'
  }
})

// Wrapper for positioned elements
const iconWrapperClasses = computed(() => {
  return `${iconClasses.value} relative`
})

// Slash line size
const slashClasses = computed(() => {
  const baseClasses = 'bg-current rotate-45'
  switch (props.size) {
    case 'sm':
      return `${baseClasses} w-4 h-0.5`
    case 'lg':
      return `${baseClasses} w-6 h-0.5`
    case 'md':
    default:
      return `${baseClasses} w-5 h-0.5`
  }
})

// Toggle deafen - presence store will sync with LiveKit
const toggleDeafen = () => {
  const newValue = !isDeafened.value
  isDeafened.value = newValue
  
  // Update call store (presence store watches this and syncs with LiveKit)
  callStore.setDeafened(newValue)
  
  // Immediately update room store for local user so UI updates right away
  roomStore.updateUserStatus(userStore.userId, { is_deafened: newValue })
}
</script>

<style scoped>
.control-button {
  @apply flex items-center justify-center transition-colors duration-200;
}
</style>
