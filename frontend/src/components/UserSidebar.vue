<template>
  <div
class="user-sidebar w-60 lg:w-60 bg-gray-800 flex flex-col fixed lg:relative inset-y-0 right-0 z-40 lg:z-auto transform translate-x-full lg:translate-x-0 transition-transform duration-300"
       data-testid="user-sidebar"
       :class="{ 'translate-x-0': !isHidden }">
    <!-- Mobile Close Button -->
    <div class="lg:hidden flex items-center justify-between p-4 border-b border-gray-700">
      <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        In Room — {{ userCount }}
      </h2>
      <button
        class="p-1 text-gray-400 hover:text-white"
        @click="$emit('close-mobile-sidebar')"
      >
        <PhCross class="w-5 h-5" />
      </button>
    </div>

    <!-- Desktop Header -->
    <div class="hidden lg:flex items-center justify-between p-4 border-b border-gray-700">
      <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        In Room — {{ userCount }}
      </h2>
      <button class="text-gray-400 hover:text-gray-200 transition-colors duration-200">
        <PhDotsThree class="w-4 h-4" />
      </button>
    </div>

    <!-- User List -->
    <div class="flex-1 overflow-y-auto p-2" data-testid="user-list">
      <UserCard
        v-for="user in users"
        :key="user.id"
        :user="user"
        :initial-volume="getInitialVolume(user.id)"
        @volume-change="handleVolumeChange"
      />
    </div>

    <!-- User Controls -->
    <div class="p-3 border-t border-gray-700">
      <div class="space-y-2">
        <button class="w-full flex items-center justify-center px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors duration-200">
        <PhVideoCamera class="w-4 h-4 mr-2" />
          <span class="text-sm font-medium">Start Video</span>
        </button>
        
        <button class="w-full flex items-center justify-center px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors duration-200">
        <PhMonitorPlay class="w-4 h-4 mr-2" />
          <span class="text-sm font-medium">Share Screen</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
 import { computed } from 'vue'
 import UserCard from '@/components/UserCard.vue'
 import { 
   PhCross, 
   PhDotsThree, 
   PhVideoCamera, 
   PhMonitorPlay 
 } from '@phosphor-icons/vue'

interface User {
  id: string
  nickname: string
  isSpeaking: boolean
  isMuted: boolean
  isDeafened: boolean
  status: 'online' | 'away' | 'dnd'
}

interface Props {
  users: User[]
  userCount: number
  initialVolumes?: Map<string, number>
}

const props = withDefaults(defineProps<Props>(), {
  initialVolumes: () => new Map()
})

const emit = defineEmits<{
  'close-mobile-sidebar': []
  'volume-change': [userId: string, volume: number]
}>()

const isHidden = computed(() => {
  return props.userCount === 0
})

const getInitialVolume = (userId: string) => {
  return props.initialVolumes.get(userId) || 80
}

const handleVolumeChange = (userId: string, volume: number) => {
  emit('volume-change', userId, volume)
}
</script>
