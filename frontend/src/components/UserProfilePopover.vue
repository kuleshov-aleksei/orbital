<template>
  <Teleport to="body">
    <div
      v-if="user && anchor"
      ref="popoverRef"
      class="fixed z-50 w-86 max-w-[calc(100vw-16px)] rounded-xl overflow-hidden bg-theme-bg-secondary border border-theme-border shadow-2xl"
      :style="positionStyle"
      role="dialog"
      :aria-label="`${user.nickname} profile`"
      data-testid="user-profile-popover">
      <!-- Banner -->
      <div class="h-16 bg-theme-accent opacity-80"></div>

      <!-- Avatar overlapping banner -->
      <div class="px-4 -mt-9 flex items-end justify-between">
        <div class="rounded-full p-1 bg-theme-bg-secondary">
          <UserAvatar
            :user-id="user.id"
            :nickname="user.nickname"
            :avatar-url="user.avatar_url"
            :status="status"
            :size="72"
            :grayscale="!user.is_online" />
        </div>
        <span
          v-if="roleLabel"
          class="mb-1 px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-theme-bg-tertiary text-theme-text-secondary">
          {{ roleLabel }}
        </span>
      </div>

      <div class="p-3 pt-2">
        <div class="rounded-lg bg-theme-bg-tertiary p-3 space-y-3">
          <!-- Name -->
          <div>
            <input
              v-if="isEditingNickname"
              ref="nicknameInput"
              v-model="nicknameDraft"
              type="text"
              maxlength="32"
              class="w-full px-2 py-1 text-base font-semibold bg-theme-bg-primary border border-theme-border rounded focus:outline-none focus:border-theme-accent text-theme-text-primary"
              @blur="saveNickname"
              @keydown.enter="saveNickname"
              @keydown.escape.stop="isEditingNickname = false" />
            <button
              v-else-if="isSelf"
              type="button"
              class="group/name flex items-center gap-1.5 max-w-full text-left"
              title="Edit nickname"
              @click="startEditingNickname">
              <span class="text-lg font-semibold text-theme-text-primary truncate">
                {{ user.nickname }}
              </span>
              <PhPencilSimple
                class="w-3.5 h-3.5 flex-shrink-0 text-theme-text-muted opacity-0 group-hover/name:opacity-100 transition-opacity" />
            </button>
            <div v-else class="text-lg font-semibold text-theme-text-primary truncate">
              {{ user.nickname }}
            </div>
            <div class="text-xs text-theme-text-muted">{{ presenceLabel }}</div>
          </div>

          <!-- Custom status -->
          <div v-if="isEditingStatus">
            <div class="relative">
              <button
                type="button"
                class="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded hover:bg-theme-bg-hover transition-colors"
                :class="{ 'bg-theme-bg-hover': isPickerOpen }"
                :title="emojiDraft ? 'Change emoji' : 'Add emoji'"
                :aria-expanded="isPickerOpen"
                data-testid="custom-status-emoji-button"
                @mousedown.prevent
                @click="togglePicker">
                <EmojiGlyph v-if="emojiDraft" :emoji-ref="emojiDraft" :size="16" />
                <PhSmiley v-else class="w-4 h-4 text-theme-text-muted" />
              </button>
              <input
                ref="statusInput"
                v-model="statusDraft"
                type="text"
                :maxlength="MAX_STATUS_LENGTH"
                placeholder="What's up?"
                class="w-full pl-8 pr-8 py-1.5 text-sm bg-theme-bg-primary border border-theme-border rounded focus:outline-none focus:border-theme-accent text-theme-text-primary"
                data-testid="custom-status-input"
                @keydown.enter="saveStatus"
                @keydown.escape.stop="cancelStatus" />
              <button
                v-if="statusDraft || emojiDraft"
                type="button"
                class="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-theme-text-muted hover:text-theme-text-primary"
                title="Clear"
                @mousedown.prevent
                @click="clearDraft">
                <PhX class="w-3.5 h-3.5" />
              </button>
            </div>
            <EmojiPicker
              v-if="isPickerOpen"
              class="mt-1.5"
              @select="selectEmoji"
              @close="closePicker" />
            <div class="mt-1.5 flex items-center justify-between text-[11px] text-theme-text-muted">
              <span>{{ statusDraft.length }}/{{ MAX_STATUS_LENGTH }}</span>
              <div class="flex gap-2">
                <button type="button" class="hover:text-theme-text-primary" @click="cancelStatus">
                  Cancel
                </button>
                <button
                  type="button"
                  class="font-semibold text-theme-accent hover:text-theme-accent-hover disabled:opacity-50"
                  :disabled="isSavingStatus"
                  @click="saveStatus">
                  {{ isSavingStatus ? "Saving…" : "Save" }}
                </button>
              </div>
            </div>
            <div v-if="statusError" class="mt-1 text-[11px] text-red-400">{{ statusError }}</div>
          </div>
          <button
            v-else-if="isSelf"
            type="button"
            class="w-full flex items-start gap-2 text-left text-sm rounded px-2 py-1.5 -mx-2 hover:bg-theme-bg-hover transition-colors"
            data-testid="custom-status-edit"
            @click="startEditingStatus">
            <EmojiGlyph
              v-if="user.custom_status_emoji"
              :emoji-ref="user.custom_status_emoji"
              :size="16"
              class="mt-0.5 flex-shrink-0" />
            <PhChatCircleDots v-else class="w-4 h-4 mt-0.5 flex-shrink-0 text-theme-text-muted" />
            <span v-if="hasStatus" class="text-theme-text-primary break-words min-w-0">{{
              user.custom_status
            }}</span>
            <span v-else class="text-theme-text-muted">Set a custom status</span>
          </button>
          <p
            v-else-if="hasStatus"
            class="flex items-start gap-2 text-sm text-theme-text-primary break-words"
            data-testid="custom-status-text">
            <EmojiGlyph
              v-if="user.custom_status_emoji"
              :emoji-ref="user.custom_status_emoji"
              :size="16"
              class="mt-0.5 flex-shrink-0" />
            <span class="min-w-0">{{ user.custom_status }}</span>
          </p>

          <!-- Stats -->
          <div class="border-t border-theme-border pt-3 space-y-2">
            <div v-if="memberSince">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-theme-text-muted">
                Member since
              </div>
              <div class="text-sm text-theme-text-secondary" :title="memberSinceTitle">
                {{ memberSince }}
              </div>
            </div>
            <div v-if="userRoles.length || canEditRoles" data-testid="profile-roles">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-theme-text-muted">
                Roles
              </div>
              <div class="mt-1 flex flex-wrap gap-1">
                <span
                  v-for="r in userRoles"
                  :key="r.id"
                  class="group/role inline-flex items-center gap-1.5 max-w-full px-2 py-0.5 rounded bg-theme-bg-primary border border-theme-border text-xs text-theme-text-secondary">
                  <button
                    v-if="canEditRoles && permissionsStore.canManageRole(r)"
                    type="button"
                    class="relative w-2.5 h-2.5 rounded-full flex-shrink-0 flex items-center justify-center"
                    :style="{ backgroundColor: r.color || 'var(--color-text-muted, #9ca3af)' }"
                    :title="`Remove ${r.name}`"
                    :aria-label="`Remove role ${r.name}`"
                    :disabled="savingRoles"
                    :data-testid="`profile-role-remove-${r.id}`"
                    @click="toggleRole(r.id)">
                    <PhX
                      class="w-2.5 h-2.5 text-white opacity-0 group-hover/role:opacity-100 transition-opacity" />
                  </button>
                  <span
                    v-else
                    class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    :style="{ backgroundColor: r.color || 'var(--color-text-muted, #9ca3af)' }" />
                  <span class="truncate">{{ r.name }}</span>
                </span>
                <button
                  v-if="canEditRoles && addableRoles.length"
                  type="button"
                  class="inline-flex items-center justify-center w-6 h-[22px] rounded bg-theme-bg-primary border border-theme-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
                  title="Add role"
                  aria-label="Add role"
                  :aria-expanded="isRolePickerOpen"
                  data-testid="profile-role-add"
                  @click="toggleRolePicker">
                  <PhPlus class="w-3 h-3" />
                </button>
              </div>
              <div
                v-if="isRolePickerOpen"
                class="mt-1.5 max-h-40 overflow-y-auto rounded border border-theme-border bg-theme-bg-primary py-1"
                data-testid="profile-role-picker">
                <button
                  v-for="r in addableRoles"
                  :key="r.id"
                  type="button"
                  class="w-full px-2 py-1 flex items-center gap-2 text-left text-xs text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="savingRoles || !permissionsStore.canManageRole(r)"
                  :title="
                    permissionsStore.canManageRole(r)
                      ? undefined
                      : 'This role is above your highest role'
                  "
                  @click="addRole(r.id)">
                  <span
                    class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    :style="{ backgroundColor: r.color || 'var(--color-text-muted, #9ca3af)' }" />
                  <span class="truncate">{{ r.name }}</span>
                </button>
              </div>
              <div v-if="rolesError" class="mt-1 text-[11px] text-red-400">{{ rolesError }}</div>
            </div>
            <div v-if="voiceRoom">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-theme-text-muted">
                In voice
              </div>
              <div class="flex items-center gap-1.5 text-sm text-theme-text-secondary">
                <PhSpeakerHigh class="w-3.5 h-3.5 text-green-400" />
                <span class="truncate">{{ voiceRoom.name }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted, useTemplateRef } from "vue"
