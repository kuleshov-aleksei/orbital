<template>
  <div
    class="user-sidebar flex flex-col fixed lg:relative inset-y-0 right-0 z-40 lg:z-auto transition-all duration-300 bg-theme-bg-secondary"
    data-testid="user-sidebar"
    :class="sidebarClasses">
    <!-- Mobile Close Button -->
    <div class="lg:hidden flex items-center justify-between p-4 border-b border-theme-border">
      <h2 class="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">
        Users
      </h2>

      <button
        type="button"
        class="p-1 text-theme-text-muted hover:text-theme-text-primary"
        @click="$emit('close-mobile-sidebar')">
        <PhCaretDoubleRight class="w-5 h-5" />
      </button>
    </div>

    <!-- Desktop Header -->
    <div
      class="hidden lg:flex items-center h-16 justify-between p-3 border-b border-theme-border"
      :class="{ 'justify-center': isCollapsed }">
      <h2
        v-if="!isCollapsed"
        class="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">
        Users
      </h2>

      <!-- Toggle Button - Integrated into header -->
      <button
        type="button"
        class="flex items-center justify-center w-7 h-7 rounded-md bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-muted hover:text-theme-text-primary transition-all duration-200"
        :class="{ 'rotate-180': isCollapsed }"
        :title="isCollapsed ? 'Expand' : 'Collapse'"
        @click="toggleCollapse">
        <PhCaretDoubleRight class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- User List grouped by online status (hidden when collapsed) -->
    <div v-if="!isCollapsed" class="flex-1 overflow-y-auto p-2" data-testid="user-list">
      <section
        v-for="group in userGroups"
        :key="group.key"
        class="mb-3 last:mb-0"
        :data-testid="`user-group-${group.key}`">
        <h3
          class="px-2 pt-2 pb-1 text-xs font-semibold text-theme-text-muted uppercase tracking-wider">
          {{ group.label }} — {{ group.users.length }}
        </h3>
        <UserCard
          v-for="user in group.users"
          :key="user.id"
          :user="user"
          :room-id="props.roomId"
          :initial-volume="getInitialVolume(user.id)"
          @volume-change="handleVolumeChange"
          @open-profile="toggleProfile" />
      </section>
    </div>

    <!-- Collapsed state - show compact user avatars -->
    <div v-else class="flex-1 overflow-y-auto py-2 px-1 flex flex-col items-center gap-2">
      <!-- Show first 15 users (to prevent overcrowding) -->
      <div
        v-for="user in displayedUsers"
        :key="user.id"
        class="relative group cursor-pointer"
        :title="user.nickname"
        role="button"
        tabindex="0"
        @click="toggleProfile(user.id, $event.currentTarget as HTMLElement)"
        @keydown.enter.prevent="toggleProfile(user.id, $event.currentTarget as HTMLElement)">
        <UserAvatar
          :user-id="user.id"
          :nickname="user.nickname"
          :avatar-url="user.avatar_url"
          :size="28"
          :show-status="false"
          :grayscale="!user.is_online" />
        <!-- Speaking indicator ring -->
        <div
          v-if="user.is_speaking"
          class="absolute inset-0 rounded-full ring-2 ring-green-400 ring-offset-2 ring-offset-theme-bg-secondary"></div>
      </div>
      <!-- Show "+X" if there are more users -->
      <div
        v-if="remainingUsersCount > 0"
        class="w-7 h-7 rounded-full bg-theme-bg-tertiary flex items-center justify-center text-xs font-medium text-theme-text-muted hover:bg-theme-bg-hover hover:text-theme-text-primary transition-colors cursor-pointer"
        :title="`${remainingUsersCount} more users`"
        @click="toggleCollapse">
        +{{ remainingUsersCount }}
      </div>
    </div>

    <UserProfilePopover :user-id="profileUserId" :anchor="profileAnchor" @close="closeProfile" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue"
import UserCard from "@/components/UserCard.vue"
import UserProfilePopover from "@/components/UserProfilePopover.vue"
import UserAvatar from "@/components/UserAvatar.vue"
import { PhCaretDoubleRight } from "@phosphor-icons/vue"
import { useUserStore } from "@/stores"

