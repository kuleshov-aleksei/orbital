<template>
  <div
    class="app-layout h-screen bg-theme-bg-primary text-theme-text-primary flex flex-col lg:flex-row overflow-hidden">
    <!-- Auth View - Blocks entire app until user completes auth -->
    <AuthView v-if="!userStore.hasCompletedAuth" />

    <!-- Main App Content - Only visible after auth -->
    <template v-else>
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
          @start-screen-share="showScreenShareQualityModal = true"
          @auth-required="handleAuthRequired"
          @leave-room="roomManager.handleLeaveRoom" />

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
          @delete-room="handleDeleteRoom" />

        <!-- Main Content Area -->
        <MainContent
          ref="mainContentRef"
          @room-selected="roomManager.handleRoomSelected"
          @create-room="modalManager.openCreateRoomModal()"
          @leave-room="roomManager.handleLeaveRoom"
          @ping-update="(p) => callControls.handlePingUpdate(p.ping, p.quality)"
          @request-screen-share="showScreenShareQualityModal = true" />

        <!-- User Sidebar (Desktop + Mobile) -->
        <UserSidebarWrapper />
      </div>

      <!-- Overlays (Error, Loading, Mobile) -->
      <AppOverlays />

      <!-- Modal Manager -->
      <ModalManager />

      <!-- Screen Share Quality Modal (combines quality + source selection for Electron) -->
      <ScreenShareQualityModal
        :is-open="showScreenShareQualityModal"
        @select-quality="handleScreenShareQualitySelected"
        @select-electron-source="handleElectronSourceSelected"
        @cancel="showScreenShareQualityModal = false" />

      <!-- Update Notification -->
      <UpdateNotification :visible="showUpdateNotification" @reload="handleReload" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue"
import {
  DesktopSidebar,
  MobileRoomView,
  MainContent,
  UserSidebarWrapper,
  AppOverlays,
} from "@/components/layout"
import ModalManager from "@/components/ModalManager.vue"
import ScreenShareQualityModal from "@/components/ScreenShareQualityModal.vue"
import UpdateNotification from "@/components/UpdateNotification.vue"
import AuthView from "@/views/AuthView.vue"
import { useRoomStore, useUserStore, useAppStore } from "@/stores"
import {
  useUserSession,
  useRoomManager,
  useCategoryManager,
  useCallControls,
  useModalManager,
} from "@/composables"
import { useWebSocketHandlers } from "@/composables"
import { createVersionChecker } from "@/services/version"

// Initialize composables (auto-initialize on mount)
useUserSession()
useWebSocketHandlers()

// Get stores and managers
const userStore = useUserStore()
const roomStore = useRoomStore()
const appStore = useAppStore()
const roomManager = useRoomManager()
const categoryManager = useCategoryManager()
const callControls = useCallControls()
const modalManager = useModalManager()

// Version checker state
const showUpdateNotification = ref(false)
let versionChecker: ReturnType<typeof createVersionChecker> | null = null

// Handle update availability
const handleUpdateAvailable = (isInCall: boolean) => {
  if (isInCall) {
    // Show notification banner when in call
    showUpdateNotification.value = true
  } else {
    // Auto-reload when not in call
    console.log("[Update] Auto-reloading to apply update...")
    window.location.reload()
  }
}

// Handle reload button click
const handleReload = () => {
  window.location.reload()
}

// Template refs
const mainContentRef = useTemplateRef<InstanceType<typeof MainContent>>("mainContentRef")

// Modal state
const showScreenShareQualityModal = ref(false)

// Event handlers for sidebar actions
const handleCreateRoomInCategory = (payload: { categoryId: string; categoryName: string }) => {
  modalManager.openCreateRoomModal(payload.categoryName)
}

const handleRenameCategory = (payload: { categoryId: string; categoryName: string }) => {
  modalManager.openRenameCategoryModal(payload.categoryId, payload.categoryName)
}

const handleDeleteCategory = (payload: { categoryId: string; categoryName: string }) => {
  const roomCount = categoryManager.countRoomsInCategory(payload.categoryId)
  modalManager.openDeleteCategoryModal(payload.categoryId, payload.categoryName, roomCount)
}

const handleMoveRoom = async (payload: { roomId: string; targetCategoryId: string }) => {
  await roomManager.moveRoomToCategory(payload.roomId, payload.targetCategoryId)
}

const handleEditRoom = (payload: { roomId: string; roomName: string; maxUsers: number }) => {
  modalManager.openEditRoomModal(payload.roomId, payload.roomName, payload.maxUsers)
}

const handleDeleteRoom = (payload: { roomId: string; roomName: string; userCount: number }) => {
  modalManager.openDeleteRoomModal(payload.roomId, payload.roomName, payload.userCount)
}

const handleAuthRequired = () => {
  appStore.showRoomsView()
}

const handleScreenShareQualitySelected = async (quality: string) => {
  showScreenShareQualityModal.value = false

  const voiceCallView = mainContentRef.value?.voiceCallViewRef as
    | {
        startScreenShare?: (quality: string) => Promise<void>
      }
    | undefined
  if (voiceCallView?.startScreenShare) {
    await voiceCallView.startScreenShare(quality)
  }
}

const handleElectronSourceSelected = async (
  quality: string,
  sourceId: string,
  audio: boolean,
  audioSources?: any[],
) => {
  showScreenShareQualityModal.value = false

  const voiceCallView = mainContentRef.value?.voiceCallViewRef as
    | {
        startElectronScreenShare?: (
          quality: string,
          audio: boolean,
          sourceId: string,
          audioSources?: any[],
        ) => Promise<void>
      }
    | undefined
  if (voiceCallView?.startElectronScreenShare) {
    await voiceCallView.startElectronScreenShare(quality, audio, sourceId, audioSources)
  }
}

// Initialize data on mount (only if authenticated)
onMounted(async () => {
  if (userStore.hasCompletedAuth) {
    await roomManager.loadRooms()
    await categoryManager.loadCategories()
  }

  // Start version checker
  versionChecker = createVersionChecker(handleUpdateAvailable, () => roomStore.isInRoom)
  versionChecker.start()
})

// Cleanup on unmount
onUnmounted(() => {
  versionChecker?.stop()
})

// Watch for auth completion and load rooms when user completes auth (e.g., guest login)
watch(
  () => userStore.hasCompletedAuth,
  async (hasCompleted) => {
    if (hasCompleted) {
      await roomManager.loadRooms()
      await categoryManager.loadCategories()
    }
  },
)
</script>

<style scoped>
.app-layout {
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell",
    "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
}
</style>
