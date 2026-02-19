<template>
  <div class="space-y-4">
    <h3 class="text-lg font-medium text-white flex items-center gap-2">
      <PhSpeakerHigh class="w-5 h-5 text-indigo-400" />
      Audio Settings
    </h3>

   <!-- Microphone Selection -->
    <div class="space-y-3 pb-2 border-b border-gray-700">
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <label class="text-sm font-medium text-gray-200 block"> Microphone </label>

          <button
            v-if="audioStore.hasDevicePermission === false"
            type="button"
            class="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            @click="requestPermission">
            Allow Access
          </button>

          <button
            v-else
            type="button"
            class="text-xs text-gray-400 hover:text-gray-300 transition-colors"
            @click="refreshDevices">
            <PhArrowsClockwise class="w-3.5 h-3.5" />
          </button>
        </div>

        <select
          v-model="selectedDeviceId"
          class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          :disabled="audioStore.availableInputDevices.length === 0"
          @change="onDeviceChange">
          <option v-if="audioStore.availableInputDevices.length === 0" value="">
            No microphones found
          </option>

          <option
            v-for="device in audioStore.availableInputDevices"
            :key="device.deviceId"
            :value="device.deviceId">
            {{ device.label }}
            <span v-if="device.isDefault">(Default)</span>
          </option>
        </select>

        <p v-if="audioStore.hasDevicePermission === false" class="text-xs text-amber-400 mt-1.5">
          Grant microphone access to see device names
        </p>

        <p v-else-if="audioStore.availableInputDevices.length === 0" class="text-xs text-gray-400 mt-1.5">
          No audio input devices detected
        </p>
      </div>
    </div>

    <!-- Noise Suppression -->
    <div class="space-y-3 pt-2">
      <div class="flex items-center justify-between">
        <div>
          <label class="text-sm font-medium text-gray-200 block"> Noise Suppression </label>

          <p class="text-xs text-gray-400 mt-0.5">
            Reduce background noise like typing, fans, or traffic
          </p>
        </div>

        <button
          type="button"
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800"
          :class="noiseSuppressionEnabled ? 'bg-indigo-600' : 'bg-gray-600'"
          @click="toggleNoiseSuppression">
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
            :class="noiseSuppressionEnabled ? 'translate-x-6' : 'translate-x-1'" />
        </button>
      </div>

      <!-- Algorithm Selection (only visible when enabled) -->
      <div v-if="noiseSuppressionEnabled" class="ml-0 pl-4 border-l-2 border-gray-600 space-y-3">
        <div>
          <label class="text-sm font-medium text-gray-300 block mb-1.5"> Algorithm </label>

          <select
            v-model="selectedAlgorithm"
            class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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

          <p v-if="currentAlgorithmInfo?.description" class="text-xs text-gray-400 mt-1.5">
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
    <div class="flex items-center justify-between pt-2 border-t border-gray-700">
      <div>
        <label class="text-sm font-medium text-gray-200 block"> Echo Cancellation </label>

        <p class="text-xs text-gray-400 mt-0.5">
          Prevent echo from your speakers being picked up by your microphone
        </p>
      </div>

      <button
        type="button"
        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800"
        :class="echoCancellationEnabled ? 'bg-indigo-600' : 'bg-gray-600'"
        @click="toggleEchoCancellation">
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
          :class="echoCancellationEnabled ? 'translate-x-6' : 'translate-x-1'" />
      </button>
    </div>

    <!-- Auto Gain Control -->
    <div class="flex items-center justify-between pt-2 border-t border-gray-700">
      <div>
        <label class="text-sm font-medium text-gray-200 block"> Automatic Gain Control </label>

        <p class="text-xs text-gray-400 mt-0.5">
          Automatically adjust your microphone volume to maintain consistent loudness
        </p>
      </div>

      <button
        type="button"
        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800"
        :class="autoGainControlEnabled ? 'bg-indigo-600' : 'bg-gray-600'"
        @click="toggleAutoGainControl">
        <span
          class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
          :class="autoGainControlEnabled ? 'translate-x-6' : 'translate-x-1'" />
      </button>
    </div>

    <!-- Reset Button -->
    <div class="pt-4 border-t border-gray-700">
      <button
        type="button"
        class="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
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
import { PhSpeakerHigh, PhArrowCounterClockwise, PhArrowsClockwise } from "@phosphor-icons/vue"
import type { NoiseSuppressionAlgorithm } from "@/types/audio"

const audioStore = useAudioSettingsStore()

// Local state
const selectedAlgorithm = ref<NoiseSuppressionAlgorithm>("livekit-native")
const selectedDeviceId = ref<string>("")
const isRefreshing = ref(false)
const isRequestingPermission = ref(false)

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

watch(
  () => audioStore.inputDeviceId,
  (newVal) => {
    selectedDeviceId.value = newVal
  },
  { immediate: true },
)

// Watch for device list changes
watch(
  () => audioStore.availableInputDevices,
  (devices) => {
    // If current selection is not in the list and we have devices, select default
    if (selectedDeviceId.value && !devices.some((d) => d.deviceId === selectedDeviceId.value)) {
      const defaultDevice = devices.find((d) => d.isDefault) || devices[0]
      if (defaultDevice) {
        selectedDeviceId.value = defaultDevice.deviceId
        audioStore.setInputDevice(defaultDevice.deviceId)
      }
    }
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
    selectedDeviceId.value = audioStore.inputDeviceId
  }
}

function onDeviceChange() {
  audioStore.setInputDevice(selectedDeviceId.value)
}

async function refreshDevices() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  await audioStore.refreshInputDevices()
  isRefreshing.value = false
}

async function requestPermission() {
  if (isRequestingPermission.value) return
  isRequestingPermission.value = true
  await audioStore.requestDevicePermission()
  isRequestingPermission.value = false
}

// Load settings on mount
onMounted(async () => {
  audioStore.loadSettings()
  selectedAlgorithm.value = audioStore.noiseSuppressionAlgorithm
  selectedDeviceId.value = audioStore.inputDeviceId
  // Enumerate devices (works without permission, labels will be empty)
  await audioStore.refreshInputDevices()
})
</script>
