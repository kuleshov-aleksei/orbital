<template>
  <div class="debug-dashboard">
    <!-- Dashboard Toggle -->
    <div class="fixed bottom-4 right-4 z-50">
      <button
        @click="toggleDashboard"
        :class="[
          'px-4 py-2 rounded-lg shadow-lg transition-all duration-200 flex items-center space-x-2',
          isVisible 
            ? 'bg-red-600 hover:bg-red-700 text-white' 
            : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
        ]"
      >
        <PhBug :class="['w-4 h-4', isVisible && 'animate-pulse']" />
        <span class="text-sm font-medium">{{ isVisible ? 'Close Debug' : 'Debug' }}</span>
      </button>
    </div>

    <!-- Debug Panel -->
    <Transition name="slide-up">
      <div
        v-if="isVisible"
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 flex items-end justify-center"
        @click.self="toggleDashboard"
      >
        <div class="bg-gray-900 border-t border-gray-700 w-full max-h-[80vh] overflow-hidden">
          <!-- Header -->
          <div class="bg-gray-800 px-6 py-4 border-b border-gray-700">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <PhBug class="w-5 h-5 text-blue-400" />
                <h2 class="text-lg font-semibold text-white">WebRTC Debug Dashboard</h2>
                <div class="flex items-center space-x-2 text-sm text-gray-400">
                  <div class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span>Live</span>
                </div>
              </div>
              
              <!-- Tabs -->
              <div class="flex items-center space-x-1">
                <button
                  v-for="tab in tabs"
                  :key="tab.id"
                  @click="activeTab = tab.id"
                  :class="[
                    'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700'
                  ]"
                >
                  {{ tab.label }}
                </button>
              </div>
            </div>
          </div>

          <!-- Content -->
          <div class="overflow-y-auto max-h-[60vh]">
            <!-- Outgoing ICE Candidates Tab -->
            <div v-if="activeTab === 'ice-candidates'" class="p-6">
              <div class="space-y-6">
                <div
                  v-for="[userId, iceCandidates] in allOutgoingIceCandidates"
                  :key="userId"
                  class="space-y-4"
                >
                  <!-- Peer Header -->
                  <div class="flex items-center space-x-3">
                    <div class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <h3 class="text-base font-medium text-white">
                      {{ getUserNickname(userId) }}
                    </h3>
                    <div class="text-xs text-gray-400">
                      {{ iceCandidates.length }} candidate{{ iceCandidates.length !== 1 ? 's' : '' }}
                    </div>
                  </div>

                  <!-- ICE Candidates Cards -->
                  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div
                      v-for="(candidate, index) in iceCandidates"
                      :key="index"
                      class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden hover:border-gray-600 transition-colors"
                    >
                      <!-- Card Header -->
                      <div class="flex items-center justify-between px-4 py-3 bg-gray-750 border-b border-gray-700">
                        <div class="flex items-center space-x-3">
                          <div 
                            class="w-3 h-3 rounded-full"
                            :class="getCandidateTypeColor(candidate.type)"
                          ></div>
                          <div class="text-sm font-medium text-white">
                            {{ candidate.type.toUpperCase() }}
                          </div>
                          <div class="text-xs text-gray-400">
                            Component {{ candidate.component }}
                          </div>
                        </div>
                        <button
                          @click="copyCandidateToClipboard(candidate)"
                          class="flex items-center space-x-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                        >
                          <PhCopy class="w-3 h-3" />
                          <span>Copy</span>
                        </button>
                      </div>

                      <!-- Card Content -->
                      <div class="p-4 space-y-3">
                        <!-- Endpoint -->
                        <div class="flex items-center justify-between">
                          <div class="text-xs text-gray-500">Endpoint</div>
                          <div class="text-sm font-mono text-blue-400">
                            {{ candidate.protocol.toUpperCase() }}://{{ candidate.address }}:{{ candidate.port }}
                          </div>
                        </div>

                        <!-- Priority -->
                        <div class="flex items-center justify-between">
                          <div class="text-xs text-gray-500">Priority</div>
                          <div class="text-sm font-mono text-green-400">
                            {{ candidate.priority.toLocaleString() }}
                          </div>
                        </div>

                        <!-- Foundation -->
                        <div class="flex items-center justify-between">
                          <div class="text-xs text-gray-500">Foundation</div>
                          <div class="text-sm font-mono text-yellow-400">
                            {{ candidate.foundation }}
                          </div>
                        </div>

                        <!-- SDP Info -->
                        <div class="grid grid-cols-2 gap-3 pt-3 border-t border-gray-700">
                          <div>
                            <div class="text-xs text-gray-500 mb-1">SDP Mid</div>
                            <div class="text-sm font-mono text-gray-300">
                              {{ candidate.sdpMid || 'N/A' }}
                            </div>
                          </div>
                          <div>
                            <div class="text-xs text-gray-500 mb-1">SDP MLine Index</div>
                            <div class="text-sm font-mono text-gray-300">
                              {{ candidate.sdpMLineIndex }}
                            </div>
                          </div>
                        </div>

                        <!-- Username Fragment (if available) -->
                        <div v-if="candidate.usernameFragment" class="pt-2 border-t border-gray-700">
                          <div class="flex items-center justify-between">
                            <div class="text-xs text-gray-500">Username Fragment</div>
                            <div class="text-sm font-mono text-purple-400">
                              {{ candidate.usernameFragment }}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Connection Metrics Tab -->
            <div v-if="activeTab === 'metrics'" class="p-6">
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div
                  v-for="[userId, stats] in allStats"
                  :key="userId"
                  class="bg-gray-800 rounded-lg p-4 border border-gray-700"
                >
                  <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-medium text-white">
                      {{ getUserNickname(userId) }}
                    </h3>
                    <div class="flex items-center space-x-2">
                      <div
                        class="w-2 h-2 rounded-full"
                        :class="getConnectionQualityClass(userId)"
                      ></div>
                      <span class="text-xs text-gray-400">
                        {{ getConnectionQuality(userId).quality }}
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
                        {{ getConnectionQuality(userId).score }}/100
                      </span>
                    </div>
                    <div class="w-full bg-gray-700 rounded-full h-2">
                      <div
                        class="h-2 rounded-full transition-all duration-300"
                        :class="getQualityScoreClass(getConnectionQuality(userId).score)"
                        :style="{ width: getConnectionQuality(userId).score + '%' }"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Network Path Tab -->
            <div v-if="activeTab === 'network'" class="p-6">
              <div class="space-y-4">
                <div
                  v-for="[userId, debugInfo] in networkInfo"
                  :key="userId"
                  class="bg-gray-800 rounded-lg p-4 border border-gray-700"
                >
                  <h3 class="text-sm font-medium text-white mb-3">
                    {{ getUserNickname(userId) }}
                  </h3>
                  
                  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                    <div>
                      <div class="text-gray-500 mb-1">ICE State</div>
                      <div class="text-white font-mono">
                        {{ debugInfo.iceState }}
                      </div>
                    </div>
                    <div>
                      <div class="text-gray-500 mb-1">Connection State</div>
                      <div class="text-white font-mono">
                        {{ debugInfo.connectionState }}
                      </div>
                    </div>
                    <div>
                      <div class="text-gray-500 mb-1">Signaling State</div>
                      <div class="text-white font-mono">
                        {{ debugInfo.signalingState }}
                      </div>
                    </div>
                    <div>
                      <div class="text-gray-500 mb-1">Gathering State</div>
                      <div class="text-white font-mono">
                        {{ debugInfo.iceGatheringState }}
                      </div>
                    </div>
                  </div>

                  <!-- Candidates -->
                  <div class="mt-4 space-y-2">
                    <div class="text-xs text-gray-500">Local Candidates</div>
                    <div class="bg-gray-900 rounded p-2 max-h-24 overflow-y-auto">
                      <div
                        v-for="(candidate, index) in debugInfo.localCandidates"
                        :key="'local-' + index"
                        class="text-xs font-mono text-gray-400 mb-1"
                      >
                        {{ formatCandidate(candidate) }}
                      </div>
                    </div>
                    
                    <div class="text-xs text-gray-500">Remote Candidates</div>
                    <div class="bg-gray-900 rounded p-2 max-h-24 overflow-y-auto">
                      <div
                        v-for="(candidate, index) in debugInfo.remoteCandidates"
                        :key="'remote-' + index"
                        class="text-xs font-mono text-gray-400 mb-1"
                      >
                        {{ formatCandidate(candidate) }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Logs Tab -->
            <div v-if="activeTab === 'logs'" class="p-6">
              <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div class="flex items-center justify-between mb-4">
                  <h3 class="text-sm font-medium text-white">Connection Logs</h3>
                  <button
                    @click="clearLogs"
                    class="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
                  >
                    Clear Logs
                  </button>
                </div>
                
                <div class="space-y-2 max-h-96 overflow-y-auto">
                  <div
                    v-for="log in connectionLogs"
                    :key="log.id"
                    class="flex items-start space-x-3 text-xs p-2 rounded"
                    :class="getLogStyle(log.level)"
                  >
                    <span class="text-gray-500 font-mono">{{ formatTime(log.timestamp) }}</span>
                    <span class="font-mono">{{ log.userId || 'System' }}</span>
                    <span class="flex-1">{{ log.message }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Issues Tab -->
            <div v-if="activeTab === 'issues'" class="p-6">
              <div class="space-y-4">
                <div
                  v-for="[userId, issues] in connectionIssues"
                  :key="userId"
                  class="bg-gray-800 rounded-lg p-4 border border-gray-700"
                >
                  <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-medium text-white">
                      {{ getUserNickname(userId) }}
                    </h3>
                    <div
                      class="px-2 py-1 text-xs rounded-full"
                      :class="getIssuesBadgeClass(issues.quality)"
                    >
                      {{ issues.quality.toUpperCase() }}
                    </div>
                  </div>

                  <div v-if="issues.issues.length > 0" class="space-y-2">
                    <div class="text-xs text-gray-500 mb-2">Detected Issues:</div>
                    <div
                      v-for="issue in issues.issues"
                      :key="issue"
                      class="flex items-center space-x-2 text-xs"
                    >
                      <PhWarning class="w-3 h-3 text-yellow-400" />
                      <span class="text-gray-300">{{ issue }}</span>
                    </div>
                  </div>

                  <div v-if="issues.suggestions.length > 0" class="mt-4 space-y-2">
                    <div class="text-xs text-gray-500 mb-2">Suggested Actions:</div>
                    <div
                      v-for="suggestion in issues.suggestions"
                      :key="suggestion"
                      class="flex items-start space-x-2 text-xs"
                    >
                      <PhInfo class="w-3 h-3 text-blue-400 mt-0.5" />
                      <span class="text-gray-300">{{ suggestion }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { webRTCStatsCollector } from '@/services/webrtc-stats'
import type { ConnectionStats, ConnectionQuality, DebugInfo, ConnectionLog } from '@/types'
import {
  PhBug,
  PhWarning,
  PhInfo,
  PhCopy
} from '@phosphor-icons/vue'

interface Props {
  users: any[]
  peerConnections: Map<string, RTCPeerConnection>
  getConnectionQuality: (userId: string) => ConnectionQuality
}

const props = defineProps<Props>()

// Component state
const isVisible = ref(false)
const activeTab = ref<'metrics' | 'network' | 'logs' | 'issues' | 'ice-candidates'>('metrics')
const connectionLogs = ref<ConnectionLog[]>([])
const networkInfo = ref<Map<string, DebugInfo>>(new Map())
const updateInterval = ref<number>()

const tabs = [
  { id: 'metrics' as const, label: 'Metrics' },
  { id: 'network' as const, label: 'Network' },
  { id: 'logs' as const, label: 'Logs' },
  { id: 'issues' as const, label: 'Issues' },
  { id: 'ice-candidates' as const, label: 'Outgoing ICE candidates' }
]

// Computed properties
const allStats = computed(() => webRTCStatsCollector.getAllPeerStats())
const allOutgoingIceCandidates = computed(() => webRTCStatsCollector.getAllOutgoingIceCandidates())


const connectionIssues = computed(() => {
  const issues = new Map<string, { quality: ConnectionQuality['quality'], issues: string[], suggestions: string[] }>()
  
  allStats.value.forEach((stats, userId) => {
    const quality = props.getConnectionQuality(userId)
    const suggestions = generateSuggestions(quality)
    
    issues.set(userId, {
      quality: quality.quality,
      issues: quality.issues,
      suggestions
    })
  })
  
  return issues
})

// Methods
const toggleDashboard = () => {
  isVisible.value = !isVisible.value
}

const getUserNickname = (userId: string): string => {
  const user = props.users.find(u => u.id === userId)
  return user?.nickname || userId
}

const getConnectionQualityClass = (userId: string): string => {
  const quality = props.getConnectionQuality(userId)
  switch (quality.quality) {
    case 'excellent': return 'bg-green-400'
    case 'good': return 'bg-blue-400'
    case 'fair': return 'bg-yellow-400'
    case 'poor': return 'bg-red-400'
    default: return 'bg-gray-400'
  }
}

const getQualityScoreClass = (score: number): string => {
  if (score >= 85) return 'bg-green-400'
  if (score >= 70) return 'bg-blue-400'
  if (score >= 50) return 'bg-yellow-400'
  return 'bg-red-400'
}

const getLogStyle = (level: 'info' | 'warning' | 'error'): string => {
  switch (level) {
    case 'error': return 'bg-red-900/30 text-red-300'
    case 'warning': return 'bg-yellow-900/30 text-yellow-300'
    default: return 'bg-gray-900/30 text-gray-300'
  }
}

const getIssuesBadgeClass = (quality: string): string => {
  switch (quality) {
    case 'EXCELLENT': return 'bg-green-600 text-white'
    case 'GOOD': return 'bg-blue-600 text-white'
    case 'FAIR': return 'bg-yellow-600 text-white'
    case 'POOR': return 'bg-red-600 text-white'
    default: return 'bg-gray-600 text-white'
  }
}

const formatCandidate = (candidate: RTCIceCandidateInit): string => {
  if (!candidate.candidate) return 'Empty candidate'
  return candidate.candidate.split('\n')[0] || candidate.candidate
}

const formatTime = (timestamp: Date): string => {
  return timestamp.toLocaleTimeString()
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const generateSuggestions = (quality: ConnectionQuality): string[] => {
  const suggestions: string[] = []
  
  quality.issues.forEach(issue => {
    if (issue.includes('packet loss')) {
      suggestions.push('Check network stability and consider using a wired connection')
      suggestions.push('Ensure sufficient bandwidth is available')
    }
    if (issue.includes('jitter')) {
      suggestions.push('Close other applications that might be using the network')
      suggestions.push('Try moving closer to your Wi-Fi router')
    }
    if (issue.includes('latency')) {
      suggestions.push('Check if you are connecting to servers in a distant region')
      suggestions.push('Consider using a VPN to improve routing')
    }
    if (issue.includes('not stable')) {
      suggestions.push('Wait a few moments for the connection to stabilize')
      suggestions.push('Try reconnecting if the issue persists')
    }
  })
  
  return suggestions
}

const updateNetworkInfo = () => {
  const info = new Map<string, DebugInfo>()
  
  props.peerConnections.forEach((pc, userId) => {
    info.set(userId, {
      peerId: userId,
      iceState: pc.iceConnectionState,
      connectionState: pc.connectionState,
      signalingState: pc.signalingState,
      iceGatheringState: pc.iceGatheringState,
      localCandidates: [],
      remoteCandidates: [],
      localDescription: pc.localDescription,
      remoteDescription: pc.remoteDescription
    })
  })
  
  networkInfo.value = info
}

const addLog = (message: string, level: 'info' | 'warning' | 'error' = 'info', userId?: string) => {
  connectionLogs.value.push({
    id: Date.now() + Math.random(),
    timestamp: new Date(),
    level,
    message,
    userId
  })
  
  // Keep only last 100 logs
  if (connectionLogs.value.length > 100) {
    connectionLogs.value = connectionLogs.value.slice(-100)
  }
}

const clearLogs = () => {
  connectionLogs.value = []
}

const copyCandidateToClipboard = async (candidate: any) => {
  try {
    const candidateJson = JSON.stringify(candidate, null, 2)
    await navigator.clipboard.writeText(candidateJson)
    addLog(`Copied ICE candidate for ${candidate.type} to clipboard`, 'info')
  } catch (error) {
    addLog('Failed to copy candidate to clipboard', 'error')
    console.error('Failed to copy candidate:', error)
  }
}

const getCandidateTypeColor = (type: string): string => {
  switch (type.toLowerCase()) {
    case 'host': return 'bg-green-400'
    case 'srflx': return 'bg-blue-400'
    case 'prflx': return 'bg-yellow-400'
    case 'relay': return 'bg-purple-400'
    default: return 'bg-gray-400'
  }
}

// Expose methods to parent components
defineExpose({
  addLog,
  clearLogs
})

// Lifecycle
onMounted(() => {
  // Update network info periodically
  updateInterval.value = window.setInterval(() => {
    updateNetworkInfo()
  }, 2000)
  
  // Add initial log
  addLog('Debug dashboard initialized', 'info')
})

onUnmounted(() => {
  if (updateInterval.value) {
    clearInterval(updateInterval.value)
  }
})
</script>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>