<template>
  <div
    class="welcome-view flex-1 flex flex-col p-4 lg:p-8 overflow-y-auto"
    data-testid="welcome-view">
    <!-- Room Browser -->
    <div class="w-full max-w-4xl flex-1">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-2xl font-semibold text-theme-text-primary">Available Rooms</h2>
      </div>

      <!-- Room Grid -->
      <div v-if="rooms?.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="room in rooms"
          :key="room.id"
          :data-testid="`room-card-${room.id}`"
          class="room-browser-card bg-theme-bg-secondary rounded-lg p-4 hover:bg-theme-bg-hover transition-all duration-200 cursor-pointer border border-theme-border hover:border-theme-accent"
          @click="handleRoomClick(room.id)">
          <div class="flex items-center justify-between mb-3">
            <div class="w-10 h-10 bg-theme-accent rounded-full flex items-center justify-center">
              <PhFolderSimpleUser class="w-5 h-5 text-theme-text-on-accent" />
            </div>

            <div class="text-right">
              <div class="text-xs text-theme-text-muted">
                {{ room.category_name || room.category }}
              </div>
            </div>
          </div>

          <h3 class="text-base font-semibold text-theme-text-primary mb-2">
            {{ room.name }}
          </h3>

          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center text-theme-text-muted text-xs">
              <PhFolderSimpleUser class="w-3 h-3 mr-1" />
              {{ room.user_count }}/{{ room.max_users }}
            </div>

            <button
              type="button"
              class="text-theme-accent hover:text-theme-accent-hover font-medium text-sm">
              Join →
            </button>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="flex flex-col items-center justify-center py-16 px-4">
        <div
          class="w-20 h-20 bg-theme-bg-secondary rounded-full flex items-center justify-center mb-6">
          <PhMicrophone class="w-10 h-10 text-theme-text-muted" />
        </div>

        <h3 class="text-xl font-semibold text-theme-text-primary mb-2">No rooms yet</h3>

        <p class="text-theme-text-muted text-center max-w-sm mb-8">
          Create a room to start chatting with your squad. Voice chat for 5-10 people made simple.
        </p>

        <button
          v-if="isAdmin"
          type="button"
          data-testid="create-room-empty"
          class="px-6 py-3 bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent rounded-lg transition-colors duration-200 font-medium"
          @click="$emit('create-room')">
          Create First Room
        </button>

        <p v-else class="text-theme-text-muted text-sm">Ask an admin to create a room</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia"
import { useRoomStore, useUserStore } from "@/stores"
import { useAprilCaptcha } from "@/composables/useAprilCaptcha"
import { PhMicrophone, PhFolderSimpleUser } from "@phosphor-icons/vue"

const emit = defineEmits<{
  "room-selected": [roomId: string]
  "create-room": []
}>()
// Use store directly for reactivity
const roomStore = useRoomStore()
const userStore = useUserStore()
const { rooms } = storeToRefs(roomStore)
const { isAdmin } = storeToRefs(userStore)
const { showForAction } = useAprilCaptcha()

const handleRoomClick = (roomId: string) => {
  showForAction("join", () => {
    emit("room-selected", roomId)
  })
}
</script>
