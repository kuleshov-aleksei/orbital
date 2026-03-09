<template>
  <div
    class="screen-stream relative bg-gray-900 rounded-lg overflow-hidden border border-gray-600 flex flex-col"
    :class="{ 'border-indigo-500 ring-2 ring-indigo-500/50': isFocused }"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave">
    <!-- Video Container - placeholder background -->
    <div class="relative flex items-center justify-center bg-black w-full h-full min-h-52">
      <!-- Placeholder background pattern -->
      <div class="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900" />

      <!-- User Info Overlay -->
      <div
        class="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent px-4 py-3 z-10">
        <div class="flex items-center justify-between">
          <div class="flex items-center">
            <div
              class="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-sm font-bold text-white mr-2">
              {{ userNickname.charAt(0).toUpperCase() }}
            </div>

            <div>
              <div class="text-white font-medium text-sm">
                {{ userNickname }}
              </div>

              <div class="text-xs text-gray-300 flex items-center">
                <PhMonitor class="w-3 h-3 mr-1" />
                Screen Share Available
              </div>
            </div>
          </div>

          <!-- Pending indicator -->
          <div class="flex items-center text-xs">
            <div class="w-2 h-2 rounded-full mr-1 bg-yellow-400" />

            <span class="text-gray-300">Waiting</span>
          </div>
        </div>
      </div>

      <!-- Center View Button -->
      <div class="flex flex-col items-center justify-center z-10">
        <button
          type="button"
          class="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-base font-medium flex items-center transition-colors shadow-lg"
          @click="$emit('subscribe')">
          <PhPlay class="w-5 h-5 mr-2" />
          View Screen Share
        </button>

        <p class="text-gray-400 text-sm mt-3">Click to start watching</p>
      </div>

      <!-- Controls Overlay (minimal) -->
      <div
        class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3 opacity-0 hover:opacity-100 transition-opacity duration-200">
        <div class="flex items-center justify-center">
          <div v-if="!isFocused && showFocusButton" class="absolute left-4">
            <button
              type="button"
              class="px-3 py-1.5 bg-gray-700/80 hover:bg-gray-600 rounded-lg text-white text-sm flex items-center transition-colors"
              @click="$emit('make-focused')">
              <PhArrowsOut class="w-4 h-4 mr-1" />
              Focus
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { PhMonitor, PhPlay, PhArrowsOut } from "@phosphor-icons/vue"

interface Props {
  userId: string
  userNickname: string
  quality?: string
  isFocused?: boolean
  showFocusButton?: boolean
}

withDefaults(defineProps<Props>(), {
  quality: "adaptive",
  isFocused: false,
  showFocusButton: false,
})

defineEmits<{
  subscribe: []
  "make-focused": []
}>()

const isHovered = ref(false)

const handleMouseEnter = () => {
  isHovered.value = true
}

const handleMouseLeave = () => {
  isHovered.value = false
}
</script>
