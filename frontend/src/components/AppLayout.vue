<template>
  <div class="app-layout h-screen bg-gray-900 text-white flex flex-col lg:flex-row overflow-hidden">
    <div class="flex flex-1 overflow-hidden">
      <!-- Left Sidebar - Room List (Desktop) -->
      <RoomSidebar 
        class="hidden lg:flex"
        :rooms="rooms" 
        :categories="categories"
        :active-room-id="activeRoomId"
        :is-mobile-view="false"
        @room-selected="handleRoomSelected"
        @create-room="showCreateRoomModal"
        @create-room-in-category="handleCreateRoomInCategory"
        @rename-category="handleRenameCategory"
        @delete-category="handleDeleteCategory"
      />

      <!-- Mobile: Full-screen Room List View -->
      <div 
        v-if="isMobile && mobileView === 'rooms'" 
        class="lg:hidden flex-1 flex flex-col bg-gray-900"
      >
        <!-- Mobile Header -->
        <div class="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
          <h1 class="text-lg font-semibold">The Orbital</h1>
        </div>
        
        <!-- Mobile Room List Content -->
        <RoomSidebar
          :rooms="rooms"
          :categories="categories"
          :active-room-id="activeRoomId"
          :is-mobile-view="true"
          class="flex-1"
          @room-selected="handleRoomSelectedMobile"
          @create-room="showCreateRoomModal"
          @create-room-in-category="handleCreateRoomInCategory"
          @rename-category="handleRenameCategory"
          @delete-category="handleDeleteCategory"
        />
      </div>

      <!-- Main Content Area (Desktop: always visible, Mobile: only when in room) -->
      <main 
        v-if="!isMobile || mobileView === 'room'"
        class="flex-1 flex flex-col min-h-0 bg-gray-900"
      >
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
          :remote-stream-volumes="remoteStreamVolumes"
          :is-mobile="isMobile"
          @leave-room="handleLeaveRoom"
          @volume-change="handleVolumeChange"
          @nickname-change="handleNicknameChange"
          @show-room-list="mobileView = 'rooms'"
          @toggle-user-sidebar="toggleMobileUserSidebar"
        />
      </main>

      <!-- Right Sidebar - User List (Desktop) -->
      <UserSidebar 
        v-if="activeRoomId && !isMobile"
        class="hidden lg:flex"
        :users="currentRoomUsers"
        :user-count="currentRoomUsers.length"
        :initial-volumes="remoteStreamVolumes"
        @volume-change="handleVolumeChange"
        @nickname-change="handleNicknameChange"
      />

      <!-- Mobile: User Sidebar Overlay -->
      <div 
        v-if="isMobile && mobileUserSidebarOpen && activeRoomId"
        class="fixed inset-0 bg-black bg-opacity-50 z-30"
        @click="mobileUserSidebarOpen = false"
      ></div>
      <UserSidebar
        v-if="isMobile && activeRoomId"
        :is-open="mobileUserSidebarOpen"
        class="fixed right-0 top-0 h-full w-60 bg-gray-800 z-40"
        :users="currentRoomUsers"
        :user-count="currentRoomUsers.length"
        :initial-volumes="remoteStreamVolumes"
        @close-mobile-sidebar="mobileUserSidebarOpen = false"
        @volume-change="handleVolumeChange"
        @nickname-change="handleNicknameChange"
      />
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
  :initial-category="createRoomCategoryName"
  @close="showModal = false; createRoomCategoryName = ''"
  @create="handleCreateRoom"
/>

<!-- Category Modal (Create/Rename) -->
<CategoryModal
  v-if="showCategoryModal"
  :title="categoryModalTitle"
  :submit-button-text="categoryModalSubmitText"
  :initial-name="categoryModalInitialName"
  @close="showCategoryModal = false"
  @submit="handleCategoryModalSubmit"
/>

<!-- Confirm Delete Category Modal -->
<ConfirmDeleteCategoryModal
  v-if="showDeleteCategoryModal"
  :category-id="selectedCategoryId"
  :category-name="selectedCategoryName"
  :room-count="selectedCategoryRoomCount"
  :categories="categories"
  :general-category-id="getGeneralCategoryId()"
  @close="showDeleteCategoryModal = false"
  @confirm="handleDeleteCategoryConfirm"
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
import CategoryModal from '@/components/CategoryModal.vue'
import ConfirmDeleteCategoryModal from '@/components/ConfirmDeleteCategoryModal.vue'
import type { Room, User, WebSocketMessage, Category } from '@/types'
import { apiService, generateUserId, generateNickname } from '@/services/api'
import { wsService } from '@/services/websocket'

