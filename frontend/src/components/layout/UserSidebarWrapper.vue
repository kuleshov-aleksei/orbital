<template>
  <!-- Desktop User Sidebar -->
  <UserSidebar 
    v-if="!appStore.isMobile"
    v-model:collapsed="isCollapsed"
    class="hidden lg:flex"
    :users="usersStore.allUsers"
    :user-count="usersStore.userCount"
    :initial-volumes="roomStore.remoteStreamVolumes"
  />

  <!-- Mobile User Sidebar Overlay -->
  <div 
    v-if="appStore.isMobile && appStore.mobileUserSidebarOpen"
    class="fixed inset-0 bg-black bg-opacity-50 z-30"
    @click="appStore.closeMobileUserSidebar()"
  ></div>

  <!-- Mobile User Sidebar -->
  <UserSidebar
    v-if="appStore.isMobile"
    :is-open="appStore.mobileUserSidebarOpen"
    class="fixed right-0 top-0 h-full w-60 bg-gray-800 z-40"
    :users="usersStore.allUsers"
    :user-count="usersStore.userCount"
    :initial-volumes="roomStore.remoteStreamVolumes"
    :collapsed="false"
    @close-mobile-sidebar="appStore.closeMobileUserSidebar()"
  />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoomStore, useAppStore, useUsersStore } from '@/stores'
import UserSidebar from '@/components/UserSidebar.vue'

const roomStore = useRoomStore()
const appStore = useAppStore()
const usersStore = useUsersStore()

// Collapsed state - open by default as requested
const isCollapsed = ref(false)

// Fetch users when component is mounted
onMounted(() => {
  void usersStore.fetchAllUsers()
})
</script>
