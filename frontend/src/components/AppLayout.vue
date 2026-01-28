<template>
  <div class="app-layout h-screen bg-gray-900 text-white flex flex-col lg:flex-row overflow-hidden">
    <!-- Mobile Menu Toggle -->
    <div class="lg:hidden flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
      <button
        @click="toggleMobileSidebar"
        class="p-2 text-gray-400 hover:text-white"
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
        :activeRoomId="activeRoomId"
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
          :roomId="activeRoomId"
          :users="currentRoomUsers"
          @leave-room="handleLeaveRoom"
        />
      </main>

      <!-- Right Sidebar - User List -->
      <UserSidebar 
        v-if="activeRoomId"
        :class="{ 'hidden lg:flex': !mobileUserSidebarOpen, 'flex': mobileUserSidebarOpen }"
        :users="currentRoomUsers"
        :userCount="currentRoomUsers.length"
        @close-mobile-sidebar="mobileUserSidebarOpen = false"
      />
    </div>

    <!-- Mobile User Toggle (when in call) -->
    <div v-if="activeRoomId" class="lg:hidden flex items-center justify-center p-3 bg-gray-800 border-t border-gray-700">
      <button
        @click="toggleMobileUserSidebar"
        class="flex items-center px-4 py-2 bg-gray-700 rounded-lg"
      >
        <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
        </svg>
        <span class="text-sm">{{ currentRoomUsers.length }} Users</span>
      </button>
    </div>

<!-- Mobile Overlay -->
<div 
  v-if="mobileSidebarOpen || mobileUserSidebarOpen"
  @click="mobileSidebarOpen = false; mobileUserSidebarOpen = false"
  class="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
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
import { ref, computed } from 'vue'
import RoomSidebar from '@/components/RoomSidebar.vue'
import UserSidebar from '@/components/UserSidebar.vue'
import WelcomeView from '@/views/WelcomeView.vue'
import VoiceCallView from '@/views/VoiceCallView.vue'
import RoomModal from '@/components/RoomModal.vue'

// Types
interface Room {
  id: string
  name: string
  userCount: number
  maxUsers: number
  category: string
}

interface User {
  id: string
  nickname: string
  isSpeaking: boolean
  isMuted: boolean
  isDeafened: boolean
  status: 'online' | 'away' | 'dnd'
}

// State
const activeRoomId = ref<string | null>(null)
const showModal = ref(false)
const mobileSidebarOpen = ref(false)
const mobileUserSidebarOpen = ref(false)

// Mock data - will be replaced with API calls
const rooms = ref<Room[]>([
  { id: '1', name: 'General', userCount: 3, maxUsers: 10, category: 'Main' },
  { id: '2', name: 'Gaming', userCount: 5, maxUsers: 10, category: 'Gaming' },
  { id: '3', name: 'Study Room', userCount: 2, maxUsers: 10, category: 'Study' },
  { id: '4', name: 'Music', userCount: 0, maxUsers: 10, category: 'Hobbies' },
])

const currentRoomUsers = ref<User[]>([
  { id: '1', nickname: 'Alice', isSpeaking: false, isMuted: false, isDeafened: false, status: 'online' },
  { id: '2', nickname: 'Bob', isSpeaking: true, isMuted: false, isDeafened: false, status: 'online' },
  { id: '3', nickname: 'Charlie', isSpeaking: false, isMuted: true, isDeafened: false, status: 'away' },
])

// Methods
const handleRoomSelected = (roomId: string) => {
  activeRoomId.value = roomId
}

const handleLeaveRoom = () => {
  activeRoomId.value = null
}

const showCreateRoomModal = () => {
  showModal.value = true
}

const handleCreateRoom = (roomName: string) => {
  const newRoom: Room = {
    id: Date.now().toString(),
    name: roomName,
    userCount: 1,
    maxUsers: 10,
    category: 'Custom'
  }
  rooms.value.push(newRoom)
  activeRoomId.value = newRoom.id
  showModal.value = false
}

const toggleMobileSidebar = () => {
  mobileSidebarOpen.value = !mobileSidebarOpen.value
  mobileUserSidebarOpen.value = false
}

const toggleMobileUserSidebar = () => {
  mobileUserSidebarOpen.value = !mobileUserSidebarOpen.value
  mobileSidebarOpen.value = false
}
</script>

<style scoped>
.app-layout {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
}
</style>