import {
  PhChatCircleDots,
  PhPencilSimple,
  PhPlus,
  PhSmiley,
  PhSpeakerHigh,
  PhX,
} from "@phosphor-icons/vue"
import UserAvatar from "@/components/UserAvatar.vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import EmojiPicker from "@/components/EmojiPicker.vue"
import type { EmojiRef } from "@/services/emoji"
import { useUserStore, useUsersStore, useRoomStore, usePermissionsStore } from "@/stores"
import type { PublicUser } from "@/types"

const props = defineProps<{
  userId: string | null
  // Element the popover is attached to (the clicked user row)
  anchor: HTMLElement | null
}>()
const emit = defineEmits<{ close: [] }>()
// Must match models.MaxCustomStatusLength on the backend
const MAX_STATUS_LENGTH = 128
const POPOVER_GAP = 8
const VIEWPORT_MARGIN = 8

const userStore = useUserStore()
const usersStore = useUsersStore()
const permissionsStore = usePermissionsStore()
const roomStore = useRoomStore()

const popoverRef = useTemplateRef<HTMLElement>("popoverRef")
const statusInput = useTemplateRef<HTMLInputElement>("statusInput")
const nicknameInput = useTemplateRef<HTMLInputElement>("nicknameInput")

const isSelf = computed(() => !!props.userId && props.userId === userStore.userId)

