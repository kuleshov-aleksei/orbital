<template>
  <div class="relative" :style="containerStyle">
    <!-- Avatar Circle -->
    <div
      class="rounded-full flex items-center justify-center font-medium"
      :class="avatarClasses"
      :style="avatarStyle"
    >
      {{ initial }}
    </div>
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
import { computed } from 'vue'

type UserStatus = 'online' | 'away' | 'dnd' | 'offline'

interface Props {
  nickname: string
  status?: UserStatus
  size?: number
  showStatus?: boolean
  bgColor?: string
}

const props = withDefaults(defineProps<Props>(), {
  status: 'online',
  size: 32,
  showStatus: true,
  bgColor: 'bg-indigo-500'
})

const initial = computed(() => {
  return props.nickname.charAt(0).toUpperCase()
})

const avatarClasses = computed(() => {
  return props.bgColor
})

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
