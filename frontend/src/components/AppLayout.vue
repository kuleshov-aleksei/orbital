<template>
  <div class="app-layout h-screen bg-gray-900 text-white flex flex-col lg:flex-row overflow-hidden">
    <!-- Mobile Menu Toggle -->
    <div class="lg:hidden flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
      <button
        class="p-2 text-gray-400 hover:text-white"
        @click="toggleMobileSidebar"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <h1 class="text-lg font-semibold">The Orbital</h1>
      <div class="w-10"></div>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <!-- Left Sidebar - Room List -->
      <RoomSidebar 
        :rooms="rooms" 
        :active-room-id="activeRoomId"
        :class="{ 'hidden lg:flex': !mobileSidebarOpen, 'flex': mobileSidebarOpen }"
        @room-selected="handleRoomSelected"
        @create-room="showCreateRoomModal"
        @close-mobile-sidebar="mobileSidebarOpen = false"
      />

      <!-- Main Content Area -->
      <main class="flex-1 flex flex-col min-h-0 bg-gray-900">
        <WelcomeView 
          v-if="!activeRoomId"
          :rooms="rooms"
          @room-selected="handleRoomSelected"
          @create-room="showCreateRoomModal"
        />
        <VoiceCallView 
          v-else
          :room-id="activeRoomId"
          :room-name="getRoomName(activeRoomId)"
          :users="currentRoomUsers"
          @leave-room="handleLeaveRoom"
        />
      </main>

      <!-- Right Sidebar - User List -->
      <UserSidebar 
        v-if="activeRoomId"
        :class="{ 'hidden lg:flex': !mobileUserSidebarOpen, 'flex': mobileUserSidebarOpen }"
        :users="currentRoomUsers"
        :user-count="currentRoomUsers.length"
        @close-mobile-sidebar="mobileUserSidebarOpen = false"
      />
    </div>

    <!-- Mobile User Toggle (when in call) -->
    <div v-if="activeRoomId" class="lg:hidden flex items-center justify-center p-3 bg-gray-800 border-t border-gray-700">
      <button
        class="flex items-center px-4 py-2 bg-gray-700 rounded-lg"
        @click="toggleMobileUserSidebar"
      >
        <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
        </svg>
        <span class="text-sm">{{ currentRoomUsers.length }} Users</span>
      </button>
    </div>

    <!-- Error Message -->
<div 
  v-if="errorMessage" 
  class="fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-4 py-2 rounded-lg z-50 max-w-md text-center"
>
  {{ errorMessage }}
</div>

<!-- Loading Overlay -->
<div 
  v-if="isLoading" 
  class="fixed inset-0 bg-black bg-opacity-50 z-40 flex items-center justify-center"
>
  <div class="bg-gray-800 rounded-lg p-6 flex items-center space-x-3">
    <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-t-2 border-white"></div>
    <span class="text-white">Loading...</span>
  </div>
</div>

<!-- Mobile Overlay -->
<div 
  v-if="mobileSidebarOpen || mobileUserSidebarOpen"
  class="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
  @click="mobileSidebarOpen = false; mobileUserSidebarOpen = false"
></div>

<!-- Create Room Modal -->
<RoomModal 
  v-if="showModal"
  @close="showModal = false"
  @create="handleCreateRoom"
/>
</div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import RoomSidebar from '@/components/RoomSidebar.vue'
import UserSidebar from '@/components/UserSidebar.vue'
import WelcomeView from '@/views/WelcomeView.vue'
import VoiceCallView from '@/views/VoiceCallView.vue'
import RoomModal from '@/components/RoomModal.vue'
import type { Room, User, WebSocketMessage } from '@/types'
import { apiService, generateUserId, generateNickname } from '@/services/api'
import { wsService } from '@/services/websocket'

// State
const activeRoomId = ref<string | null>(null)
const showModal = ref(false)
const mobileSidebarOpen = ref(false)
const mobileUserSidebarOpen = ref(false)
const currentUser = ref<{ id: string; nickname: string } | null>(null)

// Real data from backend
const rooms = ref<Room[]>([])
const currentRoomUsers = ref<User[]>([])
const isLoading = ref(false)
const errorMessage = ref('')

// Generate or get current user ID
const getCurrentUserId = (): string => {
  if (!currentUser.value) {
    const userId = localStorage.getItem('orbital_user_id') || generateUserId()
    const nickname = localStorage.getItem('orbital_user_nickname') || generateNickname(userId)
    currentUser.value = { id: userId, nickname }
    localStorage.setItem('orbital_user_id', userId)
    localStorage.setItem('orbital_user_nickname', nickname)
  }
  return currentUser.value!.id
}

const getRoomName = (roomId: string): string => {
  const room = rooms.value.find(r => r.id === roomId)
  return room?.name || 'Voice Room'
}

// Lifecycle hooks
onMounted(async () => {
  await loadRooms()
  setupWebSocketListeners()
  setupGlobalWebSocketListeners()
  await connectGlobalWebSocket()
})

onUnmounted(() => {
  if (activeRoomId.value) {
    leaveRoom()
  }
  wsService.disconnect()
  wsService.disconnectGlobal()
})

