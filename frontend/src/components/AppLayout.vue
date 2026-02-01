<template>
  <div class="app-layout h-screen bg-gray-900 text-white flex flex-col lg:flex-row overflow-hidden">
    <div class="flex flex-1 overflow-hidden">
      <!-- Desktop Sidebar -->
      <DesktopSidebar
        :active-room-id="roomManager.activeRoomId"
        @room-selected="roomManager.handleRoomSelected"
        @create-room="modalManager.openCreateRoomModal()"
        @create-room-in-category="handleCreateRoomInCategory"
        @rename-category="handleRenameCategory"
        @delete-category="handleDeleteCategory"
        @move-room="handleMoveRoom"
        @edit-room="handleEditRoom"
        @delete-room="handleDeleteRoom"
        @leave-room="roomManager.handleLeaveRoom"
      />

      <!-- Mobile Room List View -->
      <MobileRoomView
        :active-room-id="roomManager.activeRoomId"
        @room-selected-mobile="roomManager.handleRoomSelectedMobile"
        @create-room="modalManager.openCreateRoomModal()"
        @create-room-in-category="handleCreateRoomInCategory"
        @rename-category="handleRenameCategory"
        @delete-category="handleDeleteCategory"
        @move-room="handleMoveRoom"
        @edit-room="handleEditRoom"
        @delete-room="handleDeleteRoom"
      />

      <!-- Main Content Area -->
      <MainContent
        ref="mainContentRef"
        @room-selected="roomManager.handleRoomSelected"
        @create-room="modalManager.openCreateRoomModal()"
        @leave-room="roomManager.handleLeaveRoom"
        @volume-change="roomManager.handleVolumeChange"
        @nickname-change="callControls.handleNicknameChange"
        @ping-update="callControls.handlePingUpdate"
      />

      <!-- User Sidebar (Desktop + Mobile) -->
      <UserSidebarWrapper
        @volume-change="roomManager.handleVolumeChange"
        @nickname-change="callControls.handleNicknameChange"
      />
    </div>

    <!-- Overlays (Error, Loading, Mobile) -->
    <AppOverlays />

    <!-- Modal Manager -->
    <ModalManager />
  </div>
</template>

<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue'
import { 
  DesktopSidebar, 
  MobileRoomView, 
  MainContent, 
  UserSidebarWrapper, 
  AppOverlays 
} from '@/components/layout'
import ModalManager from '@/components/ModalManager.vue'
import { useUserSession, useRoomManager, useCategoryManager, useCallControls, useModalManager } from '@/composables'
import { useWebSocketHandlers } from '@/composables'

// Initialize composables (auto-initialize on mount)
useUserSession()
useWebSocketHandlers()

// Get managers
const roomManager = useRoomManager()
const categoryManager = useCategoryManager()
const callControls = useCallControls()
const modalManager = useModalManager()

// Template refs
const mainContentRef = useTemplateRef<InstanceType<typeof MainContent>>('mainContentRef')

// Event handlers for sidebar actions
const handleCreateRoomInCategory = (payload: { categoryId: string, categoryName: string }) => {
  modalManager.openCreateRoomModal(payload.categoryName)
}

const handleRenameCategory = (payload: { categoryId: string, categoryName: string }) => {
  modalManager.openRenameCategoryModal(payload.categoryId, payload.categoryName)
}

const handleDeleteCategory = (payload: { categoryId: string, categoryName: string }) => {
  const roomCount = categoryManager.countRoomsInCategory(payload.categoryId)
  modalManager.openDeleteCategoryModal(payload.categoryId, payload.categoryName, roomCount)
}

const handleMoveRoom = (payload: { roomId: string, targetCategoryId: string }) => {
  roomManager.moveRoomToCategory(payload.roomId, payload.targetCategoryId)
}

const handleEditRoom = (payload: { roomId: string, roomName: string, maxUsers: number }) => {
  modalManager.openEditRoomModal(payload.roomId, payload.roomName, payload.maxUsers)
}

const handleDeleteRoom = (payload: { roomId: string, roomName: string, userCount: number }) => {
  modalManager.openDeleteRoomModal(payload.roomId, payload.roomName, payload.userCount)
}

// Initialize data on mount
onMounted(async () => {
  await roomManager.loadRooms()
  await categoryManager.loadCategories()
})
</script>

<style scoped>
.app-layout {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
}
</style>
