<template>
  <div class="fixed bottom-4 right-4 z-50">
    <button
      v-show="true"
      type="button"
      :class="[
        'px-4 py-2 rounded-lg shadow-lg transition-all duration-200 flex items-center space-x-2',
        'min-w-[120px] relative',
        isVisible 
          ? 'bg-red-600 hover:bg-red-700 text-white' 
          : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
      ]"
      @click.stop="$emit('toggle')"
    >
      <PhBug :class="['w-4 h-4', isVisible && 'animate-pulse']" />

      <span class="text-sm font-medium">{{ isVisible ? 'Close Debug' : 'Debug' }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { PhBug } from '@phosphor-icons/vue'

interface Props {
  isVisible: boolean
}

defineProps<Props>()

defineEmits<{
  toggle: []
}>()
</script>