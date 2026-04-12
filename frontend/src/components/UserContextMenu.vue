<template>
  <div
    v-if="visible"
    class="fixed bg-theme-bg-secondary border border-theme-border rounded-lg shadow-lg z-50 py-2 min-w-48"
    :style="menuStyle"
    @click.stop>
    <div class="px-3 py-2 text-sm text-theme-text-secondary border-b border-theme-border">
      {{ userNickname }}
    </div>

    <!-- Mute/Unmute User -->
    <button
      type="button"
      class="w-full px-3 py-2 text-left text-sm text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary transition-colors flex items-center space-x-2"
      @click="handleMuteToggle">
      <PhMicrophoneSlash v-if="isMuted" class="w-4 h-4" />
      <PhMicrophone v-else class="w-4 h-4" />
      <span>{{ isMuted ? "Unmute User" : "Mute User" }}</span>
    </button>

    <div class="border-t border-theme-border my-1"></div>

    <!-- Volume Control -->
    <div class="px-3 py-2">
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm text-theme-text-secondary">Volume</span>
        <span class="text-xs text-theme-text-muted">{{ Math.round(volume) }}%</span>
      </div>
      <div class="flex items-center space-x-2">
        <PhSpeakerHigh class="w-4 h-4 text-theme-text-muted" />
        <input
          :value="volume"
          type="range"
          min="0"
          max="100"
          class="flex-1 h-1 bg-theme-bg-hover rounded-lg appearance-none cursor-pointer"
          @input="handleVolumeInput" />
      </div>
    </div>

    <!-- Role Management -->
    <template v-if="showRoleManagement && isCurrentUserSuperAdmin && targetUser">
      <div class="border-t border-theme-border my-1"></div>

      <!-- Promote to Admin -->
      <button
        v-if="canPromote"
        type="button"
        class="w-full px-3 py-2 text-left text-sm text-theme-accent hover:bg-theme-bg-hover hover:text-theme-accent-hover transition-colors flex items-center gap-2"
        :disabled="promoting"
        @click="handlePromote">
        <PhUserPlus class="w-4 h-4" />
        <span>{{ promoting ? "Promoting..." : "Make Admin" }}</span>
      </button>

      <!-- Demote to User -->
      <button
        v-if="canDemote"
        type="button"
        class="w-full px-3 py-2 text-left text-sm text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary transition-colors flex items-center gap-2"
        :disabled="demoting"
        @click="handleDemote">
        <PhUserMinus class="w-4 h-4" />
        <span>{{ demoting ? "Demoting..." : "Remove Admin" }}</span>
      </button>

      <!-- Super Admin indicator -->
      <div
        v-if="targetUserIsSuperAdmin"
        class="px-3 py-2 text-sm text-purple-400 flex items-center gap-2 cursor-not-allowed opacity-60"
        title="Cannot modify super admin">
        <PhCrown class="w-4 h-4" />
        <span>Super Admin</span>
      </div>
    </template>

    <!-- Kick User -->
    <template v-if="canKick">
      <div class="border-t border-theme-border my-1"></div>

      <button
        type="button"
        class="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-theme-bg-hover hover:text-red-300 transition-colors flex items-center gap-2"
        :disabled="kicking"
        @click="handleKick">
        <PhSignOut class="w-4 h-4" />
        <span>{{ kicking ? "Kicking..." : "Kick User" }}</span>
      </button>
    </template>
  </div>

  <!-- Click outside to close menu -->
  <div v-if="visible" class="fixed inset-0 z-40" @click="hideMenu"></div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import {
  PhMicrophone,
  PhMicrophoneSlash,
  PhSpeakerHigh,
  PhUserPlus,
  PhUserMinus,
  PhCrown,
  PhSignOut,
} from "@phosphor-icons/vue"
import { useUsersStore, useRoomStore, useUserStore, useCallStore } from "@/stores"
import { apiService } from "@/services/api"
import { useUserContextMenu } from "@/composables/useUserContextMenu"

interface Props {
  userId?: string
  roomId?: string
}

const props = withDefaults(defineProps<Props>(), {
  userId: "",
  roomId: "",
})

const usersStore = useUsersStore()
const roomStore = useRoomStore()
const userStore = useUserStore()
const callStore = useCallStore()
const { openContextMenu, closeContextMenu } = useUserContextMenu()

const visible = ref(false)
const position = { x: 0, y: 0 }
const promoting = ref(false)
const demoting = ref(false)
const kicking = ref(false)
const activeUserId = ref<string | null>(null)

