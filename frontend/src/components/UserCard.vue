<template>
  <div
    class="user-card flex items-center px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors duration-200 cursor-pointer group relative"
    :data-testid="`user-card-${user.id}`"
    @contextmenu="showContextMenu"
  >
    <!-- User Avatar -->
    <UserAvatar
      :nickname="user.nickname"
      :status="userStatus"
      :size="32"
      :grayscale="!user.is_online"
      class="mr-3"
    />

    <!-- User Info -->
    <div class="flex-1 min-w-0">
      <div 
        v-if="!isEditingNickname"
        class="font-medium text-sm truncate cursor-pointer hover:text-indigo-400 transition-colors"
        :class="{ 'text-gray-500': !user.is_online }"
        :title="isCurrentUser ? 'Click to edit nickname' : ''"
        @click="startEditingNickname"
      >
        {{ user.nickname }}
      </div>

      <div v-else class="flex items-center">
        <input
          ref="nicknameInput"
          v-model="editingNickname"
          type="text"
          class="w-full px-2 py-1 text-sm bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-indigo-500"
          maxlength="32"
          placeholder="Enter nickname"
          @blur="saveNickname"
          @keydown.enter="saveNickname"
          @keydown.escape="cancelEdit"
        />
      </div>

      <div class="text-xs text-gray-400">
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
    <div class="ml-2 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
      <!-- Muted Icon -->
      <div v-if="user.is_muted" class="w-4 h-4 text-red-400">
        <svg fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clip-rule="evenodd" />
        </svg>
      </div>
      
      <!-- Speaking Indicator -->
      <div v-if="user.is_speaking" class="w-4 h-4 text-green-400 animate-pulse">
        <PhSpeakerHigh class="w-3 h-3" />
      </div>

      <!-- Deafened Icon -->
      <div v-if="user.is_deafened" class="w-4 h-4 text-gray-400">
        <PhMicrophoneSlash class="w-3 h-3" />
      </div>
    </div>

    <!-- Context Menu -->
    <div
      v-if="showMenu"
      class="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-lg z-50 py-2 min-w-48"
      :style="getMenuPosition()"
      @click.stop
    >
      <div class="px-3 py-2 text-sm text-gray-300 border-b border-gray-600">
        {{ user.nickname }}
      </div>
      
      <!-- Volume Control -->
      <div class="px-3 py-2">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm text-gray-300">Volume</span>

          <span class="text-xs text-gray-400">{{ Math.round(volume) }}%</span>
        </div>

        <div class="flex items-center space-x-2">
          <PhSpeakerHigh class="w-4 h-4 text-gray-400" />

          <input
            v-model="volume"
            type="range"
            min="0"
            max="100"
            class="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
            @input="handleVolumeChange"
          />
        </div>
      </div>

      <!-- Role Management - Only for super_admin -->
      <template v-if="isSuperAdmin && !isCurrentUser">
        <div class="border-t border-gray-600 my-1"></div>

        <!-- Promote to Admin - shown for regular users -->
        <button
          v-if="canPromote"
          type="button"
          class="w-full px-3 py-2 text-left text-sm text-indigo-400 hover:bg-gray-700 hover:text-indigo-300 transition-colors flex items-center gap-2"
          :disabled="promoting"
          @click="handlePromote"
        >
          <PhUserPlus class="w-4 h-4" />

          <span>{{ promoting ? 'Promoting...' : 'Make Admin' }}</span>
        </button>

        <!-- Demote to User - shown for admins -->
        <button
          v-if="canDemote"
          type="button"
          class="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors flex items-center gap-2"
          :disabled="demoting"
          @click="handleDemote"
        >
          <PhUserMinus class="w-4 h-4" />

          <span>{{ demoting ? 'Demoting...' : 'Remove Admin' }}</span>
        </button>

        <!-- Super Admin indicator - shown for super_admins (disabled) -->
        <div
          v-if="targetUserIsSuperAdmin"
          class="px-3 py-2 text-sm text-purple-400 flex items-center gap-2 cursor-not-allowed opacity-60"
          title="Cannot modify super admin"
        >
          <PhCrown class="w-4 h-4" />

          <span>Super Admin</span>
        </div>
      </template>
    </div>

    <!-- Click outside to close menu -->
    <div 
      v-if="showMenu"
      class="fixed inset-0 z-40"
      @click="hideContextMenu"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, useTemplateRef } from 'vue'
