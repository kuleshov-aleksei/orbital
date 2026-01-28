<template>
  <div class="room-sidebar w-60 lg:w-60 bg-gray-800 flex flex-col fixed lg:relative inset-y-0 left-0 z-40 lg:z-auto transform -translate-x-full lg:translate-x-0 transition-transform duration-300"
       :class="{ 'translate-x-0': !isHidden }">
    <!-- Mobile Close Button -->
    <div class="lg:hidden flex items-center justify-between p-4 border-b border-gray-700">
      <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">Rooms</h2>
      <button
        @click="$emit('close-mobile-sidebar')"
        class="p-1 text-gray-400 hover:text-white"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Desktop Header -->
    <div class="hidden lg:flex p-4 border-b border-gray-700">
      <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">Rooms</h2>
    </div>

    <!-- Room Categories and List -->
    <div class="flex-1 overflow-y-auto">
      <div v-for="category in categorizedRooms" :key="category.name" class="mb-4">
        <div class="px-2 py-1">
          <button 
            @click="toggleCategory(category.name)"
            class="w-full flex items-center justify-between px-2 py-1 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors duration-200"
          >
            <span>{{ category.name }}</span>
            <svg 
              class="w-3 h-3 transition-transform duration-200"
              :class="{ 'rotate-90': expandedCategories.has(category.name) }"
              fill="currentColor" viewBox="0 0 20 20"
            >
              <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>
        
        <div v-show="expandedCategories.has(category.name)" class="px-2">
          <RoomCard
            v-for="room in category.rooms"
            :key="room.id"
            :room="room"
            :isActive="room.id === activeRoomId"
            @click="$emit('room-selected', room.id)"
          />
        </div>
      </div>
    </div>

    <!-- Create Room Button -->
    <div class="p-3 border-t border-gray-700">
      <button
        @click="$emit('create-room')"
        class="w-full flex items-center justify-center px-3 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors duration-200"
      >
        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        <span class="text-sm font-medium">Create Room</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import RoomCard from '@/components/RoomCard.vue'

interface Room {
  id: string
  name: string
  userCount: number
  maxUsers: number
  category: string
}

interface Props {
  rooms: Room[]
  activeRoomId: string | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'room-selected': [roomId: string]
  'create-room': []
  'close-mobile-sidebar': []
}>()

const isHidden = computed(() => {
  return props.rooms.length === 0
})

const expandedCategories = ref(new Set(['Main', 'Gaming', 'Study', 'Hobbies']))

const categorizedRooms = computed(() => {
  const categories: { name: string; rooms: Room[] }[] = []
  const categoryMap = new Map<string, Room[]>()

  // Group rooms by category
  props.rooms.forEach(room => {
    if (!categoryMap.has(room.category)) {
      categoryMap.set(room.category, [])
    }
    categoryMap.get(room.category)!.push(room)
  })

  // Convert to array format
  categoryMap.forEach((rooms, name) => {
    categories.push({ name, rooms })
  })

  return categories
})

const toggleCategory = (categoryName: string) => {
  if (expandedCategories.value.has(categoryName)) {
    expandedCategories.value.delete(categoryName)
  } else {
    expandedCategories.value.add(categoryName)
  }
}
</script>