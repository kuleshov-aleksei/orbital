<template>
  <div class="space-y-4">
    <h3 class="text-lg font-medium text-white flex items-center gap-2">
      <PhUser class="w-5 h-5 text-indigo-400" />
      Account
    </h3>

    <!-- User Info Card -->
    <div class="bg-gray-700 rounded-lg p-4">
      <div class="flex items-center gap-3">
        <UserAvatar
          :nickname="userStore.nickname"
          :avatar-url="userStore.avatarUrl"
          :size="48"
          status="online"
          class="flex-shrink-0"
        />

        <div class="flex-1 min-w-0 min-h-24">
          <!-- Nickname Display / Edit Mode -->
          <div v-if="!isEditingNickname" class="flex items-center gap-2 h-full">
            <div class="font-medium text-white truncate">{{ userStore.nickname }}</div>

            <button
              type="button"
              class="p-1 text-gray-400 hover:text-white transition-colors"
              title="Edit nickname"
              @click="startEditingNickname"
            >
              <PhPencil class="w-4 h-4" />
            </button>
          </div>

          <!-- Nickname Edit Mode -->
          <div v-else class="space-y-2">
            <input
              ref="nicknameInput"
              v-model="editedNickname"
              type="text"
              maxlength="32"
              placeholder="Enter nickname"
              class="w-full px-3 py-1.5 bg-gray-600 border border-gray-500 rounded text-white text-sm focus:outline-none focus:border-indigo-500"
              @keyup.enter="saveNickname"
              @keyup.esc="cancelEditingNickname"
            />

            <div class="flex items-center gap-2">
              <button
                type="button"
                :disabled="isSaving || !editedNickname.trim()"
                class="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                @click="saveNickname"
              >
                <span v-if="isSaving">Saving...</span>

                <span v-else>Save</span>
              </button>

              <button
                type="button"
                :disabled="isSaving"
                class="px-3 py-1 bg-gray-600 hover:bg-gray-500 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
                @click="cancelEditingNickname"
              >
                Cancel
              </button>
            </div>

            <div v-if="errorMessage" class="text-xs text-red-400">{{ errorMessage }}</div>
          </div>

          <div v-if="userStore.email" class="text-sm text-gray-400 truncate">{{ userStore.email }}</div>

          <div v-if="!isEditingNickname" class="flex items-center gap-2 mt-1">
            <!-- Guest Badge -->
            <span v-if="userStore.isGuest" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-600 text-gray-300">
              <PhUser class="w-3 h-3 mr-1" />
              Guest
            </span>
            <!-- Discord Badge -->
            <span v-else-if="userStore.authProvider === 'discord'" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#5865F2] text-white">
              <DiscordIcon class="w-3 h-3 mr-1 text-white" />
              Discord
            </span>
            <!-- Google Badge -->
            <span v-else-if="userStore.authProvider === 'google'" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white text-gray-700">
              <GoogleIcon class="w-3 h-3 mr-1" />
              Google
            </span>
            <!-- Connected Badge (for logged in users) -->
            <span v-if="userStore.isLoggedIn" class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-600 text-white">
              <PhCheckCircle class="w-3 h-3 mr-1" />
              Connected
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Login Options for Guests -->
    <div v-if="userStore.isGuest" class="space-y-3">
      <p class="text-sm text-gray-400">Connect an account to unlock all features:</p>
      
      <button
        type="button"
        class="w-full flex items-center justify-center px-4 py-2 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-lg transition-colors duration-200 text-sm font-medium"
        @click="handleLoginWithDiscord"
      >
        <DiscordIcon class="w-4 h-4 mr-2 text-white" />
        Login with Discord
      </button>

      <button
        type="button"
        class="w-full flex items-center justify-center px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 rounded-lg transition-colors duration-200 text-sm font-medium"
        @click="handleLoginWithGoogle"
      >
        <GoogleIcon class="w-4 h-4 mr-2" />
        Login with Google
      </button>
    </div>

    <!-- Admin Panel Button - Only for super admins -->
    <div v-if="userStore.isSuperAdmin" class="pt-2 border-t border-gray-600 mt-4">
      <router-link
        v-slot="{ navigate }"
        to="/admin"
        custom
      >
        <button
          type="button"
          class="w-full flex items-center justify-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors duration-200 text-sm font-medium"
          @click="navigate"
        >
          <PhShield class="w-4 h-4 mr-2" />
          Admin Panel
        </button>
      </router-link>

      <p class="text-xs text-gray-500 mt-2 text-center">Manage users and system settings.</p>
    </div>

    <!-- Logout Button for Logged In Users -->
    <div v-if="!userStore.isGuest" class="pt-2" :class="userStore.isSuperAdmin ? 'mt-4' : 'border-t border-gray-600 mt-4'">
      <button
        type="button"
        class="w-full flex items-center justify-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors duration-200 text-sm font-medium"
        @click="handleLogout"
      >
        <PhSignOut class="w-4 h-4 mr-2" />
        Logout
      </button>

      <p class="text-xs text-gray-500 mt-2 text-center">This will clear your session and you'll need to login again.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, useTemplateRef } from 'vue'
import { useUserStore } from '@/stores'
import UserAvatar from '@/components/UserAvatar.vue'
import {
  PhUser,
  PhSignOut,
  PhCheckCircle,
  PhPencil,
  PhShield
} from '@phosphor-icons/vue'
import DiscordIcon from '~icons/simple-icons/discord'
import GoogleIcon from '~icons/logos/google-icon'

const emit = defineEmits<{
  logout: []
}>()

const userStore = useUserStore()

// Nickname editing state
const isEditingNickname = ref(false)
const editedNickname = ref('')
const isSaving = ref(false)
const errorMessage = ref('')
const nicknameInput = useTemplateRef<HTMLInputElement>('nicknameInput')

function startEditingNickname() {
  editedNickname.value = userStore.nickname
  isEditingNickname.value = true
  errorMessage.value = ''
  void nextTick(() => {
    nicknameInput.value?.focus()
    nicknameInput.value?.select()
  })
}

function cancelEditingNickname() {
  isEditingNickname.value = false
  editedNickname.value = ''
  errorMessage.value = ''
}

async function saveNickname() {
  const trimmedNickname = editedNickname.value.trim()

  if (!trimmedNickname) {
    errorMessage.value = 'Nickname cannot be empty'
    return
  }

  if (trimmedNickname === userStore.nickname) {
    cancelEditingNickname()
    return
  }

  if (trimmedNickname.length > 32) {
    errorMessage.value = 'Nickname must be 32 characters or less'
    return
  }

  isSaving.value = true
  errorMessage.value = ''

  try {
    await userStore.updateNickname(trimmedNickname)
    isEditingNickname.value = false
    editedNickname.value = ''
  } catch {
    errorMessage.value = userStore.nicknameUpdateError || 'Failed to update nickname'
  } finally {
    isSaving.value = false
  }
}

function handleLoginWithDiscord() {
  userStore.loginWithProvider('discord')
}

function handleLoginWithGoogle() {
  userStore.loginWithProvider('google')
}

async function handleLogout() {
  if (confirm('This will clear your session and you\'ll need to login again. Continue?')) {
    await userStore.logout()
    emit('logout')
  }
}
</script>
