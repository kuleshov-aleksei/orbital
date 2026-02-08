<template>
  <div
    class="user-sidebar flex flex-col fixed lg:relative inset-y-0 right-0 z-40 lg:z-auto transition-all duration-300 bg-gray-800"
    data-testid="user-sidebar"
    :class="sidebarClasses">
    <!-- Mobile Close Button -->
    <div class="lg:hidden flex items-center justify-between p-4 border-b border-gray-700">
      <h2 class="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        Users — {{ userCount }}
      </h2>

      <button
        type="button"
        class="p-1 text-gray-400 hover:text-white"
        @click="$emit('close-mobile-sidebar')"
      >
        <PhCross class="w-5 h-5" />
      </button>
    </div>

    <!-- Desktop Header -->
    <div class="hidden lg:flex items-center justify-between p-3 border-b border-gray-700" :class="{ 'justify-center': isCollapsed }">
      <h2 v-if="!isCollapsed" class="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        Users — {{ userCount }}
      </h2>
      
      <!-- Toggle Button - Integrated into header -->
      <button
        type="button"
        class="flex items-center justify-center w-7 h-7 rounded-md bg-gray-700/50 hover:bg-gray-600 text-gray-400 hover:text-gray-200 transition-all duration-200"
        :class="{ 'rotate-180': !isCollapsed }"
        :title="isCollapsed ? 'Expand' : 'Collapse'"
        @click="toggleCollapse"
      >
        <PhCaretDoubleRight class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- User List (hidden when collapsed) -->
    <div v-if="!isCollapsed" class="flex-1 overflow-y-auto p-2" data-testid="user-list">
      <UserCard
        v-for="user in users"
        :key="user.id"
        :user="user"
        :initial-volume="getInitialVolume(user.id)"
        @volume-change="handleVolumeChange"
      />
    </div>

    <!-- Collapsed state - show user count icon -->
    <div v-else class="flex-1 flex flex-col items-center pt-4">
      <div class="relative">
        <div class="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">
          {{ userCount }}
        </div>

        <div class="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-800"></div>
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
    PhCaretDoubleLeft,
    PhCaretDoubleRight
  } from '@phosphor-icons/vue'

interface User {
  id: string
  nickname: string
  is_speaking?: boolean
  is_muted?: boolean
  is_deafened?: boolean
  is_online?: boolean
  status?: 'online' | 'away' | 'dnd'
}

interface Props {
  users: User[]
  userCount: number
  initialVolumes?: Map<string, number>
  isOpen?: boolean
  collapsed?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  initialVolumes: () => new Map(),
  collapsed: false
  // isOpen has no default - when undefined, sidebar controls itself (desktop mode)
  // when provided, parent controls visibility (mobile mode)
})

const emit = defineEmits<{
  'close-mobile-sidebar': []
  'volume-change': [userId: string, volume: number]
  'update:collapsed': [value: boolean]
}>()

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
  set: (value) => emit('update:collapsed', value)
})

// Compute sidebar classes - mobile uses transform, desktop doesn't
const sidebarClasses = computed(() => {
  const classes = []
  
  // Width classes
  if (isCollapsed.value) {
    classes.push('w-12', 'lg:w-12')
  } else {
    classes.push('w-60', 'lg:w-60')
  }
  
  // Transform classes - only for mobile (fixed positioning)
  // On desktop (lg), sidebar is always visible (relative positioning)
  if (!isCollapsed.value) {
    if (!isVisible.value) {
      classes.push('translate-x-full') // Mobile: hidden off-screen
    } else {
      classes.push('translate-x-0') // Mobile: visible
    }
  } else {
    classes.push('translate-x-0') // Collapsed: always visible
  }
  
  // Desktop always visible (override any transform)
  classes.push('lg:translate-x-0', 'lg:relative')
  
  return classes.join(' ')
})

const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value
}

const getInitialVolume = (userId: string) => {
  return props.initialVolumes.get(userId) || 80
}

const handleVolumeChange = (userId: string, volume: number) => {
  emit('volume-change', userId, volume)
}
</script>