import { PhMicrophoneSlash, PhSpeakerHigh, PhUserPlus, PhUserMinus, PhCrown } from '@phosphor-icons/vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { useUserStore } from '@/stores'
import { apiService } from '@/services/api'

interface User {
  id: string
  nickname: string
  is_speaking?: boolean
  is_muted?: boolean
  is_deafened?: boolean
  is_online?: boolean
  status?: 'online' | 'away' | 'dnd'
  role?: 'guest' | 'user' | 'admin' | 'super_admin'
}

interface Props {
  user: User
  initialVolume?: number
}

const props = withDefaults(defineProps<Props>(), {
  initialVolume: 80
})

const emit = defineEmits<{
  'volume-change': [userId: string, volume: number]
}>()

// Initialize UserStore
const userStore = useUserStore()

const showMenu = ref(false)
const volume = ref(props.initialVolume)
const isEditingNickname = ref(false)
const editingNickname = ref('')
const nicknameInput = useTemplateRef<HTMLInputElement>('nicknameInput')
const menuPosition = { x: 0, y: 0 }
const promoting = ref(false)
const demoting = ref(false)

// Compute user status based on both status field and is_online
const userStatus = computed(() => {
  // If user is explicitly offline, return 'offline'
  if (props.user.is_online === false) {
    return 'offline'
  }
  // If user has a specific status (away, dnd), use it
  if (props.user.status) {
    return props.user.status
  }
  // Default to online if is_online is true or undefined
  return 'online'
})

// Check if this is the current user (for nickname editing)
const currentUserId = userStore.userId
const isCurrentUser = computed(() => props.user.id === currentUserId)

// Role management computed properties
const isSuperAdmin = computed(() => userStore.isSuperAdmin)
const targetUserIsSuperAdmin = computed(() => props.user.role === 'super_admin')
const targetUserIsAdmin = computed(() => props.user.role === 'admin')
const targetUserIsRegularUser = computed(() => props.user.role === 'user')
const canPromote = computed(() => isSuperAdmin.value && targetUserIsRegularUser.value)
const canDemote = computed(() => isSuperAdmin.value && targetUserIsAdmin.value)

const showContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  event.stopPropagation()
  
  // Store mouse position for fixed positioning
  menuPosition.x = event.clientX
  menuPosition.y = event.clientY
  
  showMenu.value = true
}

const getMenuPosition = () => {
  return {
    left: `${menuPosition.x}px`,
    top: `${menuPosition.y}px`,
    transform: 'translate(0, -100%)' // Position above mouse
  }
}

const hideContextMenu = () => {
  showMenu.value = false
}

const handleVolumeChange = () => {
  emit('volume-change', props.user.id, volume.value)
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

// Role management methods
const handlePromote = async () => {
  if (!canPromote.value) return
  promoting.value = true
  try {
    await apiService.promoteUser(props.user.id)
    hideContextMenu()
  } catch (error) {
    console.error('Failed to promote user:', error)
  } finally {
    promoting.value = false
  }
}

const handleDemote = async () => {
  if (!canDemote.value) return
  demoting.value = true
  try {
    await apiService.demoteUser(props.user.id)
    hideContextMenu()
  } catch (error) {
    console.error('Failed to demote user:', error)
  } finally {
    demoting.value = false
  }
}

// Close menu on escape key or document click
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    hideContextMenu()
  }
}

const handleDocumentClick = () => {
  if (showMenu.value) {
    hideContextMenu()
  }
}



onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', handleDocumentClick)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleDocumentClick)
})
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