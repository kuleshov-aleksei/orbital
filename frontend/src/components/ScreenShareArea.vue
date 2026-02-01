<template>
  <div class="screen-share-area bg-gray-800 rounded-lg overflow-hidden">
    <!-- Screen Share Content -->
    <div class="p-4">
      <!-- Focus Layout: Main screen + thumbnails -->
      <div v-if="props.layout === 'focus'" class="space-y-4">
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
            :is-self-view="focusedShare.isSelfView"
          />
        </div>
        
        <!-- Thumbnail row for other screens -->
        <div v-if="thumbnailShares.length > 0" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <div
            v-for="share in thumbnailShares"
            :key="share.userId"
            class="cursor-pointer border-2 border-gray-600 hover:border-indigo-500 transition-colors rounded-lg overflow-hidden"
            @click="setFocusedShare(share.userId)"
          >
            <ThumbnailStream
              :user-id="share.userId"
              :user-nickname="share.userNickname"
              :stream="share.stream"
            />
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
          :is-self-view="share.isSelfView"
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
  PhMonitorPlay
} from '@phosphor-icons/vue'
import ScreenStream from './ScreenStream.vue'
import ThumbnailStream from './ThumbnailStream.vue'
import type { ScreenShareQuality } from '@/types'

interface ScreenShare {
  userId: string
  userNickname: string
  stream: MediaStream | null
  quality: ScreenShareQuality
  connectionState?: string
  isSelfView?: boolean
}

interface Props {
  screenShares: ScreenShare[]
  isUserGridVisible: boolean
  layout: 'grid' | 'focus'
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'toggle-user-grid': []
  'update:layout': [layout: 'grid' | 'focus']
}>()

const localLayout = computed({
  get: () => props.layout,
  set: (value) => emit('update:layout', value)
})
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
  if (props.layout === 'grid') {
    localLayout.value = 'focus'
  }
}
</script>

<style scoped>
.screen-share-area {
  min-height: 200px;
}
</style>
