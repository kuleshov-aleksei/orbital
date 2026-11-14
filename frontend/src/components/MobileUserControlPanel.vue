<template>
  <div
    class="mobile-user-control-panel mx-3 mb-3 mt-2 rounded-2xl bg-theme-bg-secondary border border-theme-border/60 shadow-lg shadow-black/30 px-3 py-2.5">
    <div class="flex items-center justify-between">
      <!-- User Info -->
      <div class="flex items-center flex-1 min-w-0">
        <UserAvatar
          :user-id="userStore.userId"
          status="online"
          :size="40"
          class="mr-3 flex-shrink-0" />

        <div class="min-w-0">
          <div
            class="font-medium text-sm text-theme-text-primary truncate"
            :style="permissionsStore.nameStyleOf(userStore.userId)">
            {{ userStore.nickname }}
          </div>

          <div class="text-xs text-theme-text-muted">
            {{ statusText }}
          </div>
        </div>
      </div>

      <!-- Settings Button -->
      <button
        type="button"
        class="control-button w-10 h-10 rounded-full flex items-center justify-center bg-transparent hover:bg-theme-bg-hover active:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary ml-2 flex-shrink-0"
        title="Settings"
        @click="openSettings">
        <PhGearSix class="w-5 h-5" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import UserAvatar from "@/components/UserAvatar.vue"
import { useModalStore, useUserStore, useCallStore, usePermissionsStore } from "@/stores"
import { PhGearSix } from "@phosphor-icons/vue"

// Stores
const modalStore = useModalStore()
const userStore = useUserStore()
const permissionsStore = usePermissionsStore()
const callStore = useCallStore()

// Status text
const statusText = computed(() => {
  if (callStore.isDeafened) return "Deafened"
  if (callStore.isMuted) return "Muted"
  return "Online"
})

// Methods
const openSettings = () => {
  modalStore.openUserSettingsModal()
}
</script>
