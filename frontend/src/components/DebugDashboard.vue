<template>
  <div class="debug-dashboard">
    <DebugToggle
      v-if="!hideToggleButton"
      :is-visible="isVisible"
      @toggle="toggleDashboard"
    />

    <!-- Debug Panel -->
    <Transition name="slide-up">
      <div
        v-if="isVisible"
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 flex items-end justify-center"
        @click.self="handleOverlayClick"
      >
        <div class="bg-gray-900 border-t border-gray-700 w-full max-h-[80vh] overflow-hidden">
          <DebugHeader :active-tab="activeTab" :tabs="tabs" @tab-change="onTabChange" />

          <!-- Content -->
          <div class="overflow-y-auto max-h-[60vh]">
            <template v-if="!isUnmounting">
              <component :is="currentTabComponent" v-bind="currentTabProps" />
            </template>

            <div v-else class="p-6 text-center text-gray-400">
              Component is unmounting...
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, type Component } from 'vue'
import type { ConnectionQuality, DebugInfo, ConnectionLog, ScreenShareQuality } from '@/types'
import DebugToggle from './debug/DebugToggle.vue'
import DebugHeader from './debug/DebugHeader.vue'
import MetricsTab from './debug/MetricsTab.vue'
import NetworkTab from './debug/NetworkTab.vue'
import LogsTab from './debug/LogsTab.vue'
import IssuesTab from './debug/IssuesTab.vue'
import ScreenShareTab from './debug/ScreenShareTab.vue'
import AudioTab from './debug/AudioTab.vue'

interface ScreenShareDebugInfo {
  userId: string
  userNickname: string
  stream: MediaStream | null
  quality: ScreenShareQuality
  connectionState: string
}

interface Props {
  users: Array<{ id: string; nickname: string; stream?: MediaStream }>
  peerConnections: Map<string, RTCPeerConnection>
  getConnectionQuality: (userId: string) => ConnectionQuality
  localStream?: MediaStream | null
  localScreenShares?: ScreenShareDebugInfo[]
  remoteScreenShares?: ScreenShareDebugInfo[]
  modelValueVisible?: boolean
  hideToggleButton?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValueVisible: undefined,
  hideToggleButton: false
})

const emit = defineEmits<{
  'update:modelValueVisible': [value: boolean]
}>()

// Component state - use v-model if provided, otherwise internal state
const internalVisible = ref(false)
const isVisible = computed({
  get: () => props.modelValueVisible !== undefined ? props.modelValueVisible : internalVisible.value,
  set: (value) => {
    if (props.modelValueVisible !== undefined) {
      emit('update:modelValueVisible', value)
    } else {
      internalVisible.value = value
    }
  }
})
const activeTab = ref<'metrics' | 'network' | 'screen-share' | 'logs' | 'issues' | 'audio'>('metrics')
const connectionLogs = ref<ConnectionLog[]>([])
const networkInfo = ref<Map<string, DebugInfo>>(new Map())
const updateInterval = ref<number>()
const isUnmounting = ref(false)

const tabs = [
  { id: 'metrics' as const, label: 'Metrics' },
  { id: 'network' as const, label: 'Network' },
  { id: 'audio' as const, label: 'Audio' },
  { id: 'screen-share' as const, label: 'Screen Share' },
  { id: 'logs' as const, label: 'Logs' },
  { id: 'issues' as const, label: 'Issues' }
]

// Computed properties
// WebRTC stats removed - LiveKit handles connections internally
const allStats = computed(() => new Map())
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allOutgoingIceCandidates = computed(() => new Map()) // Preserved for future use

const currentTabComponent = computed<Component | null>(() => {
  switch (activeTab.value) {
    case 'metrics': return MetricsTab as Component
    case 'network': return NetworkTab as Component
    case 'audio': return AudioTab as Component
    case 'screen-share': return ScreenShareTab as Component
    case 'logs': return LogsTab as Component
    case 'issues': return IssuesTab as Component
    default: return null
  }
})

