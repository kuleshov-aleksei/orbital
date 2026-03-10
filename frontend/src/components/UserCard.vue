<template>
  <div
    class="user-card flex items-center px-3 py-2 rounded-lg hover:bg-theme-bg-hover transition-colors duration-200 cursor-pointer group relative"
    :data-testid="`user-card-${user.id}`"
    @contextmenu="showContextMenu">
    <!-- User Avatar -->
    <UserAvatar
      :user-id="user.id"
      :nickname="user.nickname"
      :avatar-url="user.avatar_url"
      :status="userStatus"
      :size="32"
      :grayscale="!user.is_online"
      class="mr-3" />

    <!-- User Info -->
    <div class="flex-1 min-w-0">
      <div
        v-if="!isEditingNickname"
        class="font-medium text-sm truncate cursor-pointer hover:text-theme-accent transition-colors"
        :class="{ 'text-theme-text-muted': !user.is_online }"
        :title="isCurrentUser ? 'Click to edit nickname' : ''"
        @click="startEditingNickname">
        {{ user.nickname }}
      </div>

      <div v-else class="flex items-center">
        <input
          ref="nicknameInput"
          v-model="editingNickname"
          type="text"
          class="w-full px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded focus:outline-none focus:border-theme-accent"
          maxlength="32"
          placeholder="Enter nickname"
          @blur="saveNickname"
          @keydown.enter="saveNickname"
          @keydown.escape="cancelEdit" />
      </div>

      <div class="text-xs text-theme-text-muted">
        <span v-if="user.is_speaking" class="text-green-400">Speaking...</span>

        <span v-else-if="user.is_deafened" class="text-red-400">Deafened</span>

        <span v-else-if="user.is_muted" class="text-red-400">Muted</span>

        <span v-else-if="user.status === 'away'">Away</span>

        <span v-else-if="user.status === 'dnd'">Do Not Disturb</span>

        <span v-else-if="user.is_online === true">Online</span>

        <span v-else-if="user.is_online === false">Offline</span>

        <span v-else>Online</span>
      </div>
    </div>

    <!-- Action Icons -->
    <div
      class="ml-2 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
      <!-- Muted Icon -->
      <div v-if="user.is_muted" class="w-4 h-4 text-red-400">
        <svg fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"
            clip-rule="evenodd" />
        </svg>
      </div>

      <!-- Speaking Indicator -->
      <div v-if="user.is_speaking" class="w-4 h-4 text-green-400 animate-pulse">
        <PhSpeakerHigh class="w-3 h-3" />
      </div>

      <!-- Deafened Icon -->
      <div v-if="user.is_deafened" class="w-4 h-4 text-theme-text-muted">
        <PhMicrophoneSlash class="w-3 h-3" />
      </div>
    </div>

    <!-- Context Menu -->
    <UserContextMenu ref="contextMenuRef" :user-id="user.id" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, useTemplateRef } from "vue"
import { PhMicrophoneSlash, PhSpeakerHigh } from "@phosphor-icons/vue"
import UserAvatar from "@/components/UserAvatar.vue"
import UserContextMenu from "@/components/UserContextMenu.vue"
import { useUserStore } from "@/stores"

interface User {
  id: string
  nickname: string
  avatar_url?: string
  is_speaking?: boolean
  is_muted?: boolean
  is_deafened?: boolean
  is_online?: boolean
  status?: "online" | "away" | "dnd"
  role?: "guest" | "user" | "admin" | "super_admin"
}

interface Props {
  user: User
  initialVolume?: number
}

const props = withDefaults(defineProps<Props>(), {
  initialVolume: 80,
})

// Initialize UserStore
const userStore = useUserStore()

const isEditingNickname = ref(false)
const editingNickname = ref("")
const nicknameInput = useTemplateRef<HTMLInputElement>("nicknameInput")
const contextMenuRef = useTemplateRef<InstanceType<typeof UserContextMenu>>("contextMenuRef")

// Compute user status based on both status field and is_online
const userStatus = computed(() => {
  // If user is explicitly offline, return 'offline'
  if (props.user.is_online === false) {
    return "offline"
  }
  // If user has a specific status (away, dnd), use it
  if (props.user.status) {
    return props.user.status
  }
  // Default to online if is_online is true or undefined
  return "online"
})

// Check if this is the current user (for nickname editing)
const currentUserId = userStore.userId
const isCurrentUser = computed(() => props.user.id === currentUserId)

const showContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  contextMenuRef.value?.show(event)
}

const startEditingNickname = () => {
  if (!isCurrentUser.value) return

  isEditingNickname.value = true
  editingNickname.value = props.user.nickname

  void nextTick(() => {
    nicknameInput.value?.focus()
    nicknameInput.value?.select()
  })
}

const saveNickname = async () => {
  if (!isCurrentUser.value) return

  const trimmedNickname = editingNickname.value.trim()
  if (trimmedNickname && trimmedNickname !== props.user.nickname) {
    await userStore.updateNickname(trimmedNickname)
  }
  isEditingNickname.value = false
}

const cancelEdit = () => {
  isEditingNickname.value = false
  editingNickname.value = props.user.nickname
}
</script>

<style scoped>
.user-card input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #10b981;
  cursor: pointer;
  border-radius: 50%;
}

.user-card input[type="range"]::-moz-range-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: #10b981;
  cursor: pointer;
  border-radius: 50%;
  border: none;
}
</style>
