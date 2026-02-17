<template>
  <div
    v-if="appStore.isMobile && appStore.mobileView === 'rooms'"
    class="lg:hidden flex-1 flex flex-col bg-gray-900">
    <!-- Floating Toggle Button for User Sidebar -->
    <button
      type="button"
      class="fixed top-4 right-4 z-30 w-10 h-10 rounded-full bg-gray-700/90 hover:bg-gray-600 text-gray-300 hover:text-white shadow-lg flex items-center justify-center transition-all duration-200"
      title="Open user list"
      @click="appStore.toggleMobileUserSidebar()">
      <PhCaretDoubleLeft class="w-5 h-5" />
    </button>

    <!-- Mobile Room List Content -->
    <RoomSidebar
      :active-room-id="activeRoomId"
      :is-mobile-view="true"
      class="flex-1"
      @room-selected="$emit('room-selected-mobile', $event)"
      @create-room="$emit('create-room')"
      @create-room-in-category="$emit('create-room-in-category', $event)"
      @rename-category="$emit('rename-category', $event)"
      @delete-category="$emit('delete-category', $event)"
      @move-room="$emit('move-room', $event)"
      @edit-room="$emit('edit-room', $event)"
      @delete-room="$emit('delete-room', $event)" />
  </div>
</template>

<script setup lang="ts">
import { useAppStore } from "@/stores"
import RoomSidebar from "@/components/RoomSidebar.vue"
import { PhCaretDoubleLeft } from "@phosphor-icons/vue"

defineProps<{
  activeRoomId: string | null
}>()

defineEmits<{
  (e: "room-selected-mobile", roomId: string): void
  (e: "create-room"): void
  (e: "create-room-in-category", payload: { categoryId: string; categoryName: string }): void
  (e: "rename-category", payload: { categoryId: string; categoryName: string }): void
  (e: "delete-category", payload: { categoryId: string; categoryName: string }): void
  (e: "move-room", payload: { roomId: string; targetCategoryId: string }): void
  (e: "edit-room", payload: { roomId: string; roomName: string; maxUsers: number }): void
  (e: "delete-room", payload: { roomId: string; roomName: string; userCount: number }): void
}>()

const appStore = useAppStore()
</script>
