<template>
  <div
    v-if="visible"
    class="fixed top-0 left-0 right-0 flex justify-center z-50 pointer-events-none pt-4">
    <div
      class="bg-red-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-4 pointer-events-auto animate-slide-down max-w-lg">
      <PhWarning class="w-5 h-5 flex-shrink-0" />
      <span class="font-medium text-sm">{{ message }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PhWarning } from "@phosphor-icons/vue"

interface Props {
  visible: boolean
  message: string
}

defineProps<Props>()
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
