<template>
  <div class="relative overflow-hidden rounded-full" :style="containerStyle">
    <!-- Profile Image Avatar -->
    <img
      v-if="displayAvatarUrl && !imageError"
      :src="displayAvatarUrl"
      :alt="displayNickname"
      class="w-full h-full object-cover"
      :class="{ grayscale: grayscale }"
      @error="handleImageError" />
    <!-- Generated Avatar (fallback) -->
    <Avatar
      v-else
      :name="displayNickname"
      :colors="avatarColors"
      variant="beam"
      :size="size"
      :class="{ grayscale: grayscale }" />
    <!-- Status Indicator -->
    <div
      v-if="showStatus"
      class="absolute bottom-0 right-0 rounded-full border-2 border-gray-800"
      :class="statusClasses"
      :style="statusStyle"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import Avatar from "vue-boring-avatars"
import { useUserStore, useUsersStore } from "@/stores"
import { resolveUrl } from "@/services/api"

type UserStatus = "online" | "away" | "dnd" | "offline"

interface Props {
  nickname?: string
  status?: UserStatus
  size?: number
  showStatus?: boolean
  bgColor?: string
  avatarUrl?: string
  grayscale?: boolean
  userId?: string // If provided, will fetch avatar/nickname from store
}

const props = withDefaults(defineProps<Props>(), {
  nickname: undefined,
  status: "online",
  size: 32,
  showStatus: true,
  bgColor: "bg-indigo-500",
  avatarUrl: undefined,
  grayscale: false,
  userId: undefined,
})

const imageError = ref(false)

const handleImageError = () => {
  imageError.value = true
}

// Reset image error when avatar URL changes
watch(
  () => props.avatarUrl,
  () => {
    imageError.value = false
  },
)

// Stores for fetching user data by ID
const userStore = useUserStore()
const usersStore = useUsersStore()

// Get user data from store if userId is provided
const storeUser = computed(() => {
  if (!props.userId) return null

  // Check if it's the current user
  if (props.userId === userStore.userId) {
    return {
      nickname: userStore.nickname,
      avatarUrl: userStore.avatarUrl,
    }
  }

  // Check in users store
  const user = usersStore.allUsers.find((u) => u.id === props.userId)
  if (user) {
    return {
      nickname: user.nickname,
      avatarUrl: user.avatar_url,
    }
  }

  return null
})

// Display values - prioritize props, fall back to store
const displayNickname = computed(() => {
  return props.nickname ?? storeUser.value?.nickname ?? "User"
})

const displayAvatarUrl = computed(() => {
  const url = props.avatarUrl ?? storeUser.value?.avatarUrl ?? undefined
  return url ? resolveUrl(url) : undefined
})

// Pleasant color palette for generated avatars
const avatarColors = ["#E8F5E9", "#C8E6C9", "#A5D6A7", "#81C784", "#66BB6A"]

const containerStyle = computed(() => {
  return {
    width: `${props.size}px`,
    height: `${props.size}px`,
  }
})

const statusColors: Record<UserStatus, string> = {
  online: "bg-green-400",
  away: "bg-yellow-400",
  dnd: "bg-red-400",
  offline: "bg-gray-400",
}

const statusClasses = computed(() => {
  return statusColors[props.status]
})

const statusStyle = computed(() => {
  const statusSize = Math.max(8, props.size * 0.375)
  return {
    width: `${statusSize}px`,
    height: `${statusSize}px`,
  }
})
</script>
