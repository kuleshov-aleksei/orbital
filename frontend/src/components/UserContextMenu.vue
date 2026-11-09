<template>
  <!-- Teleported: sidebars use CSS translate, which would make "fixed" relative to them -->
  <Teleport to="body">
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
            max="200"
            class="flex-1 h-1 bg-theme-bg-hover rounded-lg appearance-none cursor-pointer"
            @input="handleVolumeInput" />
        </div>
        <!-- High volume warning -->
        <div
          v-if="showHighVolumeWarning"
          class="mt-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-2 py-1.5 flex items-start gap-1.5 max-w-40">
          <PhWarning class="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>Boosting volume above 100% may amplify background noise and distort audio.</span>
        </div>
      </div>

      <!-- Role Management (manage_roles; only roles below your highest role) -->
      <template
        v-if="permissionsStore.canManageRoles && (targetUserIsOwner || assignableRoles.length > 0)">
        <div class="border-t border-theme-border my-1"></div>

        <div
          v-if="targetUserIsOwner"
          class="px-3 py-2 text-sm text-purple-400 flex items-center gap-2 cursor-not-allowed opacity-60"
          title="The owner has every permission">
          <PhCrown class="w-4 h-4" />
          <span>Owner</span>
        </div>

        <template v-else>
          <div
            class="px-3 pt-1 pb-1 text-xs font-medium uppercase tracking-wide text-theme-text-muted">
            Roles
          </div>
          <label
            v-for="role in assignableRoles"
            :key="role.id"
            class="w-full px-3 py-1.5 text-left text-sm text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary transition-colors flex items-center gap-2 cursor-pointer"
            :class="{
              'opacity-50 cursor-not-allowed': !permissionsStore.canManageRole(role) || savingRoles,
            }"
            @click.stop>
            <input
              type="checkbox"
              class="accent-theme-accent"
              :checked="targetRoleIds.includes(role.id)"
              :disabled="!permissionsStore.canManageRole(role) || savingRoles"
              @change="toggleRole(role.id)" />
            <span
              class="w-2.5 h-2.5 rounded-full flex-shrink-0"
              :style="{ backgroundColor: role.color || 'var(--color-text-muted, #888)' }"></span>
            <span class="truncate">{{ role.name }}</span>
          </label>
        </template>
      </template>

      <!-- Request Logs -->
      <template v-if="canRequestLogs">
        <div class="border-t border-theme-border my-1"></div>

        <button
          type="button"
          class="w-full px-3 py-2 text-left text-sm text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary transition-colors flex items-center gap-2"
          @click="handleRequestLogs">
          <PhBug class="w-4 h-4" />
          <span>Request Logs</span>
        </button>
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
    <div
      v-if="visible"
      class="fixed inset-0 z-40"
      @click="hideMenu"
      @contextmenu.prevent="hideMenu"></div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import {
  PhMicrophone,
  PhMicrophoneSlash,
  PhSpeakerHigh,
  PhCrown,
  PhSignOut,
  PhWarning,
  PhBug,
} from "@phosphor-icons/vue"
import {
  useUsersStore,
  useRoomStore,
  useUserStore,
  useCallStore,
  usePermissionsStore,
  useAppStore,
} from "@/stores"
import { Permission } from "@/types/permissions"
import { apiService } from "@/services/api"
import { wsService } from "@/services/websocket"
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
const appStore = useAppStore()
const { openContextMenu, closeContextMenu } = useUserContextMenu()

const visible = ref(false)
const position = { x: 0, y: 0 }
const savingRoles = ref(false)
const kicking = ref(false)
const activeUserId = ref<string | null>(null)

const effectiveRoomId = computed(() => props.roomId || roomStore.activeRoomId)

const effectiveUserId = computed(() => activeUserId.value ?? props.userId)

const targetUser = computed(() => {
  return usersStore.allUsers.find((u) => u.id === effectiveUserId.value)
})

const userNickname = computed(() => targetUser.value?.nickname || "Unknown User")

const volume = computed(() => roomStore.getUserVolume(effectiveUserId.value))

const showHighVolumeWarning = computed(() => volume.value > 100)

const isMuted = computed(() => {
  const currentUserId = userStore.userId
  if (effectiveUserId.value === currentUserId) {
    return callStore.isMuted
  }
  return roomStore.getUserMutedLocally(effectiveUserId.value)
})

const permissionsStore = usePermissionsStore()

const targetUserIsOwner = computed(() => targetUser.value?.role === "super_admin")

// Every custom role is listed; ones at/above your highest role are shown disabled.
const assignableRoles = computed(() => permissionsStore.customRoles)
const targetRoleIds = computed(() => permissionsStore.roleIdsOf(effectiveUserId.value))

// UI hint only: the backend checks kick_members + role hierarchy.
const canKick = computed(() => {
  if (!effectiveRoomId.value) return false
  if (!permissionsStore.can(Permission.KickMembers, { roomId: effectiveRoomId.value })) return false
  return permissionsStore.canTarget(effectiveUserId.value, targetUserIsOwner.value)
})

const canRequestLogs = computed(() => {
  return permissionsStore.isOwner && effectiveUserId.value !== userStore.userId
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

const toggleRole = async (roleId: string) => {
  savingRoles.value = true
  try {
    await permissionsStore.toggleUserRole(effectiveUserId.value, roleId)
  } catch (error) {
    console.error("Failed to update roles:", error)
    appStore.setError(`Failed to update roles: ${(error as Error).message}`)
  } finally {
    savingRoles.value = false
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

const handleRequestLogs = () => {
  if (!canRequestLogs.value) return
  wsService.sendMessage("request_logs", {
    target_user_id: effectiveUserId.value,
  })
  hideMenu()
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
