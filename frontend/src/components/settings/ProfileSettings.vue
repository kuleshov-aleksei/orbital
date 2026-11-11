<template>
  <div class="space-y-4">
    <h3
      v-if="!hideHeader"
      class="text-lg font-medium text-theme-text-primary flex items-center gap-2">
      <PhUserCircle class="w-5 h-5 text-theme-accent" />
      Profile
    </h3>

    <!-- Avatar + nickname -->
    <div class="bg-theme-bg-tertiary rounded-lg p-4">
      <div class="flex items-center gap-3">
        <div class="relative flex-shrink-0">
          <UserAvatar
            :nickname="userStore.nickname"
            :avatar-url="userStore.avatarUrl"
            :size="64"
            status="online"
            :class="{ 'opacity-50': isUploadingAvatar }" />
          <!-- Avatar upload overlay for logged-in users -->
          <button
            v-if="userStore.isLoggedIn && !isUploadingAvatar"
            type="button"
            class="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer"
            title="Change avatar"
            aria-label="Change avatar"
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

        <div class="flex-1 min-w-0">
          <!-- Nickname Display / Edit Mode -->
          <div v-if="!isEditingNickname" class="flex items-center gap-2">
            <div
              class="font-medium text-theme-text-primary truncate"
              data-testid="profile-nickname"
              :style="permissionsStore.nameStyleOf(userStore.userId)">
              {{ userStore.nickname }}
            </div>

            <button
              type="button"
              class="p-1 text-theme-text-muted hover:text-theme-text-primary transition-colors"
              title="Edit nickname"
              aria-label="Edit nickname"
              @click="startEditingNickname">
              <PhPencil class="w-4 h-4" />
            </button>
          </div>

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

          <p
            v-if="userStore.isLoggedIn && !isEditingNickname"
            class="text-xs text-theme-text-muted mt-1">
            Click the avatar to change it (PNG or JPG, up to 5MB).
          </p>

          <!-- Avatar upload error -->
          <div v-if="avatarError" class="text-xs text-red-400 mt-1">
            {{ avatarError }}
          </div>
        </div>
      </div>
    </div>

    <!-- Name colour: which held role colours the nickname -->
    <div v-if="!userStore.isGuest" class="space-y-3 pt-2">
      <div>
        <span class="text-sm font-medium text-theme-text-primary block">Name color</span>
        <p class="text-xs text-theme-text-muted mt-0.5">
          Choose which of your roles colors your name.
        </p>
      </div>

      <p
        v-if="colorableRoles.length < 2"
        class="text-xs text-theme-text-muted bg-theme-bg-tertiary rounded-lg p-3"
        data-testid="name-color-hint">
        {{
          colorableRoles.length === 0
            ? "None of your roles has a color."
            : `Your name uses the color of your only colored role, ${colorableRoles[0]!.name}.`
        }}
      </p>

      <div v-else class="space-y-2" role="radiogroup" aria-label="Name color">
        <button
          v-for="option in colorOptions"
          :key="option.id"
          type="button"
          role="radio"
          :aria-checked="selectedColorRole === option.id"
          :disabled="isSavingColor"
          class="w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all duration-200 disabled:cursor-wait"
          :class="
            selectedColorRole === option.id
              ? 'border-theme-accent bg-theme-accent/10'
              : 'border-theme-border hover:border-theme-bg-hover hover:bg-theme-bg-hover'
          "
          :data-testid="`name-color-option-${option.id || 'auto'}`"
          @click="pickColorRole(option.id)">
          <span
            class="w-5 h-5 rounded-full flex-shrink-0 border border-theme-border"
            :style="{ backgroundColor: option.color }"></span>

          <div class="flex-1 min-w-0 text-left">
            <div class="text-sm font-medium truncate" :style="{ color: option.color }">
              {{ userStore.nickname }}
            </div>
            <div class="text-xs text-theme-text-muted mt-0.5 truncate">{{ option.label }}</div>
          </div>

          <div
            v-if="selectedColorRole === option.id"
            class="w-5 h-5 rounded-full bg-theme-accent flex items-center justify-center flex-shrink-0">
            <PhCheck class="w-3 h-3 text-white" />
          </div>
        </button>
      </div>

      <div v-if="colorError" class="text-xs text-red-400">{{ colorError }}</div>
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
import { ref, computed, nextTick, useTemplateRef } from "vue"
import { useUserStore, usePermissionsStore } from "@/stores"
import UserAvatar from "@/components/UserAvatar.vue"
import AvatarCropModal from "@/components/AvatarCropModal.vue"
import { PhUserCircle, PhPencil, PhCamera, PhSpinner, PhCheck } from "@phosphor-icons/vue"

defineProps<{
  hideHeader?: boolean
}>()

const userStore = useUserStore()
const permissionsStore = usePermissionsStore()

// ---- Name colour -----------------------------------------------------------

const colorableRoles = computed(() => permissionsStore.colorableRolesOf(userStore.userId))

/** Current pick; a stale pick (role lost) shows as automatic, like colorOf. */
const selectedColorRole = computed(() => {
  const picked = permissionsStore.colorRoleOf(userStore.userId)
  return colorableRoles.value.some((r) => r.id === picked) ? picked : ""
})

const colorOptions = computed(() => {
  const highest = colorableRoles.value[0]
  return [
    {
      id: "",
      label: highest ? `Automatic (highest role: ${highest.name})` : "Automatic",
      color: highest?.color ?? "",
    },
    ...colorableRoles.value.map((r) => ({ id: r.id, label: r.name, color: r.color })),
  ]
})

const isSavingColor = ref(false)
const colorError = ref("")

async function pickColorRole(roleId: string) {
  if (roleId === selectedColorRole.value || isSavingColor.value) return
  isSavingColor.value = true
  colorError.value = ""
  try {
    await permissionsStore.setMyColorRole(roleId || null)
  } catch {
    colorError.value = "Failed to update name color"
  } finally {
    isSavingColor.value = false
  }
}

// ---- Nickname --------------------------------------------------------------

const isEditingNickname = ref(false)
const editedNickname = ref("")
const isSaving = ref(false)
const errorMessage = ref("")
const nicknameInput = useTemplateRef<HTMLInputElement>("nicknameInput")

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

// ---- Avatar ----------------------------------------------------------------

const avatarInput = useTemplateRef<HTMLInputElement>("avatarInput")
const isUploadingAvatar = ref(false)
const avatarError = ref("")
const showCropModal = ref(false)
const cropImageSrc = ref("")

function triggerAvatarUpload() {
  avatarError.value = ""
  avatarInput.value?.click()
}

async function handleAvatarChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const validTypes = ["image/png", "image/jpeg", "image/jpg"]
  if (!validTypes.includes(file.type)) {
    avatarError.value = "Only PNG and JPG files are allowed"
    return
  }

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
  target.value = ""
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
</script>
