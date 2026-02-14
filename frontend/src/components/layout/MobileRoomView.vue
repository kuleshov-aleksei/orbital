<template>
  <div
    v-if="appStore.isMobile && appStore.mobileView === 'rooms'"
    class="lg:hidden flex-1 flex flex-col bg-gray-900">
    <!-- Mobile Header -->
    <div
      class="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
      <h1 class="text-lg font-semibold">The Orbital</h1>
    </div>

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

defineProps<{
  activeRoomId: string | null
}>()

defineEmits<{
  (e: "room-selected-mobile", roomId: string): void
  (e: "create-room"): void
  (
    e: "create-room-in-category",
    payload: { categoryId: string; categoryName: string },
  ): void
  (
    e: "rename-category",
    payload: { categoryId: string; categoryName: string },
  ): void
  (
    e: "delete-category",
    payload: { categoryId: string; categoryName: string },
  ): void
  (e: "move-room", payload: { roomId: string; targetCategoryId: string }): void
  (
    e: "edit-room",
    payload: { roomId: string; roomName: string; maxUsers: number },
  ): void
  (
    e: "delete-room",
    payload: { roomId: string; roomName: string; userCount: number },
  ): void
}>()

const appStore = useAppStore()
</script>