// Methods
const loadRooms = async () => {
  try {
    isLoading.value = true
    errorMessage.value = ''
    rooms.value = await apiService.getRooms()
    console.log('Loaded rooms:', rooms.value)
  } catch (error) {
    console.error('Failed to load rooms:', error)
    errorMessage.value = 'Failed to load rooms. Please refresh the page.'
  } finally {
    isLoading.value = false
  }
}

const handleRoomSelected = async (roomId: string) => {
  try {
    isLoading.value = true
    errorMessage.value = ''
    
    const userId = getCurrentUserId()
    
    // If already in a room, leave it first
    if (activeRoomId.value) {
      await leaveCurrentRoom()
    }
    
    await joinRoom(roomId, userId)
  } catch (error) {
    console.error('Failed to switch room:', error)
    errorMessage.value = 'Failed to switch room. Please try again.'
  } finally {
    isLoading.value = false
  }
}

const leaveCurrentRoom = async () => {
  if (!activeRoomId.value || !currentUser.value) {
    return
  }
  
  try {
    await apiService.leaveRoom(activeRoomId.value, currentUser.value.id)
    wsService.sendMessage('leave_room', { user_id: currentUser.value.id })
    wsService.disconnect()
    
    // Clear current users but don't clear activeRoomId yet
    currentRoomUsers.value = []
  } catch (error) {
    console.error('Failed to leave current room:', error)
    throw error // Re-throw so handleRoomSelected can handle it
  }
}

const handleLeaveRoom = async () => {
  try {
    await leaveCurrentRoom()
    activeRoomId.value = null
    currentRoomUsers.value = []
  } catch (error) {
    console.error('Failed to leave room:', error)
    errorMessage.value = 'Failed to leave room.'
  }
}

const joinRoom = async (roomId: string, userId: string) => {
  // Disconnect existing WebSocket connection if any
  wsService.disconnect()
  
  await apiService.joinRoom(roomId, {
    user_id: userId,
    nickname: currentUser.value?.nickname || generateNickname(userId)
  })

  // Connect to WebSocket for new room
  await wsService.connect(roomId, userId)
  activeRoomId.value = roomId

  // WebSocket will update currentRoomUsers when connected
}

const handleCreateRoom = async (roomName: string) => {
  try {
    isLoading.value = true
    errorMessage.value = ''
    
    const newRoom = await apiService.createRoom({
      name: roomName,
      category: 'General',
      maxUsers: 10
    })

    // Add to local rooms list for immediate UI update
    rooms.value.unshift(newRoom)

    // Join the newly created room
    await handleRoomSelected(newRoom.id)
    
    console.log('Created room:', newRoom)
  } catch (error) {
    console.error('Failed to create room:', error)
    errorMessage.value = 'Failed to create room. Please try again.'
  } finally {
    isLoading.value = false
    showModal.value = false
  }
}

const showCreateRoomModal = () => {
  showModal.value = true
  errorMessage.value = ''
}

const toggleMobileSidebar = () => {
  mobileSidebarOpen.value = !mobileSidebarOpen.value
  mobileUserSidebarOpen.value = false
}

const toggleMobileUserSidebar = () => {
  mobileUserSidebarOpen.value = !mobileUserSidebarOpen.value
  mobileSidebarOpen.value = false
}

const setupWebSocketListeners = () => {
  // Listen for room users updates (handles both join and leave events)
  wsService.on('room_users', (message: WebSocketMessage) => {
    currentRoomUsers.value = message.data as User[]
    console.log('Updated room users:', currentRoomUsers.value)
  })

  // Listen for speaking status updates
  wsService.on('speaking_status', (message: WebSocketMessage) => {
    const statusData = message.data as { user_id: string; is_speaking: boolean; is_muted?: boolean }
    const user = currentRoomUsers.value.find(u => u.id === statusData.user_id)
    if (user) {
      user.isSpeaking = statusData.is_speaking
      if (statusData.is_muted !== undefined) {
        user.isMuted = statusData.is_muted
      }
    }
  })

  // Listen for connection/disconnection
  wsService.onConnection(() => {
    console.log('WebSocket connected')
    errorMessage.value = ''
  })

  wsService.onDisconnection((event) => {
    console.log('WebSocket disconnected:', event)
    if (!event.wasClean) {
      errorMessage.value = 'Connection lost. Attempting to reconnect...'
    }
  })
}

const setupGlobalWebSocketListeners = () => {
  // Listen for room creation events
  wsService.onGlobal('room_created', (message: WebSocketMessage) => {
    const newRoom = message.data as Room
    console.log('Received room_created event:', newRoom)
    
    // Update rooms list to include the new room
    const existingIndex = rooms.value.findIndex(r => r.id === newRoom.id)
    if (existingIndex === -1) {
      // Add new room at the beginning of the list
      rooms.value.unshift(newRoom)
      console.log('Added new room to list:', newRoom.name)
    }
  })

  // Listen for global connection/disconnection
  wsService.onGlobalConnection(() => {
    console.log('Global WebSocket connected')
  })

  wsService.onGlobalDisconnection((event) => {
    console.log('Global WebSocket disconnected:', event)
  })
}

const connectGlobalWebSocket = async () => {
  try {
    await wsService.connectGlobal()
    console.log('Global WebSocket connected successfully')
  } catch (error) {
    console.error('Failed to connect global WebSocket:', error)
  }
}
</script>

<style scoped>
.app-layout {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
}
</style>