// Read from the store so live updates (status/nickname changes) show while open
const user = computed<PublicUser | null>(() => {
  if (!props.userId) return null
  const found = usersStore.allUsers.find((u) => u.id === props.userId)
  if (!found) return null
  return isSelf.value ? { ...found, nickname: userStore.nickname } : found
})

const hasStatus = computed(() => !!(user.value?.custom_status || user.value?.custom_status_emoji))

const status = computed(() => (user.value?.is_online ? "online" : "offline"))

const presenceLabel = computed(() => (user.value?.is_online ? "Online" : "Offline"))

// Account kind badge; assigned roles are listed separately below.
const roleLabel = computed(() => {
  if (!user.value) return ""
  if (user.value.role === "super_admin") return "Owner"
  return user.value.role === "guest" ? "Guest" : ""
})

// Assigned roles, highest first (Discord-like role list).
const userRoles = computed(() => (user.value ? permissionsStore.rolesOf(user.value.id) : []))

// --- Role assignment (manage_roles; the backend enforces the hierarchy)
const canEditRoles = computed(
  () => !!user.value && permissionsStore.canEditRolesOf(user.value.role === "super_admin"),
)
const addableRoles = computed(() => {
  const held = new Set(userRoles.value.map((r) => r.id))
  return permissionsStore.customRoles.filter((r) => !held.has(r.id))
})
const isRolePickerOpen = ref(false)
const savingRoles = ref(false)
const rolesError = ref("")

const toggleRolePicker = async () => {
  isRolePickerOpen.value = !isRolePickerOpen.value
  await nextTick()
  updatePosition()
}

const toggleRole = async (roleId: string) => {
  if (!user.value) return
  savingRoles.value = true
  rolesError.value = ""
  try {
    await permissionsStore.toggleUserRole(user.value.id, roleId)
  } catch (error) {
    rolesError.value = (error as Error).message || "Failed to update roles"
  } finally {
    savingRoles.value = false
  }
}

const addRole = async (roleId: string) => {
  await toggleRole(roleId)
  if (!rolesError.value) isRolePickerOpen.value = false
  await nextTick()
  updatePosition()
}

const createdAt = computed(() => {
  const raw = user.value?.created_at
  if (!raw) return null
  const date = new Date(raw)
  // Go zero time (0001-01-01) means the field was never set
  if (isNaN(date.getTime()) || date.getFullYear() < 2000) return null
  return date
})

const memberSince = computed(() =>
  createdAt.value?.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }),
)

const memberSinceTitle = computed(() => createdAt.value?.toLocaleString())

const voiceRoom = computed(() => {
  if (!props.userId) return null
  return roomStore.rooms.find((r) => r.users?.some((u) => u.id === props.userId)) ?? null
})

// --- Positioning: to the left of the anchor (sidebar is on the right), clamped to viewport
const position = ref({ top: 0, left: 0 })
const positionStyle = computed(() => ({
  top: `${position.value.top}px`,
  left: `${position.value.left}px`,
}))

