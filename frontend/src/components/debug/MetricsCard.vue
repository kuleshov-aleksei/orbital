<template>
  <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-medium text-white">
        {{ getUserNickname(userId) }}
      </h3>

      <div class="flex items-center space-x-2">
        <div
          class="w-2 h-2 rounded-full"
          :class="connectionQualityClass"
        ></div>

        <span class="text-xs text-gray-400">
          {{ connectionQuality.quality }}
        </span>
      </div>
    </div>

    <!-- Metrics Grid -->
    <div class="grid grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
      <div>
        <div class="text-gray-500">Packets Sent</div>

        <div class="text-white font-mono">
          {{ stats.packetsSent.toLocaleString() }}
        </div>
      </div>

      <div>
        <div class="text-gray-500">Packets Received</div>

        <div class="text-white font-mono">
          {{ stats.packetsReceived.toLocaleString() }}
        </div>
      </div>

      <div>
        <div class="text-gray-500">Packet Loss</div>

        <div class="text-white font-mono text-red-400">
          {{ stats.packetsLost }}
        </div>
      </div>

      <div>
        <div class="text-gray-500">Bytes Sent</div>

        <div class="text-white font-mono">
          {{ formatBytes(stats.bytesSent) }}
        </div>
      </div>

      <div>
        <div class="text-gray-500">Bytes Received</div>

        <div class="text-white font-mono">
          {{ formatBytes(stats.bytesReceived) }}
        </div>
      </div>

      <div>
        <div class="text-gray-500">RTT</div>

        <div class="text-white font-mono">
          {{ Math.round(stats.roundTripTime) }}ms
        </div>
      </div>

      <div>
        <div class="text-gray-500">Jitter</div>

        <div class="text-white font-mono">
          {{ Math.round(stats.jitter) }}ms
        </div>
      </div>

      <div>
        <div class="text-gray-500">Upload</div>

        <div class="text-white font-mono">
          {{ Math.round(stats.bandwidth.upload) }}kbps
        </div>
      </div>

      <div>
        <div class="text-gray-500">Download</div>

        <div class="text-white font-mono">
          {{ Math.round(stats.bandwidth.download) }}kbps
        </div>
      </div>

      <div>
        <div class="text-gray-500">Audio Level</div>

        <div class="text-white font-mono">
          {{ Math.round(stats.audioLevel) }}
        </div>
      </div>

      <div>
        <div class="text-gray-500">State</div>

        <div class="text-white font-mono capitalize">
          {{ stats.connectionState }}
        </div>
      </div>
    </div>

    <!-- Quality Score -->
    <div class="mt-3 pt-3 border-t border-gray-700">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs text-gray-500">Quality Score</span>

        <span class="text-xs text-white">
          {{ connectionQuality.score }}/100
        </span>
      </div>

      <div class="w-full bg-gray-700 rounded-full h-2">
        <div
          class="h-2 rounded-full transition-all duration-300"
          :class="qualityScoreClass"
          :style="{ width: connectionQuality.score + '%' }"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ConnectionStats, ConnectionQuality } from '@/types'

interface Props {
  userId: string
  stats: ConnectionStats
  connectionQuality: ConnectionQuality
  getUserNickname: (userId: string) => string
}

const props = defineProps<Props>()

const connectionQualityClass = computed(() => {
  switch (props.connectionQuality.quality) {
    case 'excellent': return 'bg-green-400'
    case 'good': return 'bg-blue-400'
    case 'fair': return 'bg-yellow-400'
    case 'poor': return 'bg-red-400'
    default: return 'bg-gray-400'
  }
})

const qualityScoreClass = computed(() => {
  const score = props.connectionQuality.score
  if (score >= 85) return 'bg-green-400'
  if (score >= 70) return 'bg-blue-400'
  if (score >= 50) return 'bg-yellow-400'
  return 'bg-red-400'
})

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
</script>