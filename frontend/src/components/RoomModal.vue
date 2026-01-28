<template>
  <div class="modal-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" data-testid="room-modal">
    <div class="modal-content bg-gray-800 rounded-lg p-6 w-full max-w-md">
      <!-- Modal Header -->
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-xl font-semibold text-white">Create New Room</h2>
        <button
          @click="$emit('close')"
          data-testid="room-modal-close"
          class="text-gray-400 hover:text-white transition-colors duration-200"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Form -->
      <form @submit.prevent="handleSubmit">
        <!-- Room Name -->
        <div class="mb-4">
          <label for="roomName" class="block text-sm font-medium text-gray-300 mb-2">
            Room Name
          </label>
          <input
            id="roomName"
            v-model="roomName"
            type="text"
            required
            placeholder="Enter room name"
            data-testid="room-name-input"
            class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <!-- Room Category -->
        <div class="mb-4">
          <label for="roomCategory" class="block text-sm font-medium text-gray-300 mb-2">
            Category
          </label>
          <select
            id="roomCategory"
            v-model="roomCategory"
            class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="Main">Main</option>
            <option value="Gaming">Gaming</option>
            <option value="Study">Study</option>
            <option value="Hobbies">Hobbies</option>
            <option value="Custom">Custom</option>
          </select>
        </div>

        <!-- Max Users -->
        <div class="mb-6">
          <label for="maxUsers" class="block text-sm font-medium text-gray-300 mb-2">
            Max Users
          </label>
          <select
            id="maxUsers"
            v-model="maxUsers"
            class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="5">5 users</option>
            <option value="10">10 users</option>
          </select>
        </div>

        <!-- Room Code Display -->
        <div v-if="generatedRoomCode" class="mb-6 p-4 bg-gray-700 rounded-lg">
          <div class="text-sm text-gray-300 mb-1">Room Code</div>
          <div class="flex items-center justify-between">
            <code class="text-lg font-mono text-indigo-400">{{ generatedRoomCode }}</code>
            <button
              type="button"
              @click="copyRoomCode"
              class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 rounded text-sm transition-colors duration-200"
            >
              Copy
            </button>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex space-x-3">
          <button
            type="button"
            @click="$emit('close')"
            data-testid="room-cancel"
            class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors duration-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="room-create-submit"
            class="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors duration-200"
          >
            Create Room
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const emit = defineEmits<{
  close: []
  create: [roomName: string]
}>()

// Form data
const roomName = ref('')
const roomCategory = ref('Main')
const maxUsers = ref(10)
const generatedRoomCode = ref('')

// Generate room code on mount
onMounted(() => {
  generateRoomCode()
})

const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  generatedRoomCode.value = code
}

const copyRoomCode = async () => {
  try {
    await navigator.clipboard.writeText(generatedRoomCode.value)
    // Could add a toast notification here
    console.log('Room code copied to clipboard')
  } catch (err) {
    console.error('Failed to copy room code:', err)
  }
}

const handleSubmit = () => {
  if (roomName.value.trim()) {
    emit('create', roomName.value.trim())
  }
}
</script>

<style scoped>
.modal-overlay {
  backdrop-filter: blur(4px);
}
</style>