interface User {
  id: string
  nickname: string
  avatar_url?: string
  is_speaking?: boolean
  is_muted?: boolean
  is_deafened?: boolean
  is_online: boolean
  status?: "online" | "away" | "dnd"
  custom_status?: string
  custom_status_emoji?: string
}

interface Props {
  users: User[]
  userCount: number
  roomId: string
  initialVolumes?: Map<string, number>
  isOpen?: boolean
  collapsed?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  initialVolumes: () => new Map(),
  collapsed: false,
  // isOpen has no default - when undefined, sidebar controls itself (desktop mode)
  // when provided, parent controls visibility (mobile mode)
})

const emit = defineEmits<{
  "close-mobile-sidebar": []
  "volume-change": [userId: string, volume: number]
  "update:collapsed": [value: boolean]
}>()

// Store for immediate nickname updates
const userStore = useUserStore()

// Users with immediate nickname updates for current user
const usersWithCurrentNickname = computed(() => {
  return props.users.map((user) => {
    if (user.id === userStore.userId) {
      return {
        ...user,
        nickname: userStore.nickname,
      }
    }
    return user
  })
})

// Users split into online / offline sections; empty sections are hidden
const userGroups = computed(() => {
  const online = usersWithCurrentNickname.value.filter((user) => user.is_online)
  const offline = usersWithCurrentNickname.value.filter((user) => !user.is_online)
  return [
    { key: "online", label: "Online", users: online },
    { key: "offline", label: "Offline", users: offline },
  ].filter((group) => group.users.length > 0)
})

// Visibility logic:
// - Desktop (isOpen not provided): always visible when there are users
// - Mobile (isOpen provided): visibility controlled by parent via isOpen prop
const isVisible = computed(() => {
  // If isOpen prop is explicitly provided (mobile mode), use it directly
  if (props.isOpen !== undefined) {
    return props.isOpen
  }
  // Desktop mode: visible when there are users
  return props.userCount > 0
})

const isCollapsed = computed({
  get: () => props.collapsed,
  set: (value) => emit("update:collapsed", value),
})

// Compute sidebar classes - mobile uses transform, desktop doesn't
const sidebarClasses = computed(() => {
  const classes = []

  // Width classes
  if (isCollapsed.value) {
    classes.push("w-12", "lg:w-12")
  } else {
    classes.push("w-60", "lg:w-60")
  }

  // Transform classes - only for mobile (fixed positioning)
  // On desktop (lg), sidebar is always visible (relative positioning)
  if (!isCollapsed.value) {
    if (!isVisible.value) {
      classes.push("translate-x-full") // Mobile: hidden off-screen
    } else {
      classes.push("translate-x-0") // Mobile: visible
    }
  } else {
    classes.push("translate-x-0") // Collapsed: always visible
  }

  // Desktop always visible (override any transform)
  classes.push("lg:translate-x-0", "lg:relative")

  return classes.join(" ")
})

const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value
}

// Maximum number of avatars to show in collapsed mode
const MAX_COLLAPSED_AVATARS = 15

// Users to display in collapsed sidebar (limited to prevent overcrowding)
const displayedUsers = computed(() => {
  return usersWithCurrentNickname.value.slice(0, MAX_COLLAPSED_AVATARS)
})

// Count of remaining users not shown
const remainingUsersCount = computed(() => {
  return Math.max(0, props.users.length - MAX_COLLAPSED_AVATARS)
})

const getInitialVolume = (userId: string) => {
  return props.initialVolumes.get(userId) || 80
}

const handleVolumeChange = (userId: string, volume: number) => {
  emit("volume-change", userId, volume)
}

// Profile popover: one shared instance, anchored to the clicked row
const profileUserId = ref<string | null>(null)
const profileAnchor = shallowRef<HTMLElement | null>(null)

const toggleProfile = (userId: string, anchor: HTMLElement) => {
  if (profileUserId.value === userId && profileAnchor.value === anchor) {
    closeProfile()
    return
  }
  profileUserId.value = userId
  profileAnchor.value = anchor
}

const closeProfile = () => {
  profileUserId.value = null
  profileAnchor.value = null
}

// Anchor elements are swapped when collapsing/expanding or hiding on mobile
watch([isCollapsed, isVisible], closeProfile)
</script>
