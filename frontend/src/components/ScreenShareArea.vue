<template>
  <div class="screen-share-area bg-gray-800 rounded-lg overflow-hidden">
    <!-- Header with controls -->
    <div class="px-4 py-3 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
      <div class="flex items-center space-x-2">
        <PhMonitorPlay class="w-5 h-5 text-indigo-400" />
        <span class="text-white font-medium">
          {{ screenShares.length }} screen{{ screenShares.length !== 1 ? 's' : '' }} sharing
        </span>
      </div>
      
      <div class="flex items-center space-x-2">
        <!-- Layout Toggle -->
        <div class="flex bg-gray-700 rounded-lg p-1">
          <button
            class="px-3 py-1.5 rounded-md text-sm transition-colors flex items-center"
            :class="[
              layout === 'grid'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-white'
            ]"
            @click="layout = 'grid'"
          >
            <PhGridFour class="w-4 h-4 mr-1" />
            Grid
          </button>
          <button
            class="px-3 py-1.5 rounded-md text-sm transition-colors flex items-center"
            :class="[
              layout === 'focus'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-white'
            ]"
            @click="layout = 'focus'"
          >
            <PhArrowsOut class="w-4 h-4 mr-1" />
            Focus
          </button>
        </div>
        
        <!-- Hide/Show User Grid Button -->
        <button
          class="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          :title="isUserGridVisible ? 'Hide user grid' : 'Show user grid'"
          @click="$emit('toggle-user-grid')"
        >
          <PhEye v-if="isUserGridVisible" class="w-4 h-4" />
          <PhEyeSlash v-else class="w-4 h-4" />
        </button>
      </div>
    </div>
    
    <!-- Screen Share Content -->
    <div class="p-4">
      <!-- Focus Layout: Main screen + thumbnails -->
      <div v-if="layout === 'focus'" class="space-y-4">
        <!-- Main focused screen -->
        <div v-if="focusedShare">
          <ScreenStream
            :user-id="focusedShare.userId"
            :user-nickname="focusedShare.userNickname"
            :stream="focusedShare.stream"
            :quality="focusedShare.quality"
            :connection-state="focusedShare.connectionState"
            :is-focused="true"
            :show-focus-button="false"
          />
        </div>
        
        <!-- Thumbnail row for other screens -->
        <div v-if="thumbnailShares.length > 0" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <div
            v-for="share in thumbnailShares"
            :key="share.userId"
            class="cursor-pointer"
            @click="setFocusedShare(share.userId)"
          >
            <div class="relative aspect-video rounded-lg overflow-hidden border-2 border-gray-600 hover:border-indigo-500 transition-colors">
              <video
                :srcObject="share.stream"
                class="w-full h-full object-cover"
                autoplay
                playsinline
                muted
              />
              <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
                <span class="text-white text-xs font-medium">{{ share.userNickname }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Grid Layout: All screens side by side -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ScreenStream
          v-for="share in screenShares"
          :key="share.userId"
          :user-id="share.userId"
          :user-nickname="share.userNickname"
          :stream="share.stream"
          :quality="share.quality"
          :connection-state="share.connectionState"
          :is-focused="false"
          :show-focus-button="screenShares.length > 1"
          @make-focused="setFocusedShare(share.userId)"
        />
      </div>
    </div>
    
    <!-- Empty State -->
    <div v-if="screenShares.length === 0" class="px-4 py-8 text-center">
      <PhMonitorPlay class="w-12 h-12 text-gray-600 mx-auto mb-2" />
      <p class="text-gray-400">No active screen shares</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  PhMonitorPlay,
  PhGridFour,
  PhArrowsOut,
  PhEye,
  PhEyeSlash
} from '@phosphor-icons/vue'
import ScreenStream from './ScreenStream.vue'
import type { ScreenShareQuality } from '@/types'

interface ScreenShare {
  userId: string
  userNickname: string
  stream: MediaStream | null
  quality: ScreenShareQuality
  connectionState?: string
}

interface Props {
  screenShares: ScreenShare[]
  isUserGridVisible: boolean
}

const props = defineProps<Props>()
defineEmits<{
  'toggle-user-grid': []
}>()

type LayoutMode = 'grid' | 'focus'
const layout = ref<LayoutMode>('focus')
const focusedUserId = ref<string | null>(null)

// Set initial focus to first screen share
watch(() => props.screenShares.length, (newLength, oldLength) => {
  if (newLength > 0 && (oldLength === 0 || !focusedUserId.value)) {
    // If first share added or no focus set, focus on first
    focusedUserId.value = props.screenShares[0].userId
  } else if (newLength === 0) {
    // If all shares removed, clear focus
    focusedUserId.value = null
  } else if (focusedUserId.value && !props.screenShares.find(s => s.userId === focusedUserId.value)) {
    // If focused user stopped sharing, focus on first available
    focusedUserId.value = props.screenShares[0]?.userId || null
  }
}, { immediate: true })

const focusedShare = computed(() => {
  if (!focusedUserId.value) return props.screenShares[0] || null
  return props.screenShares.find(s => s.userId === focusedUserId.value) || props.screenShares[0] || null
})

const thumbnailShares = computed(() => {
  if (!focusedShare.value) return []
  return props.screenShares.filter(s => s.userId !== focusedShare.value?.userId)
})

const setFocusedShare = (userId: string) => {
  focusedUserId.value = userId
  // Switch to focus layout when user clicks on a thumbnail
  if (layout.value === 'grid') {
    layout.value = 'focus'
  }
}
</script>

<style scoped>
.screen-share-area {
  min-height: 200px;
}
</style>
