<template>
  <!-- Desktop User Sidebar -->
  <UserSidebar
    v-if="!appStore.isMobile"
    v-model:collapsed="isCollapsed"
    class="hidden lg:flex"
    :users="visibleUsers"
    :user-count="visibleUsers.length"
    :room-id="roomStore.activeRoomId || ''"
    :initial-volumes="roomStore.remoteStreamVolumes" />

  <!-- Mobile User Sidebar Overlay -->
  <div
    v-if="appStore.isMobile && appStore.mobileUserSidebarOpen"
    class="fixed inset-0 bg-theme-backdrop z-30"
    @click="appStore.closeMobileUserSidebar()"></div>

  <!-- Mobile User Sidebar -->
  <UserSidebar
    v-if="appStore.isMobile"
    :is-open="appStore.mobileUserSidebarOpen"
    class="fixed right-0 top-0 h-full w-60 bg-gray-800 z-40 safe-area-pad"
    :users="visibleUsers"
    :user-count="visibleUsers.length"
    :room-id="roomStore.activeRoomId || ''"
    :initial-volumes="roomStore.remoteStreamVolumes"
    :collapsed="false"
    @close-mobile-sidebar="appStore.closeMobileUserSidebar()" />
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue"
import {
  useRoomStore,
  useAppStore,
  useUsersStore,
  usePermissionsStore,
  useTextChatStore,
} from "@/stores"
import { apiService } from "@/services/api"
import UserSidebar from "@/components/UserSidebar.vue"

const roomStore = useRoomStore()
const appStore = useAppStore()
const usersStore = useUsersStore()
const permissionsStore = usePermissionsStore()
const textChatStore = useTextChatStore()

// While a text channel is open, list only the users who can see it.
const viewers = ref<{ roomId: string; ids: Set<string> } | null>(null)
const channelId = computed(() => textChatStore.activeChannel?.id ?? null)

const visibleUsers = computed(() => {
  const id = channelId.value
  // Until this channel's viewers arrive, keep the full list (no empty flash).
  if (!id || viewers.value?.roomId !== id) return usersStore.sortedUsers
  const ids = viewers.value.ids
  return usersStore.sortedUsers.filter((u) => ids.has(u.id))
})

let requestSeq = 0
async function loadViewers() {
  const id = channelId.value
  const seq = ++requestSeq
  if (!id) {
    viewers.value = null
    return
  }
  try {
    const res = await apiService.getRoomViewers(id)
    if (seq === requestSeq) viewers.value = { roomId: id, ids: new Set(res.user_ids) }
  } catch (error) {
    console.error("Failed to load channel viewers:", error)
  }
}

// Refetch on channel switch, on any permission change (permissions_updated
// reloads permissionsStore.me: overwrites, role assignments, room moves) and
// when users join the server.
watch(
  [channelId, () => permissionsStore.me, () => usersStore.userCount],
  () => void loadViewers(),
  { immediate: true },
)

// Collapsed state - open by default as requested
const isCollapsed = ref(false)

// Fetch users when component is mounted
onMounted(() => {
  void usersStore.fetchAllUsers()
})
</script>
