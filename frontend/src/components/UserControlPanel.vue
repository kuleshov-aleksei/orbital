<template>
  <div class="user-control-panel bg-gray-800 border-t border-gray-700">
    <!-- Expanded Panel - Only Visible When In Call (appears above base panel) -->
    <div v-if="isInCall" class="border-b border-gray-700 p-3">
      <div class="flex items-center justify-between">
        <!-- Room Info -->
        <div class="flex items-center min-w-0 flex-1">
          <div
            class="w-2 h-2 rounded-full mr-2 flex-shrink-0"
            :class="connectionStatusColor"
          ></div>

          <div class="min-w-0">
            <div class="text-sm font-medium text-white truncate">
              {{ roomName }}
            </div>

            <div class="text-xs text-gray-400">
              {{ connectionStatusText }} • {{ ping }}ms
            </div>
          </div>
        </div>

        <!-- Call Control Buttons -->
        <div class="flex items-center space-x-2 ml-3">
          <!-- Screen Share Toggle - Hidden on mobile browsers -->
          <button
            v-if="isScreenShareSupported"
            type="button"
            class="w-9 h-9 rounded-lg flex items-center justify-center transition-colors duration-200"
            :class="screenShareButtonClass"
            :title="localScreenSharing ? 'Stop Sharing' : 'Share Screen'"
            @click="toggleScreenShare"
          >
            <PhMonitorPlay class="w-5 h-5" />
          </button>

          <!-- Leave Room Button -->
          <button
            type="button"
            class="w-9 h-9 rounded-lg flex items-center justify-center bg-red-600 hover:bg-red-700 text-white transition-colors duration-200"
            title="Leave Room"
            @click="leaveRoom"
          >
            <PhSignOut class="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>

    <!-- Base Panel - Always Visible -->
    <div class="p-3">
      <div class="flex items-center justify-between">
        <!-- User Info -->
        <div class="flex items-center flex-1 min-w-0">
          <UserAvatar
            :nickname="nickname"
            status="online"
            :size="36"
            class="mr-3 flex-shrink-0"
          />

          <div class="min-w-0">
            <div class="font-medium text-sm text-white truncate">
              {{ nickname }}
            </div>

            <div class="text-xs text-gray-400">
              {{ statusText }}
            </div>
          </div>
        </div>

        <!-- Control Buttons -->
        <div class="flex items-center space-x-2 ml-2">
          <!-- Microphone Toggle -->
          <button
            type="button"
            class="w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-200"
            :class="micButtonClass"
            :title="localMuted ? 'Unmute' : 'Mute'"
            @click="toggleMute"
          >
            <PhMicrophoneSlash v-if="localMuted" class="w-4 h-4" />

            <PhMicrophone v-else class="w-4 h-4" />
          </button>

          <!-- Headphone/Deafen Toggle -->
          <button
            type="button"
            class="w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-200"
            :class="deafenButtonClass"
            :title="localDeafened ? 'Undeafen' : 'Deafen'"
            @click="toggleDeafen"
          >
            <div v-if="localDeafened" class="w-4 h-4 relative">
              <PhHeadphones class="absolute inset-0" />

              <div class="absolute inset-0 flex items-center justify-center">
                <div class="w-4 h-0.5 bg-current rotate-45"></div>
              </div>
            </div>

            <PhHeadphones v-else class="w-4 h-4" />
          </button>

          <!-- Settings Button -->
          <button
            type="button"
            class="w-8 h-8 rounded-full flex items-center justify-center bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-colors duration-200"
            title="Settings"
            @click="openSettings"
          >
            <PhGearSix class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { useModalStore } from '@/stores/modal'
import { useScreenShareSupport } from '@/composables/useScreenShareSupport'
import {
  PhMicrophone,
  PhMicrophoneSlash,
  PhHeadphones,
  PhMonitorPlay,
  PhSignOut,
  PhGearSix
} from '@phosphor-icons/vue'

interface Props {
  nickname: string
  userId: string
  isInCall: boolean
  roomName?: string
  ping?: number
  connectionQuality?: 'excellent' | 'good' | 'fair' | 'poor'
  modelValueMuted?: boolean
  modelValueDeafened?: boolean
  modelValueScreenSharing?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  roomName: '',
  ping: 0,
  connectionQuality: 'excellent',
  modelValueMuted: false,
  modelValueDeafened: false,
  modelValueScreenSharing: false
})

const emit = defineEmits<{
  'update:modelValueMuted': [value: boolean]
  'update:modelValueDeafened': [value: boolean]
  'update:modelValueScreenSharing': [value: boolean]
  'toggle-mute': [isMuted: boolean]
  'toggle-deafen': [isDeafened: boolean]
  'toggle-screen-share': []
  'leave-room': []
  'open-settings': []
}>()

// Stores
const modalStore = useModalStore()

// Screen share support detection
const { isScreenShareSupported } = useScreenShareSupport()

// Computed properties for v-model support - parent controls all state
const localMuted = computed({
  get: () => props.modelValueMuted,
  set: (value) => emit('update:modelValueMuted', value)
})

const localDeafened = computed({
  get: () => props.modelValueDeafened,
  set: (value) => emit('update:modelValueDeafened', value)
})

const localScreenSharing = computed({
  get: () => props.modelValueScreenSharing,
  set: (value) => emit('update:modelValueScreenSharing', value)
})

// Button styling
const micButtonClass = computed(() => {
  return localMuted.value
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white'
})

const deafenButtonClass = computed(() => {
  return localDeafened.value
    ? 'bg-red-600 hover:bg-red-700 text-white'
    : 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white'
})

const screenShareButtonClass = computed(() => {
  return localScreenSharing.value
    ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
    : 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white'
})

// Status text
const statusText = computed(() => {
  if (localDeafened.value) return 'Deafened'
  if (localMuted.value) return 'Muted'
  return 'Online'
})

// Connection status
const connectionStatusText = computed(() => {
  switch (props.connectionQuality) {
    case 'excellent':
      return 'Excellent'
    case 'good':
      return 'Good'
    case 'fair':
      return 'Fair'
    case 'poor':
      return 'Poor'
    default:
      return 'Connected'
  }
})

const connectionStatusColor = computed(() => {
  switch (props.connectionQuality) {
    case 'excellent':
      return 'bg-green-400'
    case 'good':
      return 'bg-green-500'
    case 'fair':
      return 'bg-yellow-400'
    case 'poor':
      return 'bg-red-400'
    default:
      return 'bg-green-400'
  }
})

// Methods
const toggleMute = () => {
  const newValue = !localMuted.value
  localMuted.value = newValue
  emit('toggle-mute', newValue)
}

const toggleDeafen = () => {
  const newValue = !localDeafened.value
  localDeafened.value = newValue
  emit('toggle-deafen', newValue)
}

const toggleScreenShare = () => {
  emit('toggle-screen-share')
}

const leaveRoom = () => {
  emit('leave-room')
}

const openSettings = () => {
  modalStore.openUserSettingsModal()
  emit('open-settings')
}
</script>

<style scoped>
.user-control-panel {
  @apply transition-all duration-200;
}
</style>
