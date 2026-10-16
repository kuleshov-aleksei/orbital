<template>
  <div
    class="mobile-user-control-panel bg-theme-bg-secondary border-t border-theme-border px-3 py-2">
    <div class="flex items-center justify-between">
      <!-- User Info -->
      <div class="flex items-center flex-1 min-w-0">
        <UserAvatar
          :user-id="userStore.userId"
          status="online"
          :size="32"
          class="mr-3 flex-shrink-0" />

        <div class="min-w-0">
          <div class="font-medium text-sm text-theme-text-primary truncate">
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
        class="control-button h-8 w-10 rounded-lg bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary hover:text-theme-text-primary ml-2 flex-shrink-0"
        title="Settings"
        @click="openSettings">
        <PhGearSix class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import UserAvatar from "@/components/UserAvatar.vue"
import { useModalStore, useUserStore, useCallStore } from "@/stores"
import { PhGearSix } from "@phosphor-icons/vue"

// Stores
const modalStore = useModalStore()
const userStore = useUserStore()
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
