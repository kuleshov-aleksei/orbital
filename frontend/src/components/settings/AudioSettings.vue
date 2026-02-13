<template>
  <div class="space-y-4">
    <h3 class="text-lg font-medium text-white flex items-center gap-2">
      <PhSpeakerHigh class="w-5 h-5 text-indigo-400" />
      Audio Settings
    </h3>

    <!-- Noise Suppression -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <label class="text-sm font-medium text-gray-200 block">
            Noise Suppression
          </label>

          <p class="text-xs text-gray-400 mt-0.5">
            Reduce background noise like typing, fans, or traffic
          </p>
        </div>

        <button
          type="button"
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800"
          :class="noiseSuppressionEnabled ? 'bg-indigo-600' : 'bg-gray-600'"
          @click="toggleNoiseSuppression"
        >
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
            :class="noiseSuppressionEnabled ? 'translate-x-6' : 'translate-x-1'"
          />
        </button>
      </div>

      <!-- Algorithm Selection (only visible when enabled) -->
      <div
        v-if="noiseSuppressionEnabled"
        class="ml-0 pl-4 border-l-2 border-gray-600 space-y-3"
      >
        <div>
          <label class="text-sm font-medium text-gray-300 block mb-1.5">
            Algorithm
          </label>

          <select
            v-model="selectedAlgorithm"
            class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            @change="onAlgorithmChange"
          >
            <option
              v-for="algo in availableAlgorithms"
              :key="algo.id"
              :value="algo.id"
              :disabled="!algo.isSupported || !algo.isAvailable"
            >
              {{ algo.name }}
              <span v-if="!algo.isSupported && algo.notSupportedReason">({{ algo.notSupportedReason }})</span>

              <span v-else-if="!algo.isSupported">(Not Supported)</span>
            </option>
          </select>

          <p
            v-if="currentAlgorithmInfo?.description"
            class="text-xs text-gray-400 mt-1.5"
          >
            {{ currentAlgorithmInfo.description }}
          </p>

          <!-- Algorithm Not Supported Warning -->
          <div
            v-if="selectedAlgorithmInfo && !selectedAlgorithmInfo.isSupported && selectedAlgorithmInfo.notSupportedReason"
            class="mt-2 p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-200"
          >
            <span class="font-semibold">Not Available:</span>
            {{ selectedAlgorithmInfo.notSupportedReason }}
          </div>

          <!-- 48kHz Warning for RNNoise -->
          <div
            v-if="selectedAlgorithm === 'rnnoise' && !supports48kHz"
            class="mt-2 p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-200"
          >
            <span class="font-semibold">Warning:</span>
            Your microphone doesn't support 48kHz sample rate required for RNNoise.
            Please select a different algorithm or use a different microphone.
          </div>

          <!-- WASM Error Message -->
          <div
            v-if="wasmError"
            class="mt-2 p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-200"
          >
            <span class="font-semibold">Error:</span>
            {{ wasmError }}
            <button
              type="button"
              class="ml-2 underline hover:no-underline"
              @click="clearWASMError"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Echo Cancellation -->
    <div class="flex items-center justify-between pt-2 border-t border-gray-700">
      <div>
        <label class="text-sm font-medium text-gray-200 block">
          Echo Cancellation
        </label>

        <p class="text-xs text-gray-400 mt-0.5">
          Prevent echo from your speakers being picked up by your microphone
        </p>
      </div>

      <button
        type="button"
        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800"
        :class="echoCancellationEnabled ? 'bg-indigo-600' : 'bg-gray-600'"
        @click="toggleEchoCancellation"
      >
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
          :class="echoCancellationEnabled ? 'translate-x-6' : 'translate-x-1'"
        />
      </button>
    </div>

    <!-- Auto Gain Control -->
    <div class="flex items-center justify-between pt-2 border-t border-gray-700">
      <div>
        <label class="text-sm font-medium text-gray-200 block">
          Automatic Gain Control
        </label>

        <p class="text-xs text-gray-400 mt-0.5">
          Automatically adjust your microphone volume to maintain consistent loudness
        </p>
      </div>

      <button
        type="button"
        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800"
        :class="autoGainControlEnabled ? 'bg-indigo-600' : 'bg-gray-600'"
        @click="toggleAutoGainControl"
      >
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
          :class="autoGainControlEnabled ? 'translate-x-6' : 'translate-x-1'"
        />
      </button>
    </div>

    <!-- Reset Button -->
    <div class="pt-4 border-t border-gray-700">
      <button
        type="button"
        class="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
        @click="resetSettings"
      >
        <PhArrowCounterClockwise class="w-4 h-4" />
        Reset to Defaults
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useAudioSettingsStore } from '@/stores'
import {
  PhSpeakerHigh,
  PhArrowCounterClockwise
} from '@phosphor-icons/vue'
import type { NoiseSuppressionAlgorithm } from '@/types/audio'

const audioStore = useAudioSettingsStore()

// Local state
const selectedAlgorithm = ref<NoiseSuppressionAlgorithm>('browser-native')
const supports48kHz = ref<boolean | null>(null)
const isCheckingMicrophone = ref(false)

// Computed
const noiseSuppressionEnabled = computed(() => audioStore.noiseSuppressionEnabled)
const echoCancellationEnabled = computed(() => audioStore.echoCancellationEnabled)
const autoGainControlEnabled = computed(() => audioStore.autoGainControlEnabled)
const availableAlgorithms = computed(() => audioStore.availableNoiseSuppressionAlgorithms)
const currentAlgorithmInfo = computed(() => audioStore.currentAlgorithmInfo)
const wasmError = computed(() => audioStore.wasmError)

// Get the currently selected algorithm info with support status
const selectedAlgorithmInfo = computed(() => {
  return availableAlgorithms.value.find(a => a.id === selectedAlgorithm.value)
})

// Watch for store changes to sync local state
watch(() => audioStore.noiseSuppressionAlgorithm, (newVal) => {
  selectedAlgorithm.value = newVal
}, { immediate: true })

// Methods
function toggleNoiseSuppression() {
  audioStore.toggleNoiseSuppression(!noiseSuppressionEnabled.value)
}

function toggleEchoCancellation() {
  audioStore.toggleEchoCancellation(!echoCancellationEnabled.value)
}

function toggleAutoGainControl() {
  audioStore.toggleAutoGainControl(!autoGainControlEnabled.value)
}

function onAlgorithmChange() {
  audioStore.setNoiseSuppressionAlgorithm(selectedAlgorithm.value)
}

function resetSettings() {
  if (confirm('Reset all audio settings to default values?')) {
    audioStore.resetSettings()
    selectedAlgorithm.value = audioStore.noiseSuppressionAlgorithm
    supports48kHz.value = null
  }
}

function clearWASMError() {
  audioStore.clearWASMError()
}

async function checkMicrophoneSupport() {
  if (isCheckingMicrophone.value) return
  isCheckingMicrophone.value = true

  try {
    supports48kHz.value = await audioStore.checkMicrophone48kHzSupport()
  } catch (error) {
    console.error('Error checking microphone support:', error)
    supports48kHz.value = false
  } finally {
    isCheckingMicrophone.value = false
  }
}

// Load settings on mount
onMounted(() => {
  audioStore.loadSettings()
  selectedAlgorithm.value = audioStore.noiseSuppressionAlgorithm
  void checkMicrophoneSupport()
})
</script>
