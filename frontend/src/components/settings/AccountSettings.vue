<template>
  <div class="space-y-4">
    <h3
      v-if="!hideHeader"
      class="text-lg font-medium text-theme-text-primary flex items-center gap-2">
      <PhUser class="w-5 h-5 text-theme-accent" />
      Account
    </h3>

    <!-- Account card (avatar and nickname are edited in Profile) -->
    <div class="bg-theme-bg-tertiary rounded-lg p-4">
      <div class="flex items-center gap-3">
        <UserAvatar
          class="flex-shrink-0"
          :nickname="userStore.nickname"
          :avatar-url="userStore.avatarUrl"
          :size="40"
          status="online" />

        <div class="flex-1 min-w-0">
          <div
            class="font-medium text-theme-text-primary truncate"
            :style="permissionsStore.nameStyleOf(userStore.userId)">
            {{ userStore.nickname }}
          </div>

          <div v-if="userStore.email" class="text-sm text-theme-text-muted truncate">
            {{ userStore.email }}
          </div>

          <div class="flex flex-wrap items-center gap-2 mt-1">
            <!-- Guest Badge -->
            <span
              v-if="userStore.isGuest"
              class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-theme-bg-tertiary text-theme-text-secondary">
              <PhUser class="w-3 h-3 mr-1" />
              Guest
            </span>
            <!-- Discord Badge -->
            <span
              v-else-if="userStore.authProvider === 'discord'"
              class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#5865F2] text-white">
              <DiscordIcon class="w-3 h-3 mr-1 text-white" />
              Discord
            </span>
            <!-- Google Badge -->
            <span
              v-else-if="userStore.authProvider === 'google'"
              class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white text-gray-700">
              <GoogleIcon class="w-3 h-3 mr-1" />
              Google
            </span>
            <!-- Connected Badge (for logged in users) -->
            <span
              v-if="userStore.isLoggedIn"
              class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-600 text-white">
              <PhCheckCircle class="w-3 h-3 mr-1" />
              Connected
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Login Options for Guests -->
    <div v-if="userStore.isGuest" class="space-y-3">
      <p class="text-sm text-theme-text-muted">Connect an account to unlock all features:</p>

      <button
        type="button"
        class="w-full flex items-center justify-center px-4 py-2 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-lg transition-colors duration-200 text-sm font-medium"
        @click="handleLoginWithDiscord">
        <DiscordIcon class="w-4 h-4 mr-2 text-white" />
        Login with Discord
      </button>

      <button
        type="button"
        class="w-full flex items-center justify-center px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 rounded-lg transition-colors duration-200 text-sm font-medium"
        @click="handleLoginWithGoogle">
        <GoogleIcon class="w-4 h-4 mr-2" />
        Login with Google
      </button>

      <!-- Clear Guest Data Button -->
      <div class="pt-2 border-t border-theme-border mt-4">
        <button
          type="button"
          class="w-full flex items-center justify-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors duration-200 text-sm font-medium"
          @click="handleClearGuestData">
          <PhSignOut class="w-4 h-4 mr-2" />
          Logout
        </button>

        <p class="text-xs text-theme-text-muted mt-2 text-center">
          This will remove your guest account data from this device.
        </p>
      </div>
    </div>

    <!-- Attachment storage page (opens in a new tab) -->
    <div
      v-if="configStore.attachments && !userStore.isGuest"
      class="pt-2 border-t border-theme-border mt-4">
      <button
        type="button"
        class="w-full flex items-center justify-center px-4 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover border border-theme-border text-theme-text-primary rounded-lg transition-colors duration-200 text-sm font-medium"
        data-testid="open-my-files"
        @click="openStoragePage()">
        <PhHardDrives class="w-4 h-4 mr-2" />
        My files
      </button>
      <p class="text-xs text-theme-text-muted mt-2 text-center">
        See and manage the files you attached in text channels.
      </p>
    </div>

    <!-- Admin Panel Button - owner, or users who can manage roles/audio -->
    <div v-if="canOpenAdminPanel" class="pt-2 border-t border-theme-border mt-4">
      <router-link v-slot="{ navigate }" to="/admin" custom>
        <button
          type="button"
          class="w-full flex items-center justify-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors duration-200 text-sm font-medium"
          @click="navigate">
          <PhShield class="w-4 h-4 mr-2" />
          Admin Panel
        </button>
      </router-link>

      <p class="text-xs text-theme-text-muted mt-2 text-center">
        Manage users and system settings.
      </p>
    </div>

    <!-- Logout Button for Logged In Users -->
    <div
      v-if="!userStore.isGuest"
      class="pt-2"
      :class="canOpenAdminPanel ? 'mt-4' : 'border-t border-theme-border mt-4'">
      <button
        type="button"
        class="w-full flex items-center justify-center px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors duration-200 text-sm font-medium"
        @click="handleLogout">
        <PhSignOut class="w-4 h-4 mr-2" />
        Logout
      </button>

      <p class="text-xs text-theme-text-muted mt-2 text-center">
        This will clear your session and you'll need to login again.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useConfigStore, useUserStore, usePermissionsStore } from "@/stores"
import { openStoragePage } from "@/services/attachments/urls"
import { Permission } from "@/types/permissions"
import UserAvatar from "@/components/UserAvatar.vue"
import { PhUser, PhSignOut, PhCheckCircle, PhShield, PhHardDrives } from "@phosphor-icons/vue"
import DiscordIcon from "~icons/simple-icons/discord"
import GoogleIcon from "~icons/logos/google-icon"

defineProps<{
  hideHeader?: boolean
}>()

const emit = defineEmits<{
  logout: []
}>()

const userStore = useUserStore()
const configStore = useConfigStore()
const permissionsStore = usePermissionsStore()
const canOpenAdminPanel = computed(
  () =>
    userStore.isSuperAdmin ||
    permissionsStore.can(Permission.ManageRoles) ||
    permissionsStore.can(Permission.ManageAudio) ||
    permissionsStore.can(Permission.ManageSoundboard) ||
    permissionsStore.can(Permission.ManageEmojis),
)

function handleLoginWithDiscord() {
  userStore.loginWithProvider("discord")
}

function handleLoginWithGoogle() {
  userStore.loginWithProvider("google")
}

async function handleLogout() {
  if (confirm("This will clear your session and you'll need to login again. Continue?")) {
    await userStore.logout()
    emit("logout")
  }
}

function handleClearGuestData() {
  if (confirm("This will remove your guest account data from this device. Continue?")) {
    userStore.clearUser()
    emit("logout")
  }
}
</script>
