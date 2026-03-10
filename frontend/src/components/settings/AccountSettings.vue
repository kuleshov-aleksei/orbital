<template>
  <div class="space-y-4">
    <h3 class="text-lg font-medium text-theme-text-primary flex items-center gap-2">
      <PhUser class="w-5 h-5 text-theme-accent" />
      Account
    </h3>

    <!-- User Info Card -->
    <div class="bg-theme-bg-tertiary rounded-lg p-4">
      <div class="flex items-center gap-3">
        <div class="relative flex-shrink-0">
          <UserAvatar
            :nickname="userStore.nickname"
            :avatar-url="userStore.avatarUrl"
            :size="48"
            status="online"
            :class="{ 'opacity-50': isUploadingAvatar }" />
          <!-- Avatar upload overlay for logged-in users -->
          <button
            v-if="userStore.isLoggedIn && !isUploadingAvatar"
            type="button"
            class="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
            title="Change avatar"
            @click="triggerAvatarUpload">
            <PhCamera class="w-5 h-5 text-white" />
          </button>
          <!-- Loading spinner during upload -->
          <div
            v-if="isUploadingAvatar"
            class="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
            <PhSpinner class="w-5 h-5 text-white animate-spin" />
          </div>
          <!-- Hidden file input -->
          <input
            ref="avatarInput"
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            class="hidden"
            @change="handleAvatarChange" />
        </div>

        <div class="flex-1 min-w-0 min-h-24">
          <!-- Nickname Display / Edit Mode -->
          <div v-if="!isEditingNickname" class="flex items-center gap-2 h-full">
            <div class="font-medium text-theme-text-primary truncate">
              {{ userStore.nickname }}
            </div>

            <button
              type="button"
              class="p-1 text-theme-text-muted hover:text-theme-text-primary transition-colors"
              title="Edit nickname"
              @click="startEditingNickname">
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
              class="w-full px-3 py-1.5 bg-theme-bg-primary border border-theme-border rounded text-theme-text-primary text-sm focus:outline-none focus:border-theme-accent"
              @keyup.enter="saveNickname"
              @keyup.esc="cancelEditingNickname" />

            <div class="flex items-center gap-2">
              <button
                type="button"
                :disabled="isSaving || !editedNickname.trim()"
                class="px-3 py-1 bg-theme-accent hover:bg-theme-accent/80 disabled:bg-theme-bg-tertiary disabled:cursor-not-allowed text-theme-text-on-accent text-xs rounded transition-colors"
                @click="saveNickname">
                <span v-if="isSaving">Saving...</span>

                <span v-else>Save</span>
              </button>

              <button
                type="button"
                :disabled="isSaving"
                class="px-3 py-1 bg-theme-bg-tertiary hover:bg-theme-bg-secondary disabled:cursor-not-allowed text-theme-text-primary text-xs rounded transition-colors"
                @click="cancelEditingNickname">
                Cancel
              </button>
            </div>

            <div v-if="errorMessage" class="text-xs text-red-400">
              {{ errorMessage }}
            </div>
          </div>

          <!-- Avatar upload error -->
          <div v-if="avatarError" class="text-xs text-red-400 mt-2">
            {{ avatarError }}
          </div>

          <div v-if="userStore.email" class="text-sm text-theme-text-muted truncate">
            {{ userStore.email }}
          </div>

          <div v-if="!isEditingNickname" class="flex items-center gap-2 mt-1">
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

    <!-- Admin Panel Button - Only for super admins -->
    <div v-if="userStore.isSuperAdmin" class="pt-2 border-t border-theme-border mt-4">
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
      :class="userStore.isSuperAdmin ? 'mt-4' : 'border-t border-theme-border mt-4'">
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

    <!-- Avatar Crop Modal -->
    <AvatarCropModal
      v-if="showCropModal"
      :image-src="cropImageSrc"
      @close="closeCropModal"
      @upload="handleCroppedUpload" />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, useTemplateRef } from "vue"
import { useUserStore } from "@/stores"
import UserAvatar from "@/components/UserAvatar.vue"
import AvatarCropModal from "@/components/AvatarCropModal.vue"
import {
  PhUser,
  PhSignOut,
  PhCheckCircle,
  PhPencil,
  PhShield,
  PhCamera,
  PhSpinner,
} from "@phosphor-icons/vue"
import DiscordIcon from "~icons/simple-icons/discord"
import GoogleIcon from "~icons/logos/google-icon"

const emit = defineEmits<{
  logout: []
}>()

const userStore = useUserStore()

// Nickname editing state
const isEditingNickname = ref(false)
const editedNickname = ref("")
const isSaving = ref(false)
const errorMessage = ref("")
const nicknameInput = useTemplateRef<HTMLInputElement>("nicknameInput")

// Avatar upload state
const avatarInput = useTemplateRef<HTMLInputElement>("avatarInput")
const isUploadingAvatar = ref(false)
const avatarError = ref("")

// Avatar crop modal state
const showCropModal = ref(false)
const cropImageSrc = ref("")

function startEditingNickname() {
  editedNickname.value = userStore.nickname
  isEditingNickname.value = true
  errorMessage.value = ""
  void nextTick(() => {
    nicknameInput.value?.focus()
    nicknameInput.value?.select()
  })
}

function cancelEditingNickname() {
  isEditingNickname.value = false
  editedNickname.value = ""
  errorMessage.value = ""
}

async function saveNickname() {
  const trimmedNickname = editedNickname.value.trim()

  if (!trimmedNickname) {
    errorMessage.value = "Nickname cannot be empty"
    return
  }

  if (trimmedNickname === userStore.nickname) {
    cancelEditingNickname()
    return
  }

  if (trimmedNickname.length > 32) {
    errorMessage.value = "Nickname must be 32 characters or less"
    return
  }

  isSaving.value = true
  errorMessage.value = ""

  try {
    await userStore.updateNickname(trimmedNickname)
    isEditingNickname.value = false
    editedNickname.value = ""
  } catch {
    errorMessage.value = userStore.nicknameUpdateError || "Failed to update nickname"
  } finally {
    isSaving.value = false
  }
}

function triggerAvatarUpload() {
  avatarError.value = ""
  avatarInput.value?.click()
}

async function handleAvatarChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  // Validate file type
  const validTypes = ["image/png", "image/jpeg", "image/jpg"]
  if (!validTypes.includes(file.type)) {
    avatarError.value = "Only PNG and JPG files are allowed"
    return
  }

  // Validate file size (5MB)
  if (file.size > 5 * 1024 * 1024) {
    avatarError.value = "File size must be less than 5MB"
    return
  }

  // Read file and show crop modal
  const reader = new FileReader()
  reader.onload = (e) => {
    cropImageSrc.value = e.target?.result as string
    showCropModal.value = true
  }
  reader.onerror = () => {
    avatarError.value = "Failed to read file"
  }
  reader.readAsDataURL(file)

  // Reset input so same file can be selected again
  if (target) {
    target.value = ""
  }
}

function closeCropModal() {
  showCropModal.value = false
  cropImageSrc.value = ""
}

async function handleCroppedUpload(blob: Blob) {
  isUploadingAvatar.value = true
  avatarError.value = ""
  closeCropModal()

  try {
    await userStore.updateAvatar(blob as File)
  } catch {
    avatarError.value = userStore.avatarUpdateError || "Failed to upload avatar"
  } finally {
    isUploadingAvatar.value = false
  }
}

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
