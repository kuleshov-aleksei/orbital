<template>
  <div
    class="room-card px-2 py-2 mb-1 rounded-lg cursor-pointer transition-all duration-200"
    :class="{
      'bg-indigo-600 text-white': isActive,
      'bg-gray-700 hover:bg-gray-600 text-gray-200': !isActive
    }"
    @click="$emit('click')"
  >
    <!-- Room Header -->
    <div class="flex items-center">
      <!-- Room Icon -->
      <div class="mr-3">
        <div
  class="w-8 h-8 rounded-full flex items-center justify-center"
          :class="{
            'bg-indigo-500': isActive,
            'bg-gray-600': !isActive
          }"
        >
          <PhWaveform class="w-4 h-4" />
        </div>
      </div>

      <!-- Room Info -->
      <div class="flex-1 min-w-0">
        <div class="font-medium text-sm truncate">{{ room.name }}</div>
        <div class="text-xs opacity-75">{{ room.userCount }}/{{ room.maxUsers }} users</div>
      </div>
    </div>

    <!-- Users List -->
    <div v-if="room.users && room.users.length > 0" class="mt-2 ml-11">
      <div class="text-xs opacity-75 mb-1">In this room:</div>
      <div class="space-y-1">
        <div
          v-for="user in room.users"
          :key="user.id"
          class="flex items-center text-xs"
        >
          <div class="w-2 h-2 rounded-full mr-2" :class="getUserRoleColor(user.role)"></div>
          <span>{{ user.nickname }}</span>
          <span v-if="user.role === 'owner'" class="ml-1 opacity-60">(owner)</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { PhWaveform } from '@phosphor-icons/vue'

interface RoomPreviewUser {
  id: string
  nickname: string
  role: string
}

interface Room {
  id: string
  name: string
  userCount: number
  maxUsers: number
  category: string
  users?: RoomPreviewUser[]
}

interface Props {
  room: Room
  isActive: boolean
}

const showPreview = ref(false)

defineProps<Props>()
defineEmits<{
  click: []
}>()

const getUserRoleColor = (role: string) => {
  switch (role) {
    case 'owner':
      return 'bg-yellow-400'
    case 'admin':
      return 'bg-purple-400'
    default:
      return 'bg-green-400'
  }
}
</script>