const effectiveRoomId = computed(() => props.roomId || roomStore.activeRoomId)

const effectiveUserId = computed(() => activeUserId.value ?? props.userId)

const targetUser = computed(() => {
  return usersStore.allUsers.find((u) => u.id === effectiveUserId.value)
})

const userNickname = computed(() => targetUser.value?.nickname || "Unknown User")

const volume = computed(() => roomStore.getUserVolume(effectiveUserId.value))

const isMuted = computed(() => {
  const currentUserId = userStore.userId
  if (effectiveUserId.value === currentUserId) {
    return callStore.isMuted
  }
  return roomStore.getUserMutedLocally(effectiveUserId.value)
})

const isCurrentUserSuperAdmin = computed(() => userStore.isSuperAdmin)

const targetUserIsSuperAdmin = computed(() => targetUser.value?.role === "super_admin")
const targetUserIsAdmin = computed(() => targetUser.value?.role === "admin")
const targetUserIsRegularUser = computed(() => targetUser.value?.role === "user")

const showRoleManagement = computed(() => {
  return effectiveUserId.value !== userStore.userId
})

const canPromote = computed(() => isCurrentUserSuperAdmin.value && targetUserIsRegularUser.value)
const canDemote = computed(() => isCurrentUserSuperAdmin.value && targetUserIsAdmin.value)

const canKick = computed(() => {
  if (!userStore.isAdmin) return false
  if (effectiveUserId.value === userStore.userId) return false
  if (userStore.isSuperAdmin) return true
  return !targetUserIsSuperAdmin.value
})

const MENU_MIN_WIDTH = 192
const MENU_ESTIMATED_HEIGHT = 300
const SCREEN_GAP = 50

const menuStyle = computed(() => {
  const screenWidth = window.innerWidth

  let left = position.x
  let top = position.y
  let transform = "translate(0, -100%)"

  if (left + MENU_MIN_WIDTH > screenWidth - SCREEN_GAP) {
    left = screenWidth - MENU_MIN_WIDTH - SCREEN_GAP
  }

  if (top - MENU_ESTIMATED_HEIGHT < SCREEN_GAP) {
    top = position.y
    transform = "translate(0, 0)"
  }

  return {
    left: `${left}px`,
    top: `${top}px`,
    transform,
  }
})

const show = (event: MouseEvent, userId?: string) => {
  event.preventDefault()
  event.stopPropagation()
  position.x = event.clientX
  position.y = event.clientY
  activeUserId.value = userId ?? null
  visible.value = true
  openContextMenu()
}

const hideMenu = () => {
  visible.value = false
  closeContextMenu()
}

const handleVolumeInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  const newVolume = parseInt(target.value)
  roomStore.setUserVolume(effectiveUserId.value, newVolume)
}

const handleMuteToggle = () => {
  const newMutedState = !isMuted.value
  roomStore.setUserMuted(effectiveUserId.value, newMutedState)
  hideMenu()
}

const handlePromote = async () => {
  if (!canPromote.value) return
  promoting.value = true
  try {
    await apiService.promoteUser(effectiveUserId.value)
    hideMenu()
  } catch (error) {
    console.error("Failed to promote user:", error)
  } finally {
    promoting.value = false
  }
}

const handleDemote = async () => {
  if (!canDemote.value) return
  demoting.value = true
  try {
    await apiService.demoteUser(effectiveUserId.value)
    hideMenu()
  } catch (error) {
    console.error("Failed to demote user:", error)
  } finally {
    demoting.value = false
  }
}

const handleKick = async () => {
  if (!canKick.value || !effectiveRoomId.value) return
  kicking.value = true
  try {
    await apiService.kickUser(effectiveRoomId.value, effectiveUserId.value)
    hideMenu()
  } catch (error) {
    console.error("Failed to kick user:", error)
  } finally {
    kicking.value = false
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    hideMenu()
  }
}

const handleDocumentClick = () => {
  if (visible.value) {
    hideMenu()
  }
}

onMounted(() => {
  document.addEventListener("keydown", handleKeydown)
  document.addEventListener("click", handleDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown)
  document.removeEventListener("click", handleDocumentClick)
})

defineExpose({
  show,
  hideMenu,
})
</script>

<style scoped>
input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #10b981;
  cursor: pointer;
  border-radius: 50%;
}

input[type="range"]::-moz-range-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #10b981;
  cursor: pointer;
  border-radius: 50%;
  border: none;
}
</style>
