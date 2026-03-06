<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="handleCancel" />

      <!-- Electron Modal: Combined Quality + Source Selection -->
      <div
        v-if="isRunningInElectron"
        class="relative bg-gray-800 rounded-xl shadow-2xl w-full mx-4 border border-gray-600 max-w-3xl max-h-[85svh] overflow-hidden flex flex-col">
        <!-- Header -->
        <div class="px-5 py-3 border-b border-gray-700 flex-shrink-0">
          <div class="flex items-center">
            <PhMonitorPlay class="w-5 h-5 text-indigo-400 mr-2" />
            <h2 class="text-lg font-semibold text-white">Share Your Screen</h2>
          </div>
          <p class="text-xs text-gray-400 mt-0.5">Select quality and what to share</p>
        </div>

        <!-- Quality Selection -->
        <div class="px-5 py-3 border-b border-gray-700 flex-shrink-0">
          <label class="text-xs font-medium text-gray-300 uppercase tracking-wide">Quality</label>
          <div class="mt-2 flex gap-2">
            <button
              v-for="option in qualityOptions"
              :key="option.value"
              type="button"
              class="flex-1 flex items-center justify-center px-3 py-2 rounded-lg border transition-all duration-200 text-sm"
              :class="[
                selectedQuality === option.value
                  ? 'border-indigo-500 bg-indigo-500/10 text-white'
                  : 'border-gray-600 bg-gray-700/30 text-gray-300 hover:border-gray-500 hover:bg-gray-700/50',
              ]"
              @click="selectedQuality = option.value">
              {{ option.label }}
            </button>
          </div>
        </div>

        <!-- Source List -->
        <div class="flex-1 overflow-y-auto p-4 min-h-0">
          <label class="text-xs font-medium text-gray-300 uppercase tracking-wide block mb-3">Select Source</label>

          <div v-if="isLoadingSources" class="flex items-center justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
          </div>

          <div v-else-if="sourcesError" class="text-center py-8">
            <PhWarning class="w-12 h-12 text-red-400 mx-auto mb-2" />
            <p class="text-red-400">{{ sourcesError }}</p>
          </div>

          <div v-else class="grid grid-cols-3 gap-3">
            <div
              v-for="source in sources"
              :key="source.id"
              class="flex flex-col items-center p-2 rounded-lg border cursor-pointer transition-all duration-200"
              :class="[
                selectedSourceId === source.id
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-gray-600 bg-gray-700/30 hover:border-gray-500 hover:bg-gray-700/50',
              ]"
              @click="selectSource(source.id)">
              <img
                :src="source.thumbnail"
                :alt="source.name"
                class="w-full h-20 object-cover rounded border border-gray-600 mb-2" />
              <span class="text-xs text-white text-center truncate w-full">{{ source.name }}</span>
              <span class="text-[10px] text-gray-400">{{ source.id.startsWith("screen:") ? "Screen" : "Window" }}</span>
            </div>
          </div>
        </div>

        <!-- Audio Toggle -->
        <div class="px-5 py-3 border-t border-gray-700 flex-shrink-0">
          <label class="flex items-center cursor-pointer">
            <div class="relative">
              <input v-model="shareAudio" type="checkbox" class="sr-only" />
              <div
                class="w-9 h-5 rounded-full transition-colors duration-200"
                :class="shareAudio ? 'bg-indigo-500' : 'bg-gray-600'" />
              <div
                class="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200"
                :class="shareAudio ? 'translate-x-4' : 'translate-x-0'" />
            </div>
            <span class="ml-2 text-sm text-gray-300">Share system audio</span>
          </label>
        </div>

        <!-- Actions -->
        <div class="px-5 py-3 border-t border-gray-700 flex justify-end space-x-2 flex-shrink-0">
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg bg-gray-700 text-sm text-gray-300 hover:bg-gray-600 transition-colors duration-200"
            @click="handleCancel">
            Cancel
          </button>

          <button
            type="button"
            class="px-3 py-1.5 rounded-lg bg-indigo-600 text-sm text-white hover:bg-indigo-700 transition-colors duration-200 flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!selectedSourceId || isStarting"
            @click="handleStartShare">
            <div v-if="isStarting" class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1.5" />
            <PhMonitorPlay class="w-4 h-4 mr-1.5" />
            Start Sharing
          </button>
        </div>
      </div>

      <!-- Browser Modal: Original Quality Selection -->
      <div
        v-else
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
          <label class="text-xs font-medium text-gray-300 uppercase tracking-wide">Quality Settings</label>
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
                  selectedQuality === option.value ? 'border-indigo-500 bg-indigo-500' : 'border-gray-500',
                ]">
                <div v-if="selectedQuality === option.value" class="w-1.5 h-1.5 bg-white rounded-full" />
              </div>
              <div class="min-w-0">
                <div class="text-sm text-white font-medium leading-tight">{{ option.label }}</div>
                <div class="text-[10px] text-gray-400 truncate">{{ option.description }}</div>
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
            @click="handleBrowserStartShare">
            <PhMonitorPlay class="w-4 h-4 mr-1.5" />
            Start
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from "vue"
import { PhMonitorPlay, PhSpeakerHigh, PhInfo, PhWarning } from "@phosphor-icons/vue"
import { useScreenShareSupport } from "@/composables/useScreenShareSupport"
import { getDesktopSources } from "@/services/electron"
import type { DesktopSource, ScreenShareQuality } from "@/types"

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
  "select-electron-source": [quality: ScreenShareQuality, sourceId: string, audio: boolean]
  cancel: []
}>()

