<template>
  <div class="p-4 space-y-6">
    <!-- Audio Settings Section -->
    <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <PhSpeakerHigh class="w-5 h-5 text-indigo-400" />
        Audio Settings
      </h3>

      <div class="space-y-4">
        <!-- Noise Suppression -->
        <div class="flex items-center justify-between py-2 border-b border-gray-700">
          <div>
            <span class="text-sm font-medium text-gray-200">Noise Suppression</span>

            <p class="text-xs text-gray-400">Reduces background noise</p>
          </div>

          <span
            class="px-3 py-1 rounded-full text-sm font-medium"
            :class="audioStore.noiseSuppressionEnabled ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'"
          >
            {{ audioStore.noiseSuppressionEnabled ? 'ON' : 'OFF' }}
          </span>
        </div>

        <!-- Algorithm -->
        <div class="flex items-center justify-between py-2 border-b border-gray-700">
          <div>
            <span class="text-sm font-medium text-gray-200">Algorithm</span>

            <p class="text-xs text-gray-400">Current noise suppression method</p>
          </div>

          <span class="px-3 py-1 rounded-full text-sm font-medium bg-blue-900 text-blue-300">
            {{ algorithmDisplayName }}
          </span>
        </div>

        <!-- Echo Cancellation -->
        <div class="flex items-center justify-between py-2 border-b border-gray-700">
          <div>
            <span class="text-sm font-medium text-gray-200">Echo Cancellation</span>

            <p class="text-xs text-gray-400">Prevents audio feedback loop</p>
          </div>

          <span
            class="px-3 py-1 rounded-full text-sm font-medium"
            :class="audioStore.echoCancellationEnabled ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'"
          >
            {{ audioStore.echoCancellationEnabled ? 'ON' : 'OFF' }}
          </span>
        </div>

        <!-- Auto Gain Control -->
        <div class="flex items-center justify-between py-2">
          <div>
            <span class="text-sm font-medium text-gray-200">Auto Gain Control</span>

            <p class="text-xs text-gray-400">Normalizes microphone volume</p>
          </div>

          <span
            class="px-3 py-1 rounded-full text-sm font-medium"
            :class="audioStore.autoGainControlEnabled ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'"
          >
            {{ audioStore.autoGainControlEnabled ? 'ON' : 'OFF' }}
          </span>
        </div>
      </div>
    </div>

    <!-- MediaStreamTrack Constraints -->
    <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <PhMicrophone class="w-5 h-5 text-indigo-400" />
        Applied Constraints
      </h3>

      <div v-if="trackConstraints" class="space-y-3">
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-gray-900 rounded p-3">
            <span class="text-xs text-gray-400 block mb-1">Noise Suppression</span>

            <span class="text-sm font-mono text-white">{{ formatConstraintValue(trackConstraints.noiseSuppression) }}</span>
          </div>

          <div class="bg-gray-900 rounded p-3">
            <span class="text-xs text-gray-400 block mb-1">Echo Cancellation</span>

            <span class="text-sm font-mono text-white">{{ formatConstraintValue(trackConstraints.echoCancellation) }}</span>
          </div>

          <div class="bg-gray-900 rounded p-3">
            <span class="text-xs text-gray-400 block mb-1">Auto Gain Control</span>

            <span class="text-sm font-mono text-white">{{ formatConstraintValue(trackConstraints.autoGainControl) }}</span>
          </div>

          <div class="bg-gray-900 rounded p-3">
            <span class="text-xs text-gray-400 block mb-1">Sample Rate</span>

            <span class="text-sm font-mono text-white">{{ trackConstraints.sampleRate || 'Not set' }}</span>
          </div>

          <div class="bg-gray-900 rounded p-3">
            <span class="text-xs text-gray-400 block mb-1">Channel Count</span>

            <span class="text-sm font-mono text-white">{{ trackConstraints.channelCount || 'Not set' }}</span>
          </div>
        </div>

        <div class="mt-4 p-3 bg-gray-900 rounded">
          <span class="text-xs text-gray-400 block mb-2">Full Constraints Object:</span>

          <pre class="text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap">{{ JSON.stringify(trackConstraints, null, 2) }}</pre>
        </div>
      </div>

      <div v-else class="text-center py-8 text-gray-400">
        <PhMicrophoneSlash class="w-12 h-12 mx-auto mb-2 opacity-50" />

        <p>No active audio track found</p>

        <p class="text-sm mt-1">Join a room to see audio constraints</p>
      </div>
    </div>

    <!-- Audio Track Settings (Actual Applied) -->
    <div v-if="trackSettings" class="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <PhSliders class="w-5 h-5 text-indigo-400" />
        Track Settings (Actual Applied)
      </h3>

      <div class="grid grid-cols-2 gap-4">
        <div class="bg-gray-900 rounded p-3">
          <span class="text-xs text-gray-400 block mb-1">Device ID</span>

          <span class="text-sm font-mono text-white truncate">{{ trackSettings.deviceId || 'Default' }}</span>
        </div>

        <div class="bg-gray-900 rounded p-3">
          <span class="text-xs text-gray-400 block mb-1">Sample Rate</span>

          <span class="text-sm font-mono text-white">{{ trackSettings.sampleRate ? `${trackSettings.sampleRate} Hz` : 'Not reported' }}</span>
        </div>

        <div class="bg-gray-900 rounded p-3">
          <span class="text-xs text-gray-400 block mb-1">Channel Count</span>

          <span class="text-sm font-mono text-white">{{ trackSettings.channelCount ?? 'Not reported' }}</span>
        </div>

        <div class="bg-gray-900 rounded p-3">
          <span class="text-xs text-gray-400 block mb-1">Volume</span>

          <span class="text-sm font-mono text-white">{{ trackSettings.volume !== undefined ? `${Math.round(trackSettings.volume * 100)}%` : 'Not reported' }}</span>
        </div>
      </div>

      <div class="mt-4 p-3 bg-gray-900 rounded">
        <span class="text-xs text-gray-400 block mb-2">Full Settings Object:</span>

        <pre class="text-xs font-mono text-blue-400 overflow-x-auto whitespace-pre-wrap">{{ JSON.stringify(trackSettings, null, 2) }}</pre>
      </div>
    </div>

    <!-- Refresh Button -->
    <div class="flex justify-end">
      <button
        type="button"
        class="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        @click="refreshAudioInfo"
      >
        <PhArrowClockwise class="w-4 h-4" />
        Refresh Audio Info
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useAudioSettingsStore } from '@/stores/audioSettings'
import {
  PhSpeakerHigh,
  PhMicrophone,
  PhMicrophoneSlash,
  PhSliders,
  PhArrowClockwise
} from '@phosphor-icons/vue'

