<template>
  <div class="welcome-view flex-1 flex flex-col p-4 lg:p-8 overflow-y-auto">

    <!-- Room Browser -->
    <div class="w-full max-w-4xl flex-1">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-2xl font-semibold text-white">Available Rooms</h2>
        <button
          @click="$emit('create-room')"
          class="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-200"
        >
          <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          Create Room
        </button>
      </div>

      <!-- Room Grid -->
      <div v-if="rooms.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="room in rooms"
          :key="room.id"
          class="room-browser-card bg-gray-800 rounded-lg p-6 hover:bg-gray-700 transition-all duration-200 cursor-pointer border border-gray-700 hover:border-indigo-500"
          @click="$emit('room-selected', room.id)"
        >
          <div class="flex items-center justify-between mb-4">
            <div class="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center">
              <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
                <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
              </svg>
            </div>
            <div class="text-right">
              <div class="text-sm text-gray-400">{{ room.category }}</div>
            </div>
          </div>
          
          <h3 class="text-lg font-semibold text-white mb-2">{{ room.name }}</h3>
          
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center text-gray-400">
              <svg class="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
              </svg>
              {{ room.userCount }}/{{ room.maxUsers }}
            </div>
            <button class="text-indigo-400 hover:text-indigo-300 font-medium">
              Join →
            </button>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="text-center py-12">
        <div class="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <h3 class="text-xl font-semibold text-white mb-2">No rooms available</h3>
        <p class="text-gray-400 mb-6">Be the first to create a room and start chatting!</p>
        <button
          @click="$emit('create-room')"
          class="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-200"
        >
          Create First Room
        </button>
      </div>
    </div>

    <!-- Join Error -->
    <div v-if="joinError" class="mb-4 p-3 bg-red-600 rounded-lg text-center">
      {{ joinError }}
    </div>

    <!-- Quick Join -->
    <div class="mt-12 text-center">
      <p class="text-gray-400 mb-4">Have a room code?</p>
      <form @submit.prevent="handleQuickJoin" class="flex items-center space-x-3">
        <input
          v-model="roomCode"
          type="text"
          placeholder="Enter room code"
          class="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <button 
          type="submit"
          :disabled="!roomCode.trim() || isJoining || isLoading"
          class="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors duration-200"
        >
          {{ isJoining ? 'Joining...' : 'Join' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Room } from '@/types'
import { apiService } from '@/services/api'

interface Props {
  rooms: Room[]
  isLoading?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'room-selected': [roomId: string]
  'create-room': []
}>()

const roomCode = ref('')
const isJoining = ref(false)
const joinError = ref('')

const handleQuickJoin = async () => {
  if (!roomCode.value.trim()) {
    joinError.value = 'Please enter a room code'
    return
  }

  try {
    isJoining.value = true
    joinError.value = ''

    // Find room by code (room ID)
    const room = props.rooms.find(r => 
      r.id.toLowerCase().includes(roomCode.value.toLowerCase().trim()) ||
      r.name.toLowerCase().includes(roomCode.value.toLowerCase().trim())
    )

    if (!room) {
      joinError.value = 'Room not found'
      return
    }

    // Get room details to ensure it exists
    const roomDetails = await apiService.getRoom(room.id)
    if (roomDetails) {
      emit('room-selected', room.id)
      roomCode.value = ''
    }
  } catch (error) {
    console.error('Failed to join room:', error)
    joinError.value = 'Failed to join room. Please try again.'
  } finally {
    isJoining.value = false
  }
}
</script>