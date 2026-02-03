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

        <div class="flex-1 min-w-0">
          <div class="font-medium text-white truncate">{{ userStore.nickname }}</div>

          <div v-if="userStore.email" class="text-sm text-gray-400 truncate">{{ userStore.email }}</div>

          <div class="flex items-center gap-2 mt-1">
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

    <!-- Logout Button for Logged In Users -->
    <div v-else class="pt-2">
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
import { useUserStore } from '@/stores'
import UserAvatar from '@/components/UserAvatar.vue'
import {
  PhUser,
  PhSignOut,
  PhCheckCircle
} from '@phosphor-icons/vue'
import DiscordIcon from '~icons/simple-icons/discord'
import GoogleIcon from '~icons/logos/google-icon'

const emit = defineEmits<{
  logout: []
}>()

const userStore = useUserStore()

async function handleLoginWithDiscord() {
  await userStore.loginWithProvider('discord')
}

async function handleLoginWithGoogle() {
  await userStore.loginWithProvider('google')
}

async function handleLogout() {
  if (confirm('This will clear your session and you\'ll need to login again. Continue?')) {
    await userStore.logout()
    emit('logout')
  }
}
</script>