// Props
interface Props {
  localStream?: MediaStream | null
}

const props = defineProps<Props>()

// Store
const audioStore = useAudioSettingsStore()

// Local state
const trackConstraints = ref<MediaTrackConstraints | null>(null)
const trackSettings = ref<MediaTrackSettings | null>(null)

// Computed
const algorithmDisplayName = computed(() => {
  const algo = audioStore.currentAlgorithmInfo
  if (!algo) return 'Unknown'
  return algo.isAvailable ? algo.name : `${algo.name} (Coming Soon)`
})

// Methods
const formatConstraintValue = (value: unknown): string => {
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value === undefined || value === null) return 'Not set'
  return String(value)
}

const refreshAudioInfo = () => {
  try {
    // Use the local stream from props
    const stream = props.localStream

    if (stream) {
      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) {
        trackConstraints.value = audioTrack.getConstraints()
        trackSettings.value = audioTrack.getSettings()
        console.log('Audio track info refreshed:', {
          constraints: trackConstraints.value,
          settings: trackSettings.value
        })
      }
    } else {
      console.log('No local audio stream found')
      trackConstraints.value = null
      trackSettings.value = null
    }
  } catch (error) {
    console.error('Error refreshing audio info:', error)
  }
}

// Watch for local stream changes
watch(() => props.localStream, (newStream) => {
  if (newStream) {
    console.log('Local stream updated, refreshing audio info')
    refreshAudioInfo()
  }
}, { immediate: true })

// Load on mount
onMounted(() => {
  // Load settings from store
  audioStore.loadSettings()
  // Refresh audio info if stream already exists
  if (props.localStream) {
    refreshAudioInfo()
  }
})
</script>
