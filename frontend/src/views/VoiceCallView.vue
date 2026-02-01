<template>
  <div class="voice-call-view flex-1 flex flex-col" data-testid="voice-call-view">
    <!-- Room Header -->
    <header class="bg-gray-800 px-6 py-4 border-b border-gray-700">
      <div class="flex items-center justify-between">
        <div class="flex items-center">
           <!-- Back to room list button (mobile only, doesn't leave room) -->
           <button
             v-if="isMobile"
             data-testid="back-to-rooms"
             class="mr-4 text-gray-400 hover:text-white transition-colors duration-200"
             title="Back to room list"
             @click="$emit('show-room-list')"
           >
             <PhArrowLeft class="w-5 h-5" />
           </button>
           
           <!-- Leave room button (desktop only) -->
           <button
             v-else
             data-testid="leave-room-header"
             class="mr-4 text-gray-400 hover:text-white transition-colors duration-200"
             @click="$emit('leave-room')"
           >
             <PhArrowLeft class="w-5 h-5" />
           </button>
           
            <div>
              <h1 
                class="text-xl font-semibold text-white cursor-pointer hover:text-indigo-400 transition-colors duration-200" 
                :class="{ 'cursor-pointer': isMobile }"
                data-testid="room-title"
                @click="isMobile && $emit('toggle-user-sidebar')"
              >
                {{ currentRoom?.name || 'Voice Room' }}
              </h1>
              <div class="flex items-center text-sm text-gray-400">
                <span>{{ users.length }} users</span>
                <span v-if="screenShareData.length > 0" class="ml-2 text-indigo-400 flex items-center">
                  <span class="mx-1.5">•</span>
                  <PhMonitorPlay class="w-3.5 h-3.5 mr-1" />
                  {{ screenShareData.length }} sharing
                </span>
              </div>
            </div>
        </div>
        
        <div class="flex items-center space-x-2">
          <!-- Screen Share Layout Toggle (when sharing active) -->
          <template v-if="screenShareData.length > 0">
            <div class="flex bg-gray-700 rounded-lg p-0.5">
              <button
                class="px-2 py-1 rounded-md text-xs transition-colors flex items-center"
                :class="[
                  screenShareLayout === 'grid'
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-white'
                ]"
                @click="screenShareLayout = 'grid'"
              >
                <PhGridFour class="w-3.5 h-3.5 mr-1" />
                Grid
              </button>
              <button
                class="px-2 py-1 rounded-md text-xs transition-colors flex items-center"
                :class="[
                  screenShareLayout === 'focus'
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-white'
                ]"
                @click="screenShareLayout = 'focus'"
              >
                <PhArrowsOut class="w-3.5 h-3.5 mr-1" />
                Focus
              </button>
            </div>
            
            <!-- Toggle User Grid Visibility -->
            <button
              class="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
              :title="isUserGridVisible ? 'Hide user grid' : 'Show user grid'"
              @click="isUserGridVisible = !isUserGridVisible"
            >
              <PhEye v-if="isUserGridVisible" class="w-4 h-4" />
              <PhEyeSlash v-else class="w-4 h-4" />
            </button>
          </template>
          
          <!-- Mobile: Users count button to toggle sidebar -->
          <button
            v-if="isMobile"
            class="flex items-center px-3 py-1.5 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors duration-200"
            @click="$emit('toggle-user-sidebar')"
          >
            <PhUsers class="w-4 h-4 mr-2" />
            <span class="text-sm">{{ users.length }}</span>
          </button>
          
          <!-- Desktop: Connection Status and Settings -->
          <template v-if="!isMobile">
            <div class="flex items-center text-sm">
              <div class="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
              <span class="text-gray-300">Connected</span>
            </div>
            
            <button class="p-2 text-gray-400 hover:text-white transition-colors duration-200">
              <PhGearSix class="w-5 h-5" />
            </button>
          </template>
        </div>
      </div>
    </header>

    <!-- Screen Share Quality Modal -->
    <ScreenShareQualityModal
      :is-open="showQualityModal"
      @select-quality="handleQualitySelected"
      @cancel="showQualityModal = false"
    />

    <!-- Main Call Area -->
    <main class="flex-1 flex flex-col min-h-0 overflow-hidden">
      <!-- Screen Share Area -->
      <ScreenShareArea
        v-if="screenShareData.length > 0"
        :screen-shares="screenShareData"
        :is-user-grid-visible="isUserGridVisible"
        :layout="screenShareLayout"
        class="flex-shrink-0 m-4"
        @update:layout="screenShareLayout = $event"
        @toggle-user-grid="isUserGridVisible = !isUserGridVisible"
      />

      <!-- User Grid -->
      <div
        v-show="isUserGridVisible || screenShareData.length === 0"
        class="flex-1 p-4 lg:p-6 overflow-y-auto"
      >
        <div v-if="users.length > 0" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-6xl mx-auto">
          <div
            v-for="user in users"
            :key="user.id"
            class="relative"
          >
            <AudioStream
              :user-id="user.id"
              :user-nickname="user.nickname || 'Unknown'"
              :stream="remoteStreams.get(user.id)"
              :connection-state="peerConnectionStates.get(user.id)"
              :initial-volume="props.remoteStreamVolumes.get(user.id) || 80"
              :is-deafened="isDeafened"
              :is-screen-sharing="userScreenShareStates.get(user.id)?.isSharing || false"
              :screen-share-quality="userScreenShareStates.get(user.id)?.quality"
              @volume-change="handleVolumeChange"
              @mute-toggle="handleMuteToggle"
              @audio-level="handleAudioLevel"
            />
          </div>
        </div>

         <!-- Empty State -->
         <div v-else class="flex items-center justify-center h-full">
           <div class="text-center">
             <div class="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
               <PhMicrophone class="w-10 h-10 text-gray-600" />
             </div>
             <h3 class="text-xl font-semibold text-white mb-2">Waiting for others...</h3>
             <p class="text-gray-400">You're the first one here. Invite some friends to join!</p>
           </div>
         </div>
        </div>

        <!-- Audio Controls -->
        <div class="bg-gray-800 border-t border-gray-700 px-6 py-4">
          <AudioControls
            :is-muted="isMuted"
            :is-deafened="isDeafened"
            :is-screen-sharing="isScreenSharing"
            @toggle-mute="toggleMute"
            @toggle-deafen="toggleDeafen"
            @toggle-screen-share="toggleScreenShare"
            @leave-room="$emit('leave-room')"
          />
        </div>
      </main>
      
      <!-- Debug Dashboard -->
      <DebugDashboard
        ref="debugDashboardRef"
        :users="props.users"
        :peer-connections="peerConnections"
        :get-connection-quality="getConnectionQuality"
        :local-screen-shares="localScreenShareDebugData"
        :remote-screen-shares="remoteScreenShareDebugData"
      />
  </div>
