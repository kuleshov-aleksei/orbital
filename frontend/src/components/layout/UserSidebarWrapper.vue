<template>
  <!-- Desktop User Sidebar -->
  <UserSidebar 
    v-if="roomStore.activeRoomId && !appStore.isMobile"
    class="hidden lg:flex"
    :users="roomStore.currentRoomUsers"
    :user-count="roomStore.currentRoomUsers.length"
    :initial-volumes="roomStore.remoteStreamVolumes"
  />

  <!-- Mobile User Sidebar Overlay -->
  <div 
    v-if="appStore.isMobile && appStore.mobileUserSidebarOpen && roomStore.activeRoomId"
    class="fixed inset-0 bg-black bg-opacity-50 z-30"
    @click="appStore.closeMobileUserSidebar()"
  ></div>

  <!-- Mobile User Sidebar -->
  <UserSidebar
    v-if="appStore.isMobile && roomStore.activeRoomId"
    :is-open="appStore.mobileUserSidebarOpen"
    class="fixed right-0 top-0 h-full w-60 bg-gray-800 z-40"
    :users="roomStore.currentRoomUsers"
    :user-count="roomStore.currentRoomUsers.length"
    :initial-volumes="roomStore.remoteStreamVolumes"
    @close-mobile-sidebar="appStore.closeMobileUserSidebar()"
  />
</template>

<script setup lang="ts">
import { useRoomStore, useAppStore } from '@/stores'
import UserSidebar from '@/components/UserSidebar.vue'

const roomStore = useRoomStore()
const appStore = useAppStore()
</script>