// State
const activeRoomId = ref<string | null>(null)
const showModal = ref(false)
const mobileSidebarOpen = ref(false)
const mobileUserSidebarOpen = ref(false)
const currentUser = ref<{ id: string; nickname: string } | null>(null)
const mobileView = ref<'rooms' | 'room'>('rooms')
const isMobile = ref(false)

// Real data from backend
const rooms = ref<Room[]>([])
const currentRoomUsers = ref<User[]>([])
const remoteStreamVolumes = ref<Map<string, number>>(new Map())
const isLoading = ref(false)
const errorMessage = ref('')

// Category management
const categories = ref<Category[]>([])
const showCategoryModal = ref(false)
const showDeleteCategoryModal = ref(false)
const categoryModalTitle = ref('Create Category')
const categoryModalSubmitText = ref('Create')
const categoryModalInitialName = ref('')
const selectedCategoryId = ref('')
const selectedCategoryName = ref('')
const selectedCategoryRoomCount = ref(0)
const createRoomCategoryName = ref('')

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

const updateRoomUserStatus = (userId: string, status: { isSpeaking?: boolean; isMuted?: boolean; isDeafened?: boolean }) => {
  rooms.value.forEach((room, roomIndex) => {
    if (room.users) {
      const userIndex = room.users.findIndex(u => u.id === userId)
      if (userIndex !== -1) {
        const user = room.users[userIndex]
        
        // Create new user object with updated status to trigger Vue reactivity
        const updatedUser = { ...user }
        if (status.isSpeaking !== undefined) updatedUser.isSpeaking = status.isSpeaking
        if (status.isMuted !== undefined) updatedUser.isMuted = status.isMuted
        if (status.isDeafened !== undefined) updatedUser.isDeafened = status.isDeafened
        
        // Replace the user in the array to trigger Vue reactivity
        rooms.value[roomIndex].users[userIndex] = updatedUser
      }
    }
  })
}

const updateRoomNickname = (userId: string, nickname: string) => {
  rooms.value.forEach((room, roomIndex) => {
    if (room.users) {
      const userIndex = room.users.findIndex(u => u.id === userId)
      if (userIndex !== -1) {
        const user = room.users[userIndex]
        
        // Create new user object with updated nickname to trigger Vue reactivity
        const updatedUser = { ...user, nickname }
        
        // Replace the user in the array to trigger Vue reactivity
        rooms.value[roomIndex].users[userIndex] = updatedUser
      }
    }
  })
}

