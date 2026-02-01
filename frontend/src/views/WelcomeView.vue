<template>
  <div class="welcome-view flex-1 flex flex-col p-4 lg:p-8 overflow-y-auto" data-testid="welcome-view">

    <!-- Room Browser -->
    <div class="w-full max-w-4xl flex-1">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-2xl font-semibold text-white">Available Rooms</h2>

        <button
          type="button"
          data-testid="create-room-welcome"
          class="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-200"
          @click="$emit('create-room')"
        >
          <PhPlus class="w-4 h-4 mr-2" />
          Create Room
        </button>
      </div>

      <!-- Room Grid -->
      <div v-if="rooms.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="room in rooms"
          :key="room.id"
          :data-testid="`room-card-${room.id}`"
          class="room-browser-card bg-gray-800 rounded-lg p-6 hover:bg-gray-700 transition-all duration-200 cursor-pointer border border-gray-700 hover:border-indigo-500"
          @click="$emit('room-selected', room.id)"
        >
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center">
              <PhFolderSimpleUser class="w-6 h-6 text-white" />
            </div>

            <div class="text-right">
              <div class="text-sm text-gray-400">{{ room.category }}</div>
            </div>
          </div>
          
          <h3 class="text-lg font-semibold text-white mb-2">{{ room.name }}</h3>
          
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center text-gray-400">
              <PhFolderSimpleUser class="w-4 h-4 mr-1" />
              {{ room.userCount }}/{{ room.maxUsers }}
            </div>

            <button type="button" class="text-indigo-400 hover:text-indigo-300 font-medium">
              Join →
            </button>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="text-center py-12">
        <div class="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
          <PhMagnifyingGlass class="w-8 h-8 text-gray-600" />
        </div>

        <h3 class="text-xl font-semibold text-white mb-2">No rooms available</h3>

        <p class="text-gray-400 mb-6">Be the first to create a room and start chatting!</p>

        <button
          type="button"
          data-testid="create-room-empty"
          class="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-200"
          @click="$emit('create-room')"
        >
          Create First Room
        </button>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
 import type { Room } from '@/types'
import { 
    PhPlus, 
    PhFolderSimpleUser, 
    PhMagnifyingGlass 
  } from '@phosphor-icons/vue'

defineProps<{
  rooms: Room[]
  isLoading?: boolean
}>()

defineEmits<{
  'room-selected': [roomId: string]
  'create-room': []
}>()
</script>
