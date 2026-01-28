<template>
  <div
    class="room-card flex items-center px-2 py-2 mb-1 rounded-lg cursor-pointer transition-all duration-200"
    :class="{
      'bg-indigo-600 text-white': isActive,
      'bg-gray-700 hover:bg-gray-600 text-gray-200': !isActive
    }"
    @click="$emit('click')"
  >
    <!-- Room Icon -->
    <div class="mr-3">
      <div class="w-8 h-8 rounded-full flex items-center justify-center"
        :class="{
          'bg-indigo-500': isActive,
          'bg-gray-600': !isActive
        }"
      >
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
          <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
        </svg>
      </div>
    </div>

    <!-- Room Info -->
    <div class="flex-1 min-w-0">
      <div class="font-medium text-sm truncate">{{ room.name }}</div>
      <div class="text-xs opacity-75">{{ room.userCount }}/{{ room.maxUsers }} users</div>
    </div>

    <!-- Status Indicators -->
    <div class="ml-2 flex items-center">
      <div v-if="room.userCount > 0" class="flex -space-x-1">
        <div class="w-2 h-2 rounded-full bg-green-400"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Room {
  id: string
  name: string
  userCount: number
  maxUsers: number
  category: string
}

interface Props {
  room: Room
  isActive: boolean
}

defineProps<Props>()
defineEmits<{
  click: []
}>()
</script>