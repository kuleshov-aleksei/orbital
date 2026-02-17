<template>
  <header class="bg-gray-800 px-6 py-4 border-b border-gray-700">
    <div class="flex items-center justify-between">
      <div class="flex items-center">
        <!-- Back to room list button (mobile only, doesn't leave room) -->
        <button
          v-if="isMobile"
          type="button"
          data-testid="back-to-rooms"
          class="mr-4 text-gray-400 hover:text-white transition-colors duration-200"
          title="Back to room list"
          @click="$emit('show-room-list')">
          <PhArrowLeft class="w-5 h-5" />
        </button>

        <!-- Leave room button (desktop only) -->
        <button
          v-else
          type="button"
          data-testid="leave-room-header"
          class="mr-4 text-gray-400 hover:text-white transition-colors duration-200"
          @click="$emit('leave-room')">
          <PhArrowLeft class="w-5 h-5" />
        </button>

        <div>
          <h1 class="text-xl font-semibold text-white" data-testid="room-title">
            {{ roomName || "Voice Room" }}
          </h1>

          <div class="flex items-center text-sm text-gray-400">
            <span>{{ userCount }} users</span>

            <span v-if="screenShareCount > 0" class="ml-2 text-indigo-400 flex items-center">
              <span class="mx-1.5">•</span>

              <PhMonitorPlay class="w-3.5 h-3.5 mr-1" />
              {{ screenShareCount }} sharing
            </span>

            <span v-if="cameraCount && cameraCount > 0" class="ml-2 text-purple-400 flex items-center">
              <span class="mx-1.5">•</span>

              <PhCamera class="w-3.5 h-3.5 mr-1" />
              {{ cameraCount }} camera
            </span>
          </div>
        </div>
      </div>

      <div class="flex items-center space-x-2">
        <!-- Screen Share Layout Toggle (when sharing active) -->
        <template v-if="screenShareCount > 0">
          <div class="flex bg-gray-700 rounded-lg p-0.5">
            <button
              type="button"
              class="px-2 py-1 rounded-md text-xs transition-colors flex items-center"
              :class="[
                screenShareLayout === 'grid'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white',
              ]"
              @click="$emit('update:screenShareLayout', 'grid')">
              <PhGridFour class="w-3.5 h-3.5 mr-1" />
              Grid
            </button>

            <button
              type="button"
              class="px-2 py-1 rounded-md text-xs transition-colors flex items-center"
              :class="[
                screenShareLayout === 'focus'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white',
              ]"
              @click="$emit('update:screenShareLayout', 'focus')">
              <PhArrowsOut class="w-3.5 h-3.5 mr-1" />
              Focus
            </button>
          </div>

          <!-- Toggle User Grid Visibility -->
          <button
            type="button"
            class="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
            :title="isUserGridVisible ? 'Hide user grid' : 'Show user grid'"
            @click="$emit('update:isUserGridVisible', !isUserGridVisible)">
            <PhEye v-if="isUserGridVisible" class="w-4 h-4" />

            <PhEyeSlash v-else class="w-4 h-4" />
          </button>
        </template>

        <!-- Mobile: Users count button to toggle sidebar -->
        <button
          v-if="isMobile"
          type="button"
          class="flex items-center px-3 py-1.5 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors duration-200"
          @click="$emit('toggle-user-sidebar')">
          <PhUsers class="w-4 h-4 mr-2" />

          <span class="text-sm">{{ userCount }}</span>
        </button>

        <!-- Desktop: Connection Status -->
        <template v-if="!isMobile">
          <div class="flex items-center text-sm">
            <div class="w-2 h-2 bg-green-400 rounded-full mr-2"></div>

            <span class="text-gray-300">Connected</span>
          </div>
        </template>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import {
  PhArrowLeft,
  PhUsers,
  PhMonitorPlay,
  PhCamera,
  PhGridFour,
  PhArrowsOut,
  PhEye,
  PhEyeSlash,
} from "@phosphor-icons/vue"

interface Props {
  roomName: string
  userCount: number
  screenShareCount: number
  cameraCount?: number
  screenShareLayout: "grid" | "focus"
  isUserGridVisible: boolean
  isMobile?: boolean
}

withDefaults(defineProps<Props>(), {
  isMobile: false,
  cameraCount: 0,
})

defineEmits<{
  "leave-room": []
  "show-room-list": []
  "toggle-user-sidebar": []
  "update:screenShareLayout": [value: "grid" | "focus"]
  "update:isUserGridVisible": [value: boolean]
}>()
</script>
