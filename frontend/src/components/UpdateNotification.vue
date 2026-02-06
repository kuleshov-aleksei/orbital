<template>
  <div
    v-if="visible"
    class="fixed top-0 left-0 right-0 flex justify-center z-50 pointer-events-none pt-4"
  >
    <div class="bg-indigo-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-4 pointer-events-auto animate-slide-down"
    >
      <PhArrowClockwise class="w-5 h-5 flex-shrink-0" />
      
      <span class="font-medium">
        Update available
      </span>
      
      <button
        type="button"
        class="bg-white text-indigo-600 px-4 py-1.5 rounded-lg font-semibold text-sm hover:bg-gray-100 transition-colors duration-200 flex items-center gap-2"
        @click="reload"
      >
        <PhArrowsClockwise class="w-4 h-4" />
        Reload
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PhArrowClockwise, PhArrowsClockwise } from '@phosphor-icons/vue'

interface Props {
  visible: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  reload: []
}>()

function reload() {
  emit('reload')
}
</script>

<style scoped>
@keyframes slide-down {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-slide-down {
  animation: slide-down 0.3s ease-out;
}
</style>
