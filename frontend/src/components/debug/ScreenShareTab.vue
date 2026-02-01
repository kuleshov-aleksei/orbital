<template>
  <div class="screen-share-tab p-4 space-y-4">
    <!-- Summary Header -->
    <div class="bg-gray-800 rounded-lg p-4">
      <h3 class="text-white font-semibold mb-2">Screen Share Summary</h3>

      <div class="grid grid-cols-3 gap-4 text-center">
        <div class="bg-gray-700 rounded p-2">
          <div class="text-2xl font-bold text-indigo-400">{{ localScreenShares.length }}</div>

          <div class="text-xs text-gray-400">Local Shares</div>
        </div>

        <div class="bg-gray-700 rounded p-2">
          <div class="text-2xl font-bold text-green-400">{{ remoteScreenShares.length }}</div>

          <div class="text-xs text-gray-400">Remote Shares</div>
        </div>

        <div class="bg-gray-700 rounded p-2">
          <div class="text-2xl font-bold text-blue-400">{{ totalStreams }}</div>

          <div class="text-xs text-gray-400">Total Streams</div>
        </div>
      </div>
    </div>

    <!-- Local Screen Share -->
    <div v-if="localScreenShares.length > 0" class="bg-gray-800 rounded-lg p-4">
      <h3 class="text-white font-semibold mb-3 flex items-center">
        <PhMonitorPlay class="w-5 h-5 mr-2 text-indigo-400" />
        Local Screen Share (You)
      </h3>

      <div v-for="share in localScreenShares" :key="share.userId" class="space-y-2">
        <ScreenShareDebugCard :share="share" />
      </div>
    </div>

    <!-- Remote Screen Shares -->
    <div v-if="remoteScreenShares.length > 0" class="bg-gray-800 rounded-lg p-4">
      <h3 class="text-white font-semibold mb-3 flex items-center">
        <PhMonitorPlay class="w-5 h-5 mr-2 text-green-400" />
        Remote Screen Shares
      </h3>

      <div class="space-y-3">
        <ScreenShareDebugCard 
          v-for="share in remoteScreenShares" 
          :key="share.userId" 
          :share="share" 
        />
      </div>
    </div>

    <!-- No Active Shares -->
    <div v-if="totalStreams === 0" class="bg-gray-800 rounded-lg p-8 text-center">
      <PhMonitorPlay class="w-12 h-12 text-gray-600 mx-auto mb-2" />

      <p class="text-gray-400">No active screen shares</p>

      <p class="text-xs text-gray-500 mt-1">
        Screen share information will appear here when someone starts sharing
      </p>
    </div>

    <!-- Help Section -->
    <div class="bg-gray-800 rounded-lg p-4">
      <h3 class="text-white font-semibold mb-2">Troubleshooting</h3>

      <ul class="text-sm text-gray-400 space-y-1">
        <li class="flex items-start">
          <span class="text-yellow-400 mr-2">•</span>
          If streams show "No video tracks" - the sender may not have allowed screen capture
        </li>

        <li class="flex items-start">
          <span class="text-yellow-400 mr-2">•</span>
          If connection state is "connecting" for more than 10s - check WebRTC connection status
        </li>

        <li class="flex items-start">
          <span class="text-yellow-400 mr-2">•</span>
          Stream ready but not displaying - check browser console for JavaScript errors
        </li>

        <li class="flex items-start">
          <span class="text-yellow-400 mr-2">•</span>
          Check Network tab for ICE connection state and candidate information
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { PhMonitorPlay } from '@phosphor-icons/vue'
import ScreenShareDebugCard from './ScreenShareDebugCard.vue'

interface ScreenShareDebugInfo {
  userId: string
  userNickname: string
  stream: MediaStream | null
  quality: string
  hasVideo: boolean
  hasAudio: boolean
  videoWidth: number
  videoHeight: number
  connectionState: string
  trackCount: number
  active: boolean
}

interface Props {
  localScreenShares: ScreenShareDebugInfo[]
  remoteScreenShares: ScreenShareDebugInfo[]
}

const props = defineProps<Props>()

const totalStreams = computed(() => {
  return props.localScreenShares.length + props.remoteScreenShares.length
})
</script>