</template>

 <script setup lang="ts">
 import { computed, ref } from 'vue'
 import AudioControls from '@/components/AudioControls.vue'
 import AudioStream from '@/components/AudioStream.vue'
 import DebugDashboard from '@/components/DebugDashboard.vue'
 import ScreenShareArea from '@/components/ScreenShareArea.vue'
 import ScreenShareQualityModal from '@/components/ScreenShareQualityModal.vue'
 import { useWebRTC } from '@/composables'
 import type { User, ScreenShareQuality } from '@/types'
 import {
     PhArrowLeft,
     PhGearSix,
     PhMicrophone,
     PhUsers,
     PhMonitorPlay,
     PhGridFour,
     PhArrowsOut,
     PhEye,
     PhEyeSlash
   } from '@phosphor-icons/vue'

interface Props {
  roomId: string
  roomName: string
  users: User[]
  remoteStreamVolumes: Map<string, number>
  isMobile?: boolean
  modelValueMuted?: boolean
  modelValueDeafened?: boolean
  modelValueScreenSharing?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isMobile: false,
  modelValueMuted: false,
  modelValueDeafened: false,
  modelValueScreenSharing: false
})

const emit = defineEmits<{
  'leave-room': []
  'volume-change': [userId: string, volume: number]
  'show-room-list': []
  'toggle-user-sidebar': []
  'update:modelValueMuted': [value: boolean]
  'update:modelValueDeafened': [value: boolean]
  'update:modelValueScreenSharing': [value: boolean]
  'ping-update': [ping: number, quality: 'excellent' | 'good' | 'fair' | 'poor']
}>()

