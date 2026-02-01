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
          <!-- Screen Share Toggle -->
          <button
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
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import UserAvatar from '@/components/UserAvatar.vue'
import {
  PhMicrophone,
  PhMicrophoneSlash,
  PhHeadphones,
  PhMonitorPlay,
  PhSignOut
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
}>()

// Local storage keys
const MUTE_STORAGE_KEY = 'orbital_mic_muted'
const DEAFEN_STORAGE_KEY = 'orbital_deafened'

// Local state refs - initialized from props
const localMuted = ref(props.modelValueMuted)
const localDeafened = ref(props.modelValueDeafened)
const localScreenSharing = ref(props.modelValueScreenSharing)

// Sync local state with props (for bidirectional sync with parent)
watch(() => props.modelValueMuted, (newValue) => {
  if (newValue !== localMuted.value) {
    localMuted.value = newValue
  }
})

watch(() => props.modelValueDeafened, (newValue) => {
  if (newValue !== localDeafened.value) {
    localDeafened.value = newValue
  }
})

watch(() => props.modelValueScreenSharing, (newValue) => {
  if (newValue !== localScreenSharing.value) {
    localScreenSharing.value = newValue
  }
})

// Watch local changes and emit to parent
watch(localMuted, (newValue) => {
  emit('update:modelValueMuted', newValue)
  savePreference(MUTE_STORAGE_KEY, newValue)
})

watch(localDeafened, (newValue) => {
  emit('update:modelValueDeafened', newValue)
  savePreference(DEAFEN_STORAGE_KEY, newValue)
})

watch(localScreenSharing, (newValue) => {
  emit('update:modelValueScreenSharing', newValue)
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
  localMuted.value = !localMuted.value
  emit('toggle-mute', localMuted.value)
}

const toggleDeafen = () => {
  localDeafened.value = !localDeafened.value
  emit('toggle-deafen', localDeafened.value)
}

const toggleScreenShare = () => {
  emit('toggle-screen-share')
}

const leaveRoom = () => {
  emit('leave-room')
}

// Local storage utilities
const savePreference = (key: string, value: boolean) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.warn('Failed to save preference to localStorage:', e)
  }
}

const loadPreference = (key: string, defaultValue: boolean): boolean => {
  try {
    const stored = localStorage.getItem(key)
    return stored !== null ? JSON.parse(stored) : defaultValue
  } catch (e) {
    console.warn('Failed to load preference from localStorage:', e)
    return defaultValue
  }
}

// Initialize from local storage on mount
onMounted(() => {
  const savedMute = loadPreference(MUTE_STORAGE_KEY, props.modelValueMuted)
  const savedDeafen = loadPreference(DEAFEN_STORAGE_KEY, props.modelValueDeafened)

  // Only update if different from current local value
  if (savedMute !== localMuted.value) {
    localMuted.value = savedMute
  }
  if (savedDeafen !== localDeafened.value) {
    localDeafened.value = savedDeafen
  }
})
</script>

<style scoped>
.user-control-panel {
  @apply transition-all duration-200;
}
</style>
