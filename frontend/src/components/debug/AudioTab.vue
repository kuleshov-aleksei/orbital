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

        <!-- Audio Processing Mode -->
        <div class="flex items-center justify-between py-2 border-b border-gray-700">
          <div>
            <span class="text-sm font-medium text-gray-200">Processing Mode</span>

            <p class="text-xs text-gray-400">How audio is being processed</p>
          </div>

          <span 
            class="px-3 py-1 rounded-full text-sm font-medium"
            :class="audioStore.requiresAudioWorklet ? 'bg-purple-900 text-purple-300' : 'bg-gray-700 text-gray-300'"
          >
            {{ audioStore.requiresAudioWorklet ? 'AudioWorklet (3rd Party)' : 'Browser Native' }}
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

    <!-- Requested Constraints (What we asked for) -->
    <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <PhMicrophone class="w-5 h-5 text-indigo-400" />
        Requested Constraints
      </h3>

      <div v-if="trackConstraints || storeConstraints" class="space-y-3">
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-gray-900 rounded p-3">
            <span class="text-xs text-gray-400 block mb-1">Noise Suppression</span>

            <span class="text-sm font-mono text-white">{{ formatConstraintValue(displayedConstraints.noiseSuppression) }}</span>
          </div>

          <div class="bg-gray-900 rounded p-3">
            <span class="text-xs text-gray-400 block mb-1">Echo Cancellation</span>

            <span class="text-sm font-mono text-white">{{ formatConstraintValue(displayedConstraints.echoCancellation) }}</span>
          </div>

          <div class="bg-gray-900 rounded p-3">
            <span class="text-xs text-gray-400 block mb-1">Auto Gain Control</span>

            <span class="text-sm font-mono text-white">{{ formatConstraintValue(displayedConstraints.autoGainControl) }}</span>
          </div>

          <div class="bg-gray-900 rounded p-3">
            <span class="text-xs text-gray-400 block mb-1">Sample Rate</span>

            <span class="text-sm font-mono text-white">{{ formatConstraintValue(displayedConstraints.sampleRate) }}</span>
          </div>

          <div class="bg-gray-900 rounded p-3">
            <span class="text-xs text-gray-400 block mb-1">Channel Count</span>

            <span class="text-sm font-mono text-white">{{ formatConstraintValue(displayedConstraints.channelCount) }}</span>
          </div>

          <div class="bg-gray-900 rounded p-3">
            <span class="text-xs text-gray-400 block mb-1">Device ID</span>

            <span class="text-sm font-mono text-white truncate">{{ formatConstraintValue(displayedConstraints.deviceId) }}</span>
          </div>
        </div>

        <div class="mt-4 p-3 bg-gray-900 rounded">
          <span class="text-xs text-gray-400 block mb-2">Full Constraints Object:</span>

          <pre class="text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap">{{ JSON.stringify(displayedConstraints, null, 2) }}</pre>
        </div>
      </div>

      <div v-else class="text-center py-8 text-gray-400">
        <PhMicrophoneSlash class="w-12 h-12 mx-auto mb-2 opacity-50" />

        <p>No audio constraints available</p>

        <p class="text-sm mt-1">Join a room to see audio constraints</p>
      </div>
    </div>

    <!-- Audio Track Settings (Actual Applied) -->
    <div v-if="trackSettings || audioStore.requiresAudioWorklet" class="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <PhSliders class="w-5 h-5 text-indigo-400" />
        Track Settings (Actual Applied)
      </h3>

      <div class="grid grid-cols-2 gap-4">
        <div class="bg-gray-900 rounded p-3">
          <span class="text-xs text-gray-400 block mb-1">Device ID</span>

          <span class="text-sm font-mono text-white truncate">{{ trackSettings?.deviceId || 'Default' }}</span>
        </div>

        <div class="bg-gray-900 rounded p-3">
          <span class="text-xs text-gray-400 block mb-1">Sample Rate</span>

          <span class="text-sm font-mono text-white">{{ formatSampleRate(trackSettings?.sampleRate) }}</span>
        </div>

        <div class="bg-gray-900 rounded p-3">
          <span class="text-xs text-gray-400 block mb-1">Channel Count</span>

          <span class="text-sm font-mono text-white">{{ trackSettings?.channelCount ?? 'Not reported' }}</span>
        </div>

        <div class="bg-gray-900 rounded p-3">
          <span class="text-xs text-gray-400 block mb-1">Volume</span>

          <span class="text-sm font-mono text-white">{{ trackSettings?.volume !== undefined ? `${Math.round(trackSettings.volume * 100)}%` : 'Not reported' }}</span>
        </div>

        <!-- Additional info for AudioWorklet mode -->
        <div v-if="audioStore.requiresAudioWorklet" class="col-span-2 bg-purple-900/30 border border-purple-700 rounded p-3">
          <span class="text-xs text-purple-400 block mb-1">AudioWorklet Processing</span>

          <span class="text-sm text-white">
            Using {{ audioStore.noiseSuppressionAlgorithm === 'rnnoise' ? 'RNNoise' : 'Speex' }} WASM processor
          </span>

          <p class="text-xs text-gray-400 mt-1">
            Browser-native noise suppression is disabled. Processing happens in AudioWorklet.
          </p>
        </div>
      </div>

      <div v-if="trackSettings" class="mt-4 p-3 bg-gray-900 rounded">
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

// Get constraints from store (for 3rd party processors) or track
const storeConstraints = computed(() => {
  const constraints = audioStore.audioConstraints
  if (typeof constraints === 'boolean') return null
  return constraints
})

// Merge track constraints with store constraints for display
const displayedConstraints = computed(() => {
  const store = storeConstraints.value || {}
  const track = trackConstraints.value || {}
  
  // Prefer track constraints, fallback to store constraints
  return {
    noiseSuppression: track.noiseSuppression ?? store.noiseSuppression,
    echoCancellation: track.echoCancellation ?? store.echoCancellation,
    autoGainControl: track.autoGainControl ?? store.autoGainControl,
    sampleRate: track.sampleRate ?? store.sampleRate,
    channelCount: track.channelCount ?? store.channelCount,
    deviceId: track.deviceId ?? store.deviceId,
    ...track, // Include any other constraints from the track
  }
})

// Methods
const formatConstraintValue = (value: unknown): string => {
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value === undefined || value === null) return 'Not set'

  // Handle constraint objects like { ideal: 48000 } or { exact: 48000 }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    if ('ideal' in obj) return `ideal: ${String(obj.ideal)}`
    if ('exact' in obj) return `exact: ${String(obj.exact)}`
    return JSON.stringify(value)
  }

  // Handle primitive types
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }

  // Handle symbols and functions
  return '[object Object]'
}

const formatSampleRate = (rate: number | undefined): string => {
  if (!rate) {
    // For AudioWorklet processors, show the expected rate from constraints
    const constraints = storeConstraints.value
    if (constraints?.sampleRate && typeof constraints.sampleRate === 'object') {
      const sr = constraints.sampleRate as { ideal?: number; exact?: number }
      if (sr.ideal) return `${sr.ideal} Hz (requested)`
      if (sr.exact) return `${sr.exact} Hz (required)`
    }
    return 'Not reported'
  }
  return `${rate} Hz`
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
