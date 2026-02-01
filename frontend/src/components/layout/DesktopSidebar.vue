<template>
  <div class="hidden lg:flex flex-col w-60 bg-gray-800">
    <RoomSidebar
      class="flex-1"
      :active-room-id="activeRoomId"
      :is-mobile-view="false"
      @room-selected="$emit('room-selected', $event)"
      @create-room="$emit('create-room')"
      @create-room-in-category="$emit('create-room-in-category', $event)"
      @rename-category="$emit('rename-category', $event)"
      @delete-category="$emit('delete-category', $event)"
      @move-room="$emit('move-room', $event)"
      @edit-room="$emit('edit-room', $event)"
      @delete-room="$emit('delete-room', $event)"
    />

    <UserControlPanel
      v-model:model-value-muted="callStore.isMuted"
      v-model:model-value-deafened="callStore.isDeafened"
      v-model:model-value-screen-sharing="callStore.isScreenSharing"
      :nickname="userStore.nickname"
      :user-id="userStore.userId"
      :is-in-call="roomStore.isInRoom"
      :room-name="roomStore.activeRoomName"
      :ping="appStore.connectionPing"
      :connection-quality="appStore.connectionQuality"
      @toggle-mute="callControls.handleMuteToggle"
      @toggle-deafen="callControls.handleDeafenToggle"
      @toggle-screen-share="callControls.handleScreenShareToggle"
      @leave-room="$emit('leave-room')"
    />
  </div>
</template>

<script setup lang="ts">
import { useRoomStore, useUserStore, useAppStore, useCallStore } from '@/stores'
import { useCallControls } from '@/composables'
import RoomSidebar from '@/components/RoomSidebar.vue'
import UserControlPanel from '@/components/UserControlPanel.vue'

defineProps<{
  activeRoomId: string | null
}>()

defineEmits<{
  (e: 'room-selected', roomId: string): void
  (e: 'create-room'): void
  (e: 'create-room-in-category', payload: { categoryId: string, categoryName: string }): void
  (e: 'rename-category', payload: { categoryId: string, categoryName: string }): void
  (e: 'delete-category', payload: { categoryId: string, categoryName: string }): void
  (e: 'move-room', payload: { roomId: string, targetCategoryId: string }): void
  (e: 'edit-room', payload: { roomId: string, roomName: string, maxUsers: number }): void
  (e: 'delete-room', payload: { roomId: string, roomName: string, userCount: number }): void
  (e: 'leave-room'): void
}>()

const roomStore = useRoomStore()
const userStore = useUserStore()
const appStore = useAppStore()
const callStore = useCallStore()
const callControls = useCallControls()
</script>
