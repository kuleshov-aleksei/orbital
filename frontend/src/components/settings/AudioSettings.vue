<template>
  <div class="space-y-4">
    <h3
      v-if="!hideHeader"
      class="text-lg font-medium text-theme-text-primary flex items-center gap-2">
      <PhSpeakerHigh class="w-5 h-5 text-theme-accent" />
      Audio Settings
    </h3>

    <!-- Noise Suppression -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <label class="text-sm font-medium text-theme-text-primary block">
            Noise Suppression
          </label>

          <p class="text-xs text-theme-text-muted mt-0.5">
            Reduce background noise like typing, fans, or traffic
          </p>
        </div>

        <button
          type="button"
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent focus:ring-offset-2 focus:ring-offset-theme-bg-primary"
          :class="noiseSuppressionEnabled ? 'bg-theme-accent' : 'bg-theme-bg-tertiary'"
          @click="toggleNoiseSuppression">
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
            :class="noiseSuppressionEnabled ? 'translate-x-6' : 'translate-x-1'" />
        </button>
      </div>

      <!-- Algorithm Selection (only visible when enabled) -->
      <div
        v-if="noiseSuppressionEnabled"
        class="ml-0 pl-4 border-l-2 border-theme-border space-y-3">
        <div>
          <label class="text-sm font-medium text-theme-text-secondary block mb-1.5">
            Algorithm
          </label>

          <select
            v-model="selectedAlgorithm"
            class="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent"
            @change="onAlgorithmChange">
            <option
              v-for="algo in availableAlgorithms"
              :key="algo.id"
              :value="algo.id"
              :disabled="!algo.isSupported || !algo.isAvailable">
              {{ algo.name }}
              <span v-if="!algo.isSupported && algo.notSupportedReason"
                >({{ algo.notSupportedReason }})</span
              >

              <span v-else-if="!algo.isSupported">(Not Supported)</span>
            </option>
          </select>

          <p v-if="currentAlgorithmInfo?.description" class="text-xs text-theme-text-muted mt-1.5">
            {{ currentAlgorithmInfo.description }}
          </p>

          <!-- Algorithm Not Supported Warning -->
          <div
            v-if="
              selectedAlgorithmInfo &&
              !selectedAlgorithmInfo.isSupported &&
              selectedAlgorithmInfo.notSupportedReason
            "
            class="mt-2 p-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-200">
            <span class="font-semibold">Not Available:</span>
            {{ selectedAlgorithmInfo.notSupportedReason }}
          </div>
        </div>
      </div>
    </div>

    <!-- Echo Cancellation -->
    <div class="flex items-center justify-between pt-2 border-t border-theme-border">
      <div>
        <label class="text-sm font-medium text-theme-text-primary block"> Echo Cancellation </label>

        <p class="text-xs text-theme-text-muted mt-0.5">
          Prevent echo from your speakers being picked up by your microphone
        </p>
      </div>

      <button
        type="button"
        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent focus:ring-offset-2 focus:ring-offset-theme-bg-primary"
        :class="echoCancellationEnabled ? 'bg-theme-accent' : 'bg-theme-bg-tertiary'"
        @click="toggleEchoCancellation">
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
          :class="echoCancellationEnabled ? 'translate-x-6' : 'translate-x-1'" />
      </button>
    </div>

    <!-- Auto Gain Control -->
    <div class="flex items-center justify-between pt-2 border-t border-theme-border">
      <div>
        <label class="text-sm font-medium text-theme-text-primary block">
          Automatic Gain Control
        </label>

        <p class="text-xs text-theme-text-muted mt-0.5">
          Automatically adjust your microphone volume to maintain consistent loudness
        </p>
      </div>

      <button
        type="button"
        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-theme-accent focus:ring-offset-2 focus:ring-offset-theme-bg-primary"
        :class="autoGainControlEnabled ? 'bg-theme-accent' : 'bg-theme-bg-tertiary'"
        @click="toggleAutoGainControl">
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
          :class="autoGainControlEnabled ? 'translate-x-6' : 'translate-x-1'" />
      </button>
    </div>

    <!-- Reset Button -->
    <div class="pt-4 border-t border-theme-border">
      <button
        type="button"
        class="text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors flex items-center gap-1.5"
        @click="resetSettings">
        <PhArrowCounterClockwise class="w-4 h-4" />
        Reset to Defaults
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import { useAudioSettingsStore } from "@/stores"
import { PhSpeakerHigh, PhArrowCounterClockwise } from "@phosphor-icons/vue"
import type { NoiseSuppressionAlgorithm } from "@/types/audio"

defineProps<{
  hideHeader?: boolean
}>()

const audioStore = useAudioSettingsStore()

// Local state
const selectedAlgorithm = ref<NoiseSuppressionAlgorithm>("livekit-native")

// Computed
const noiseSuppressionEnabled = computed(() => audioStore.noiseSuppressionEnabled)
const echoCancellationEnabled = computed(() => audioStore.echoCancellationEnabled)
const autoGainControlEnabled = computed(() => audioStore.autoGainControlEnabled)
const availableAlgorithms = computed(() => audioStore.availableNoiseSuppressionAlgorithms)
const currentAlgorithmInfo = computed(() => audioStore.currentAlgorithmInfo)

// Get the currently selected algorithm info with support status
const selectedAlgorithmInfo = computed(() => {
  return availableAlgorithms.value.find((a) => a.id === selectedAlgorithm.value)
})

// Watch for store changes to sync local state
watch(
  () => audioStore.noiseSuppressionAlgorithm,
  (newVal) => {
    selectedAlgorithm.value = newVal
  },
  { immediate: true },
)

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
  if (confirm("Reset all audio settings to default values?")) {
    audioStore.resetSettings()
    selectedAlgorithm.value = audioStore.noiseSuppressionAlgorithm
  }
}

// Load settings on mount
onMounted(() => {
  audioStore.loadSettings()
  selectedAlgorithm.value = audioStore.noiseSuppressionAlgorithm
})
</script>
