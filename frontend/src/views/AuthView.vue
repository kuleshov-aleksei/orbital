<template>
  <div class="auth-view fixed inset-0 bg-gray-900 flex items-center justify-center z-50">
    <div class="max-w-md w-full mx-4">
      <!-- Logo/Title -->
      <div class="text-center mb-8">
        <div class="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <PhPlanet class="w-12 h-12 text-white" />
        </div>

        <h1 class="text-3xl font-bold text-white mb-2">Welcome to Orbital</h1>

        <p class="text-gray-400">Voice chat for everyone</p>
      </div>

      <!-- Auth Card -->
      <div class="bg-gray-800 rounded-xl p-8 shadow-xl">
        <h2 class="text-xl font-semibold text-white text-center mb-6">Choose how to join</h2>

        <!-- OAuth Provider Buttons -->
        <div class="space-y-3 mb-6">
          <!-- Discord Login -->
          <button
            type="button"
            class="w-full flex items-center justify-center px-4 py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-lg transition-colors duration-200 font-medium"
            @click="handleLoginWithDiscord"
          >
            <DiscordIcon class="w-5 h-5 mr-3" />
            Login with Discord
          </button>

          <!-- Google Login -->
          <button
            type="button"
            class="w-full flex items-center justify-center px-4 py-3 bg-white hover:bg-gray-100 text-gray-700 rounded-lg transition-colors duration-200 font-medium"
            @click="handleLoginWithGoogle"
          >
            <GoogleIcon class="w-5 h-5 mr-3" />
            Login with Google
          </button>
        </div>

        <!-- Divider -->
        <div class="relative mb-6">
          <div class="absolute inset-0 flex items-center">
            <div class="w-full border-t border-gray-700"></div>
          </div>

          <div class="relative flex justify-center text-sm">
            <span class="px-2 bg-gray-800 text-gray-500">or</span>
          </div>
        </div>

        <!-- Guest Option -->
        <button
          type="button"
          class="w-full flex items-center justify-center px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors duration-200 font-medium"
          @click="handleContinueAsGuest"
        >
          <PhUser class="w-5 h-5 mr-3" />
          Continue as Guest
        </button>

        <!-- Restriction Notice -->
        <div class="mt-6 flex items-start text-sm text-gray-400">
          <PhLock class="w-4 h-4 mr-2 mt-0.5 flex-shrink-0 text-gray-500" />

          <span>Some features are restricted for guests, like screensharing</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useUserStore } from '@/stores'
import {
  PhPlanet,
  PhUser,
  PhLock
} from '@phosphor-icons/vue'
import DiscordIcon from '~icons/simple-icons/discord'
import GoogleIcon from '~icons/logos/google-icon'

const userStore = useUserStore()

const handleLoginWithDiscord = async () => {
  await userStore.loginWithProvider('discord')
}

const handleLoginWithGoogle = async () => {
  await userStore.loginWithProvider('google')
}

const handleContinueAsGuest = async () => {
  await userStore.continueAsGuest()
}
</script>