// UI State (layout and display preferences)
const showQualityModal = ref(false)
const isUserGridVisible = ref(true)
const screenShareLayout = ref<'grid' | 'focus'>('focus')
const debugDashboardRef = ref()

// Debug logging callback
const onDebugLog = (message: string, level: 'info' | 'warning' | 'error' = 'info', userId?: string) => {
  if (debugDashboardRef.value && debugDashboardRef.value.addLog) {
    debugDashboardRef.value.addLog(message, level, userId)
  }
}

// Initialize WebRTC composable - destructure for template reactivity
const {
  remoteStreams,
  peerConnections,
  peerConnectionStates,
  isScreenSharing,
  userScreenShareStates,
  screenShareData,
  localScreenShareDebugData,
  remoteScreenShareDebugData,
  handleMuteToggle,
  handleAudioLevel,
  startScreenShare,
  stopScreenShare,
  getConnectionQuality,
  applyMuteState,
  applyDeafenState
} = useWebRTC({
  roomId: props.roomId,
  roomName: props.roomName,
  users: props.users,
  remoteStreamVolumes: props.remoteStreamVolumes,
  onVolumeChange: (userId: string, volume: number) => {
    emit('volume-change', userId, volume)
  },
  onPingUpdate: (ping: number, quality: 'excellent' | 'good' | 'fair' | 'poor') => {
    emit('ping-update', ping, quality)
  },
  onDebugLog
})

// Computed properties for v-model support
const isMuted = computed({
  get: () => props.modelValueMuted,
  set: (value) => {
    emit('update:modelValueMuted', value)
    applyMuteState(value)
  }
})

const isDeafened = computed({
  get: () => props.modelValueDeafened,
  set: (value) => {
    emit('update:modelValueDeafened', value)
    applyDeafenState(value)
  }
})

// Current room info
const currentRoom = computed(() => {
  return {
    name: props.roomName || 'Voice Room',
    id: props.roomId
  }
})

// Event handlers
const handleVolumeChange = (userId: string, volume: number) => {
  console.log(`🔊 Volume changed for user ${userId}: ${volume}`)
  emit('volume-change', userId, volume)
}

const toggleMute = () => {
  isMuted.value = !isMuted.value
}

const toggleDeafen = () => {
  isDeafened.value = !isDeafened.value
  console.log('Deafen status:', isDeafened.value)
}

const toggleScreenShare = () => {
  console.log("toggleScreenShare called, isScreenSharing: " + isScreenSharing.value)
  if (isScreenSharing.value) {
    stopScreenShare()
    emit('update:modelValueScreenSharing', false)
  } else {
    showQualityModal.value = true
  }
}

const handleQualitySelected = async (quality: ScreenShareQuality, shareAudio: boolean) => {
  showQualityModal.value = false
  
  try {
    await startScreenShare(quality, shareAudio)
    emit('update:modelValueScreenSharing', true)
  } catch (error) {
    console.error('Failed to start screen share:', error)
    onDebugLog(`Failed to start screen share: ${(error as Error).message}`, 'error')
  }
}

// Expose methods for parent component access
defineExpose({
  toggleScreenShare
})
</script>