const updatePosition = () => {
  const anchorEl = props.anchor
  const el = popoverRef.value
  if (!anchorEl || !el) return
  const rect = anchorEl.getBoundingClientRect()
  const width = el.offsetWidth
  const height = el.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight

  let left = rect.left - width - POPOVER_GAP
  if (left < VIEWPORT_MARGIN) {
    // Not enough room on the left (mobile): try the right side, else center
    const right = rect.right + POPOVER_GAP
    left = right + width <= vw - VIEWPORT_MARGIN ? right : (vw - width) / 2
  }
  const top = Math.min(Math.max(rect.top, VIEWPORT_MARGIN), vh - height - VIEWPORT_MARGIN)
  position.value = { top: Math.max(top, VIEWPORT_MARGIN), left: Math.max(left, VIEWPORT_MARGIN) }
}

// --- Dismissal
const onPointerDown = (event: PointerEvent) => {
  const target = event.target as Node
  if (popoverRef.value?.contains(target)) return
  // Clicks on the anchor are handled by the owner (toggle)
  if (props.anchor?.contains(target)) return
  emit("close")
}

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape") emit("close")
}

const addListeners = () => {
  document.addEventListener("pointerdown", onPointerDown, true)
  document.addEventListener("keydown", onKeyDown)
  window.addEventListener("resize", updatePosition)
  window.addEventListener("scroll", updatePosition, true)
}

const removeListeners = () => {
  document.removeEventListener("pointerdown", onPointerDown, true)
  document.removeEventListener("keydown", onKeyDown)
  window.removeEventListener("resize", updatePosition)
  window.removeEventListener("scroll", updatePosition, true)
}

// --- Self editing
const isEditingStatus = ref(false)
const isSavingStatus = ref(false)
const statusDraft = ref("")
const emojiDraft = ref<EmojiRef>("")
const isPickerOpen = ref(false)
const statusError = ref<string | null>(null)
const isEditingNickname = ref(false)
const nicknameDraft = ref("")

const resetEditing = () => {
  isEditingStatus.value = false
  isEditingNickname.value = false
  isPickerOpen.value = false
  statusError.value = null
}

const setPickerOpen = (open: boolean) => {
  isPickerOpen.value = open
  // Picker changes the popover height; keep it inside the viewport
  void nextTick(updatePosition)
}

const togglePicker = () => setPickerOpen(!isPickerOpen.value)

const closePicker = () => {
  setPickerOpen(false)
  statusInput.value?.focus()
}

const selectEmoji = (emojiRef: EmojiRef) => {
  emojiDraft.value = emojiRef
  closePicker()
}

const clearDraft = () => {
  statusDraft.value = ""
  emojiDraft.value = ""
}

const startEditingStatus = () => {
  statusDraft.value = user.value?.custom_status ?? ""
  emojiDraft.value = user.value?.custom_status_emoji ?? ""
  isPickerOpen.value = false
  statusError.value = null
  isEditingStatus.value = true
  void nextTick(() => {
    statusInput.value?.focus()
    updatePosition()
  })
}

const cancelStatus = () => {
  isEditingStatus.value = false
  isPickerOpen.value = false
  statusError.value = null
  void nextTick(updatePosition)
}

const saveStatus = async () => {
  if (!props.userId || isSavingStatus.value) return
  const next = statusDraft.value.trim()
  const nextEmoji = emojiDraft.value
  if (
    next === (user.value?.custom_status ?? "") &&
    nextEmoji === (user.value?.custom_status_emoji ?? "")
  ) {
    cancelStatus()
    return
  }
  isSavingStatus.value = true
  statusError.value = null
  try {
    await usersStore.setMyCustomStatus(props.userId, next, nextEmoji)
    cancelStatus()
  } catch (error) {
    console.error("Failed to update custom status:", error)
    statusError.value = "Couldn't save status. Try again."
  } finally {
    isSavingStatus.value = false
  }
}

const startEditingNickname = () => {
  nicknameDraft.value = user.value?.nickname ?? ""
  isEditingNickname.value = true
  void nextTick(() => {
    nicknameInput.value?.focus()
    nicknameInput.value?.select()
  })
}

const saveNickname = async () => {
  if (!isEditingNickname.value) return
  isEditingNickname.value = false
  const trimmed = nicknameDraft.value.trim()
  if (trimmed && trimmed !== user.value?.nickname) {
    await userStore.updateNickname(trimmed)
  }
}

watch(
  () => [props.userId, props.anchor] as const,
  ([userId, anchorEl]) => {
    resetEditing()
    isRolePickerOpen.value = false
    rolesError.value = ""
    removeListeners()
    if (userId && anchorEl) {
      addListeners()
      void nextTick(updatePosition)
    }
  },
  { immediate: true },
)

// Close if the user disappears from the list
watch(user, (u) => {
  if (props.userId && !u) emit("close")
})

onUnmounted(removeListeners)
</script>