const { isRunningInElectron, isScreenShareAudioSupported } = useScreenShareSupport()

const qualityOptions: QualityOption[] = [
  { value: "adaptive", label: "Adaptive", description: "LiveKit adjusts quality automatically" },
  { value: "fullhd60", label: "Full HD 60fps", description: "Maximum quality, native browser capture" },
  { value: "text", label: "Text Optimized", description: "5fps, high quality for documents and code" },
]

const selectedQuality = ref<ScreenShareQuality>("adaptive")
const shareAudio = ref(false)

const sources = ref<DesktopSource[]>([])
const selectedSourceId = ref<string | null>(null)
const isLoadingSources = ref(false)
const sourcesError = ref<string | null>(null)
const isStarting = ref(false)

const hasSelectedSource = computed(() => selectedSourceId.value !== null && selectedSourceId.value !== "")

watch(
  () => props.isOpen,
  async (isOpen, prevIsOpen) => {
    if (isOpen && !prevIsOpen) {
      selectedQuality.value = "adaptive"
      shareAudio.value = false
      selectedSourceId.value = null
      sourcesError.value = null
      isStarting.value = false
      isLoadingSources.value = false

      if (isRunningInElectron.value) {
        sources.value = []
        await loadSources()
      }
    }
  },
)

async function loadSources() {
  isLoadingSources.value = true
  sourcesError.value = null
  selectedSourceId.value = null
  isStarting.value = false

  try {
    const result = await getDesktopSources()
    sources.value = result
    if (result.length === 0) {
      sourcesError.value = "No screens or windows available to share"
    }
  } catch (e) {
    sourcesError.value = `Failed to load sources: ${(e as Error).message}`
  } finally {
    isLoadingSources.value = false
  }
}

function selectSource(id: string) {
  selectedSourceId.value = id
}

function handleStartShare() {
  if (!selectedSourceId.value || !hasSelectedSource.value) {
    return
  }
  isStarting.value = true
  emit("select-electron-source", selectedQuality.value, selectedSourceId.value, shareAudio.value)
}

function handleBrowserStartShare() {
  emit("select-quality", selectedQuality.value, shareAudio.value)
}

function handleCancel() {
  isStarting.value = false
  emit("cancel")
}

onUnmounted(() => {
  selectedSourceId.value = null
  isStarting.value = false
  isLoadingSources.value = false
})
</script>
