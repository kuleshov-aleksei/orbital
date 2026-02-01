<template>
  <div
    class="room-card px-2 py-2 mb-1 rounded-lg cursor-pointer transition-all duration-200"
    :class="{
      'bg-indigo-600 text-white': isActive,
      'bg-gray-700 hover:bg-gray-600 text-gray-200': !isActive
    }"
    @click="$emit('click')"
    @contextmenu.prevent="showContextMenu"
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

        <div class="text-xs opacity-75">{{ room.user_count }}/{{ room.max_users }} users</div>
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
          <div class="mr-2 flex items-center gap-1">
            <PhMicrophone v-if="!user.is_muted && !user.is_deafened" class="text-green-500 w-4 h-4"/>

            <PhMicrophoneSlash v-if="user.is_muted" class="text-red-500 w-4 h-4"/>

            <PhHeadphones v-if="user.is_deafened" class="text-red-500 w-4 h-4"/>

            <PhMonitor v-if="user.is_screen_sharing" class="text-blue-400 w-4 h-4"/>
          </div>

          <span>{{ user.nickname }}</span>

          <span v-if="user.role === 'owner'" class="ml-1 opacity-60">(owner)</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">

import { PhWaveform, PhMicrophone, PhHeadphones, PhMicrophoneSlash, PhMonitor } from '@phosphor-icons/vue'

// Use snake_case to match backend API and global types
interface RoomPreviewUser {
  id: string
  nickname: string
  role: string
  is_muted: boolean
  is_deafened: boolean
  is_speaking: boolean
  is_screen_sharing?: boolean
}

interface Room {
  id: string
  name: string
  user_count: number
  max_users: number
  category: string
  users?: RoomPreviewUser[]
}

interface Props {
  room: Room
  isActive: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  click: []
  'show-context-menu': [event: MouseEvent, room: Room]
}>()

const showContextMenu = (event: MouseEvent) => {
  emit('show-context-menu', event, props.room)
}

</script>
