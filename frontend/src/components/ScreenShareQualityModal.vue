<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="handleCancel" />

      <!-- Modal Content -->
      <div
        class="relative bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4 border border-gray-600 max-h-[90svh] overflow-y-auto">
        <!-- Header -->
        <div class="px-5 py-3 border-b border-gray-700">
          <div class="flex items-center">
            <PhMonitorPlay class="w-5 h-5 text-indigo-400 mr-2" />

            <h2 class="text-lg font-semibold text-white">Share Your Screen</h2>
          </div>

          <p class="text-xs text-gray-400 mt-0.5">Select streaming quality and audio</p>
        </div>

        <!-- Quality Selection -->
        <div class="px-5 py-3 space-y-2">
          <label class="text-xs font-medium text-gray-300 uppercase tracking-wide"
            >Quality Settings</label
          >

          <div class="space-y-1">
            <button
              v-for="option in qualityOptions"
              :key="option.value"
              type="button"
              class="w-full flex items-center px-3 py-2 rounded-lg border transition-all duration-200 text-left"
              :class="[
                selectedQuality === option.value
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-gray-600 bg-gray-700/30 hover:border-gray-500 hover:bg-gray-700/50',
              ]"
              @click="selectedQuality = option.value">
              <div
                class="w-3 h-3 rounded-full border mr-2 flex-shrink-0 flex items-center justify-center"
                :class="[
                  selectedQuality === option.value
                    ? 'border-indigo-500 bg-indigo-500'
                    : 'border-gray-500',
                ]">
                <div
                  v-if="selectedQuality === option.value"
                  class="w-1.5 h-1.5 bg-white rounded-full" />
              </div>

              <div class="min-w-0">
                <div class="text-sm text-white font-medium leading-tight">
                  {{ option.label }}
                </div>

                <div class="text-[10px] text-gray-400 truncate">
                  {{ option.description }}
                </div>
              </div>
            </button>
          </div>
        </div>

        <!-- Audio Info -->
        <div class="px-5 py-2 border-t border-gray-700">
          <p v-if="!isScreenShareAudioSupported" class="text-xs text-gray-500 flex items-start">
            <PhInfo class="w-3.5 h-3.5 mr-1 flex-shrink-0 mt-0.5" />

            <span>System audio sharing is only available in Chrome and Edge browsers</span>
          </p>

          <p v-else class="text-xs text-gray-400 flex items-start">
            <PhSpeakerHigh class="w-3.5 h-3.5 mr-1 flex-shrink-0 mt-0.5" />

            <span>Audio will be requested in the browser's screen share dialog</span>
          </p>
        </div>

        <!-- Actions -->
        <div class="px-5 py-3 border-t border-gray-700 flex justify-end space-x-2">
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg bg-gray-700 text-sm text-gray-300 hover:bg-gray-600 transition-colors duration-200"
            @click="handleCancel">
            Cancel
          </button>

          <button
            type="button"
            class="px-3 py-1.5 rounded-lg bg-indigo-600 text-sm text-white hover:bg-indigo-700 transition-colors duration-200 flex items-center"
            @click="handleStartShare">
            <PhMonitorPlay class="w-4 h-4 mr-1.5" />
            Start
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from "vue"
import { PhMonitorPlay, PhSpeakerHigh, PhInfo } from "@phosphor-icons/vue"
import { useScreenShareSupport } from "@/composables/useScreenShareSupport"
import type { ScreenShareQuality } from "@/types"

interface Props {
  isOpen: boolean
}

interface QualityOption {
  value: ScreenShareQuality
  label: string
  description: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  "select-quality": [quality: ScreenShareQuality, shareAudio: boolean]
  cancel: []
}>()

const { isScreenShareAudioSupported } = useScreenShareSupport()

const qualityOptions: QualityOption[] = [
  {
    value: "adaptive",
    label: "Adaptive",
    description: "LiveKit adjusts quality automatically",
  },
  {
    value: "fullhd60",
    label: "Full HD 60fps (Raw)",
    description: "Maximum quality, native browser capture",
  },
  {
    value: "text",
    label: "Text Optimized",
    description: "5fps, high quality for documents and code",
  },
]

const selectedQuality = ref<ScreenShareQuality>("adaptive")
const shareAudio = ref(false)

// Reset to defaults when modal opens
watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) {
      selectedQuality.value = "adaptive"
      shareAudio.value = false
    }
  },
)

const handleStartShare = () => {
  emit("select-quality", selectedQuality.value, shareAudio.value)
}

const handleCancel = () => {
  emit("cancel")
}
</script>