const currentTabProps = computed(() => {
  switch (activeTab.value) {
    case 'metrics':
      return {
        'stats-map': allStats.value,
        'get-connection-quality': props.getConnectionQuality,
        'get-user-nickname': getUserNickname
      }
    case 'network':
      return {
        'network-info': networkInfo.value,
        'get-user-nickname': getUserNickname
      }
    case 'audio':
      return {
        'local-stream': props.localStream
      }
    case 'screen-share':
      return {
        'local-screen-shares': formatScreenShareData(props.localScreenShares || []),
        'remote-screen-shares': formatScreenShareData(props.remoteScreenShares || [])
      }
    case 'logs':
      return {
        'logs': connectionLogs.value,
        'onClearLogs': clearLogs
      }
    case 'issues':
      return {
        'connection-issues': connectionIssues.value,
        'get-user-nickname': getUserNickname
      }
    default:
      return {}
  }
})

const formatScreenShareData = (shares: ScreenShareDebugInfo[]) => {
  return shares.map(share => {
    const stream = share.stream
    const videoTracks = stream?.getVideoTracks() || []
    const audioTracks = stream?.getAudioTracks() || []
    const videoTrack = videoTracks[0]
    
    return {
      userId: share.userId,
      userNickname: share.userNickname,
      stream: stream,
      quality: share.quality,
      hasVideo: videoTracks.length > 0,
      hasAudio: audioTracks.length > 0,
      videoWidth: videoTrack?.getSettings().width || 0,
      videoHeight: videoTrack?.getSettings().height || 0,
      connectionState: share.connectionState,
      trackCount: (stream?.getTracks().length || 0),
      active: videoTrack?.enabled || false
    }
  })
}


const connectionIssues = computed(() => {
  const issues = new Map<string, { quality: ConnectionQuality['quality'], issues: string[], suggestions: string[] }>()

  try {
    allStats.value.forEach((_, userId) => {
      const quality = props.getConnectionQuality(String(userId))
      if (!quality) return

      const suggestions = generateSuggestions(quality)

      issues.set(String(userId), {
        quality: quality.quality,
        issues: quality.issues,
        suggestions
      })
    })
  } catch (error) {
    console.warn('Error computing connection issues:', error instanceof Error ? error.message : String(error))
  }

  return issues
})

// Methods
const toggleDashboard = () => {
  if (isUnmounting.value) return
  isVisible.value = !isVisible.value
}

const handleOverlayClick = (event: MouseEvent) => {
  // Prevent closing if clicking on child elements
  if (event.target === event.currentTarget && !isUnmounting.value) {
    toggleDashboard()
  }
}

const onTabChange = (tabId: string) => {
  if (isUnmounting.value) return
  
  try {
    activeTab.value = tabId as typeof activeTab.value
  } catch (error) {
    console.error('Error switching tab:', error instanceof Error ? error.message : String(error))
    addLog('Failed to switch tab', 'error')
  }
}



const getUserNickname = (userId: string): string => {
  const user = props.users.find(u => u.id === userId)
  return user?.nickname || userId
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
  if (isUnmounting.value) return
  
  try {
    const info = new Map<string, DebugInfo>()
    
    props.peerConnections?.forEach((pc, userId) => {
      if (pc) {
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
      }
    })
    
    networkInfo.value = info
  } catch (error) {
    console.warn('Error updating network info:', error instanceof Error ? error.message : String(error))
  }
}

const addLog = (message: string, level: 'info' | 'warning' | 'error' = 'info', userId?: string) => {
  if (isUnmounting.value) return
  
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

// Expose methods for external control
defineExpose({
  addLog,
  clearLogs,
  toggleDashboard
})

// Lifecycle
onMounted(() => {
  // Update network info periodically
  updateInterval.value = window.setInterval(() => {
    void updateNetworkInfo()
  }, 2000)
  
  // Add initial log
  addLog('Debug dashboard initialized', 'info')
})

onUnmounted(() => {
  isUnmounting.value = true
  
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