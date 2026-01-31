<template>
  <div class="screen-share-debug-card bg-gray-700 rounded-lg p-3">
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center">
        <div class="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-sm font-bold text-white mr-2">
          {{ share.userNickname.charAt(0).toUpperCase() }}
        </div>
        <div>
          <div class="text-white font-medium">{{ share.userNickname }}</div>
          <div class="text-xs text-gray-400">{{ share.userId }}</div>
        </div>
      </div>
      <div 
        class="px-2 py-1 rounded text-xs font-medium"
        :class="{
          'bg-green-600 text-white': share.connectionState === 'connected',
          'bg-yellow-600 text-white': share.connectionState === 'connecting',
          'bg-red-600 text-white': share.connectionState === 'failed' || share.connectionState === 'closed',
          'bg-gray-600 text-gray-300': !share.connectionState || share.connectionState === 'new'
        }"
      >
        {{ share.connectionState || 'unknown' }}
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2 text-sm">
      <div class="bg-gray-800 rounded p-2">
        <div class="text-gray-500 text-xs mb-1">Quality</div>
        <div class="text-white">{{ share.quality }}</div>
      </div>
      
      <div class="bg-gray-800 rounded p-2">
        <div class="text-gray-500 text-xs mb-1">Status</div>
        <div :class="share.active ? 'text-green-400' : 'text-red-400'">
          {{ share.active ? 'Active' : 'Inactive' }}
        </div>
      </div>
      
      <div class="bg-gray-800 rounded p-2">
        <div class="text-gray-500 text-xs mb-1">Video</div>
        <div :class="share.hasVideo ? 'text-green-400' : 'text-red-400'">
          {{ share.hasVideo ? '✓ Enabled' : '✗ None' }}
          <span v-if="share.hasVideo" class="text-gray-400 text-xs block">
            {{ share.videoWidth }}x{{ share.videoHeight }}
          </span>
        </div>
      </div>
      
      <div class="bg-gray-800 rounded p-2">
        <div class="text-gray-500 text-xs mb-1">Audio</div>
        <div :class="share.hasAudio ? 'text-green-400' : 'text-gray-400'">
          {{ share.hasAudio ? '✓ Enabled' : '—' }}
        </div>
      </div>
      
      <div class="bg-gray-800 rounded p-2 col-span-2">
        <div class="text-gray-500 text-xs mb-1">Tracks</div>
        <div class="text-white">{{ share.trackCount }} total</div>
      </div>
    </div>

    <div v-if="!share.stream" class="mt-2 p-2 bg-red-900/50 rounded text-red-400 text-sm">
      ⚠️ No stream object - waiting for WebRTC track
    </div>
    
    <div v-else-if="!share.hasVideo" class="mt-2 p-2 bg-yellow-900/50 rounded text-yellow-400 text-sm">
      ⚠️ Stream exists but no video tracks found
    </div>
  </div>
</template>

<script setup lang="ts">
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
  share: ScreenShareDebugInfo
}

defineProps<Props>()
</script>
