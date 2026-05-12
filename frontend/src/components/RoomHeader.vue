<template>
  <header
    class="bg-theme-bg-secondary px-6 py-4 border-b border-theme-border overflow-hidden h-16 max-w-full">
    <div class="flex items-center justify-between">
      <div class="flex items-center">
        <!-- Back to room list button (mobile only, doesn't leave room) -->
        <button
          v-if="isMobile"
          type="button"
          data-testid="back-to-rooms"
          class="mr-4 text-theme-text-muted hover:text-theme-text-primary transition-colors duration-200"
          title="Back to room list"
          @click="$emit('show-room-list')">
          <PhArrowLeft class="w-5 h-5" />
        </button>

        <!-- Leave room button (desktop only) -->
        <button
          v-else
          type="button"
          data-testid="leave-room-header"
          class="mr-4 text-theme-text-muted hover:text-theme-text-primary transition-colors duration-200"
          @click="$emit('leave-room')">
          <PhArrowLeft class="w-5 h-5" />
        </button>

        <div>
          <h1 class="text-xl font-semibold text-theme-text-primary" data-testid="room-title">
            {{ roomName || "Voice Room" }}
          </h1>
        </div>
      </div>

      <div class="flex items-center space-x-2">
        <!-- Screen Share Layout Toggle (when sharing active) -->
        <template v-if="screenShareCount > 0 || cameraCount > 0">
          <div class="flex bg-theme-bg-tertiary rounded-lg p-0.5">
            <button
              type="button"
              class="px-2 py-1 rounded-md text-xs transition-colors flex items-center"
              :class="[
                screenShareLayout === 'grid'
                  ? 'bg-theme-accent text-theme-text-on-accent'
                  : 'text-theme-text-muted hover:text-theme-text-primary',
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
                  ? 'bg-theme-accent text-theme-text-on-accent'
                  : 'text-theme-text-muted hover:text-theme-text-primary',
              ]"
              @click="$emit('update:screenShareLayout', 'focus')">
              <PhArrowsOut class="w-3.5 h-3.5 mr-1" />
              Focus
            </button>
          </div>
        </template>

        <!-- Slot for additional header actions (e.g., chat toggle) -->
        <slot name="actions" />

        <!-- Mobile: Users count button to toggle sidebar -->
        <button
          v-if="isMobile"
          type="button"
          class="flex items-center px-3 py-1.5 bg-theme-bg-tertiary rounded-lg hover:bg-theme-bg-primary transition-colors duration-200"
          @click="$emit('toggle-user-sidebar')">
          <PhUsers class="w-4 h-4 m-1" />
        </button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { PhArrowLeft, PhUsers, PhGridFour, PhArrowsOut } from "@phosphor-icons/vue"

interface Props {
  roomName: string
  screenShareCount: number
  cameraCount?: number
  screenShareLayout: "grid" | "focus"
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
}>()
</script>
