<template>
  <div class="relative" :style="containerStyle">
    <!-- Profile Image Avatar -->
    <img
      v-if="avatarUrl && !imageError"
      :src="avatarUrl"
      :alt="nickname"
      class="rounded-full object-cover"
      :style="avatarStyle"
      @error="handleImageError"
    />
    <!-- Generated Avatar (fallback) -->
    <Avatar
      v-else
      :name="nickname"
      :colors="avatarColors"
      variant="beam"
      :size="size"
    />
    <!-- Status Indicator -->
    <div
      v-if="showStatus"
      class="absolute bottom-0 right-0 rounded-full border-2 border-gray-800"
      :class="statusClasses"
      :style="statusStyle"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Avatar from 'vue-boring-avatars'

type UserStatus = 'online' | 'away' | 'dnd' | 'offline'

interface Props {
  nickname: string
  status?: UserStatus
  size?: number
  showStatus?: boolean
  bgColor?: string
  avatarUrl?: string
}

const props = withDefaults(defineProps<Props>(), {
  status: 'online',
  size: 32,
  showStatus: true,
  bgColor: 'bg-indigo-500',
  avatarUrl: undefined
})

const imageError = ref(false)

const handleImageError = () => {
  imageError.value = true
}

// Pleasant color palette for generated avatars
const avatarColors = ['#E8F5E9', '#C8E6C9', '#A5D6A7', '#81C784', '#66BB6A']

const avatarStyle = computed(() => {
  return {
    width: `${props.size}px`,
    height: `${props.size}px`,
    fontSize: `${props.size * 0.4}px`
  }
})

const containerStyle = computed(() => {
  return {
    width: `${props.size}px`,
    height: `${props.size}px`
  }
})

const statusColors: Record<UserStatus, string> = {
  online: 'bg-green-400',
  away: 'bg-yellow-400',
  dnd: 'bg-red-400',
  offline: 'bg-gray-400'
}

const statusClasses = computed(() => {
  return statusColors[props.status]
})

const statusStyle = computed(() => {
  const statusSize = Math.max(8, props.size * 0.375)
  return {
    width: `${statusSize}px`,
    height: `${statusSize}px`
  }
})
</script>