// Lifecycle hooks
onMounted(async () => {
  await loadRooms()
  await loadCategories()
  setupWebSocketListeners()
  setupGlobalWebSocketListeners()
  await connectGlobalWebSocket()
  
  // Check if mobile on mount
  checkMobile()
  // Listen for resize events
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
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
    rooms.value = await apiService.getRooms(true) // Include preview data
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
    // On mobile, return to room list view
    if (isMobile.value) {
      mobileView.value = 'rooms'
    }
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

const handleCreateRoom = async (roomName: string, category: string, maxUsers: number) => {
  try {
    isLoading.value = true
    errorMessage.value = ''
    
    const newRoom = await apiService.createRoom({
      name: roomName,
      category: category,
      maxUsers: maxUsers
    })

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
  createRoomCategoryName.value = ''
  errorMessage.value = ''
}

// Category Management Methods
const getGeneralCategoryId = (): string => {
  const generalCat = categories.value.find(c => c.name === 'general')
  return generalCat?.id || ''
}

const handleCreateRoomInCategory = (categoryId: string, categoryName: string) => {
  createRoomCategoryName.value = categoryName
  showModal.value = true
  errorMessage.value = ''
}

const handleRenameCategory = (categoryId: string, currentName: string) => {
  selectedCategoryId.value = categoryId
  categoryModalTitle.value = 'Rename Category'
  categoryModalSubmitText.value = 'Rename'
  categoryModalInitialName.value = currentName
  showCategoryModal.value = true
  errorMessage.value = ''
}

const handleDeleteCategory = (categoryId: string, categoryName: string) => {
  // Count rooms in this category
  const roomCount = rooms.value.filter(r => {
    const cat = categories.value.find(c => c.id === categoryId)
    return cat && r.category === cat.name
  }).length
  
  selectedCategoryId.value = categoryId
  selectedCategoryName.value = categoryName
  selectedCategoryRoomCount.value = roomCount
  showDeleteCategoryModal.value = true
  errorMessage.value = ''
}

const handleCategoryModalSubmit = async (name: string) => {
  try {
    isLoading.value = true
    errorMessage.value = ''
    
    if (categoryModalTitle.value === 'Create Category') {
      await apiService.createCategory({ name })
      console.log('Created category:', name)
    } else {
      await apiService.renameCategory(selectedCategoryId.value, { name })
      console.log('Renamed category:', selectedCategoryId.value, 'to', name)
    }
    
    showCategoryModal.value = false
    categoryModalInitialName.value = ''
  } catch (error) {
    console.error('Failed to save category:', error)
    errorMessage.value = 'Failed to save category. Please try again.'
  } finally {
    isLoading.value = false
  }
}

const handleDeleteCategoryConfirm = async (deleteRooms: boolean, targetCategoryId?: string) => {
  try {
    isLoading.value = true
    errorMessage.value = ''
    
    await apiService.deleteCategory(selectedCategoryId.value, {
      deleteRooms,
      targetCategoryId
    })
    
    console.log('Deleted category:', selectedCategoryId.value)
    showDeleteCategoryModal.value = false
  } catch (error) {
    console.error('Failed to delete category:', error)
    errorMessage.value = 'Failed to delete category. Please try again.'
  } finally {
    isLoading.value = false
  }
}

const loadCategories = async () => {
  try {
    categories.value = await apiService.getCategories()
    console.log('Loaded categories:', categories.value)
  } catch (error) {
    console.error('Failed to load categories:', error)
  }
}

const checkMobile = () => {
  isMobile.value = window.innerWidth < 1024 // lg breakpoint
}

const handleRoomSelectedMobile = async (roomId: string) => {
  // On mobile, switch to room view when a room is selected
  await handleRoomSelected(roomId)
  mobileView.value = 'room'
}

const toggleMobileUserSidebar = () => {
  mobileUserSidebarOpen.value = !mobileUserSidebarOpen.value
  mobileSidebarOpen.value = false
}

const handleVolumeChange = (userId: string, volume: number) => {
  console.log(`🔊 Volume changed for user ${userId}: ${volume}`)
  remoteStreamVolumes.value.set(userId, volume)
}

const handleNicknameChange = (userId: string, nickname: string) => {
  console.log(`👤 Nickname changed for user ${userId}: ${nickname}`)
  
  // Send nickname change via WebSocket
  wsService.changeNickname(userId, nickname)
  
  // Update current user reference if it's the current user
  if (currentUser.value && currentUser.value.id === userId) {
    currentUser.value.nickname = nickname
  }
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
    // Update room list preview to reflect status changes
    updateRoomUserStatus(statusData.user_id, {
      isSpeaking: statusData.is_speaking,
      isMuted: statusData.is_muted
    })
  })

  // Listen for mute status updates
  wsService.on('mute_status', (message: WebSocketMessage) => {
    const statusData = message.data as { user_id: string; is_muted: boolean }
    const user = currentRoomUsers.value.find(u => u.id === statusData.user_id)
    if (user) {
      user.isMuted = statusData.is_muted
    }
    // Update room list preview to reflect status changes
    updateRoomUserStatus(statusData.user_id, { isMuted: statusData.is_muted })
  })

  // Listen for deafen status updates
  wsService.on('deafen_status', (message: WebSocketMessage) => {
    const statusData = message.data as { user_id: string; is_deafened: boolean }
    const user = currentRoomUsers.value.find(u => u.id === statusData.user_id)
    if (user) {
      user.isDeafened = statusData.is_deafened
    }
    // Update room list preview to reflect status changes
    updateRoomUserStatus(statusData.user_id, { isDeafened: statusData.is_deafened })
  })

  // Listen for nickname change updates
  wsService.on('nickname_change', (message: WebSocketMessage) => {
    const nicknameData = message.data as { user_id: string; nickname: string }
    const user = currentRoomUsers.value.find(u => u.id === nicknameData.user_id)
    if (user) {
      user.nickname = nicknameData.nickname
    }
    // Update room list preview to reflect nickname changes
    updateRoomNickname(nicknameData.user_id, nicknameData.nickname)
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

  // Listen for global status updates (for room list sidebar)
  wsService.onGlobal('speaking_status', (message: WebSocketMessage) => {
    const statusData = message.data as { user_id: string; is_speaking: boolean; is_muted?: boolean }
    updateRoomUserStatus(statusData.user_id, {
      isSpeaking: statusData.is_speaking,
      isMuted: statusData.is_muted
    })
  })

  wsService.onGlobal('mute_status', (message: WebSocketMessage) => {
    const statusData = message.data as { user_id: string; is_muted: boolean }
    updateRoomUserStatus(statusData.user_id, { isMuted: statusData.is_muted })
  })

  wsService.onGlobal('deafen_status', (message: WebSocketMessage) => {
    const statusData = message.data as { user_id: string; is_deafened: boolean }
    updateRoomUserStatus(statusData.user_id, { isDeafened: statusData.is_deafened })
  })

  // Listen for global nickname change updates
  wsService.onGlobal('nickname_change', (message: WebSocketMessage) => {
    const nicknameData = message.data as { user_id: string; nickname: string }
    updateRoomNickname(nicknameData.user_id, nicknameData.nickname)
  })

  // Listen for room user joined events
  wsService.onGlobal('room_user_joined', (message: WebSocketMessage) => {
    const data = message.data as { room_id: string; user: { id: string; nickname: string; role: string } }
    console.log('Received room_user_joined event:', data)
    
    // Update the specific room with the new user
    const room = rooms.value.find(r => r.id === data.room_id)
    if (room) {
      if (!room.users) {
        room.users = []
      }
      
      // Check if user already exists in room
      const existingUserIndex = room.users.findIndex(u => u.id === data.user.id)
      if (existingUserIndex === -1) {
        room.users.push(data.user)
        room.userCount = room.users.length
        console.log(`User ${data.user.nickname} joined room ${room.name}`)
      }
    }
  })

  // Listen for room user left events
  wsService.onGlobal('room_user_left', (message: WebSocketMessage) => {
    const data = message.data as { room_id: string; user: { id: string; nickname: string; role: string } }
    console.log('Received room_user_left event:', data)
    
    // Update the specific room by removing the user
    const room = rooms.value.find(r => r.id === data.room_id)
    if (room && room.users) {
      const userIndex = room.users.findIndex(u => u.id === data.user.id)
      if (userIndex !== -1) {
        room.users.splice(userIndex, 1)
        room.userCount = room.users.length
        console.log(`User ${data.user.nickname} left room ${room.name}`)
      }
    }
  })

  // Listen for category events
  wsService.onGlobal('category_created', (message: WebSocketMessage) => {
    const newCategory = message.data as Category
    console.log('Received category_created event:', newCategory)
    
    // Add new category if not already exists
    const existingIndex = categories.value.findIndex(c => c.id === newCategory.id)
    if (existingIndex === -1) {
      categories.value.push(newCategory)
      console.log('Added new category:', newCategory.name)
    }
  })

  wsService.onGlobal('category_renamed', (message: WebSocketMessage) => {
    const updatedCategory = message.data as Category
    console.log('Received category_renamed event:', updatedCategory)
    
    // Update category name
    const index = categories.value.findIndex(c => c.id === updatedCategory.id)
    if (index !== -1) {
      const oldName = categories.value[index].name
      categories.value[index].name = updatedCategory.name
      
      // Update all rooms that use this category name
      rooms.value.forEach(room => {
        if (room.category === oldName) {
          room.category = updatedCategory.name
        }
      })
      
      console.log('Renamed category from', oldName, 'to', updatedCategory.name)
    }
  })

  wsService.onGlobal('category_deleted', (message: WebSocketMessage) => {
    const data = message.data as { 
      category_id: string
      deleted_rooms: boolean
      migrated_rooms: string[]
      target_category_id: string 
    }
    console.log('Received category_deleted event:', data)
    
    // Remove category from list
    const index = categories.value.findIndex(c => c.id === data.category_id)
    if (index !== -1) {
      const deletedCategory = categories.value[index]
      categories.value.splice(index, 1)
      
      if (data.deleted_rooms) {
        // Remove all rooms that were in this category
        rooms.value = rooms.value.filter(r => r.category !== deletedCategory.name)
        console.log('Deleted category and all its rooms:', deletedCategory.name)
      } else if (data.target_category_id) {
        // Update rooms to new category
        const targetCategory = categories.value.find(c => c.id === data.target_category_id)
        if (targetCategory) {
          rooms.value.forEach(room => {
            if (room.category === deletedCategory.name) {
              room.category = targetCategory.name
            }
          })
          console.log('Migrated rooms from', deletedCategory.name, 'to', targetCategory.name)
        }
      }
    }
  })

  wsService.onGlobal('room_updated', (message: WebSocketMessage) => {
    const updatedRoom = message.data as Room
    console.log('Received room_updated event:', updatedRoom)
    
    // Update room in list
    const index = rooms.value.findIndex(r => r.id === updatedRoom.id)
    if (index !== -1) {
      rooms.value[index] = { ...rooms.value[index], ...updatedRoom }
      console.log('Updated room:', updatedRoom.name)
    }
  })

  wsService.onGlobal('room_deleted', (message: WebSocketMessage) => {
    const data = message.data as { room_id: string }
    console.log('Received room_deleted event:', data)
    
    // Remove room from list
    const index = rooms.value.findIndex(r => r.id === data.room_id)
    if (index !== -1) {
      const roomName = rooms.value[index].name
      rooms.value.splice(index, 1)
      console.log('Deleted room:', roomName)
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