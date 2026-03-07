<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="handleCancel" />

      <!-- Modal Content -->
      <div
        class="relative bg-gray-800 rounded-xl shadow-2xl w-full mx-4 border border-gray-600 max-w-2xl max-h-[80svh] overflow-hidden flex flex-col">
        <!-- Header -->
        <div class="px-5 py-3 border-b border-gray-700 flex-shrink-0">
          <div class="flex items-center">
            <PhMonitorPlay class="w-5 h-5 text-indigo-400 mr-2" />

            <h2 class="text-lg font-semibold text-white">Choose What to Share</h2>
          </div>

          <p class="text-xs text-gray-400 mt-0.5">Select a screen or window to share</p>
        </div>

        <!-- Source List -->
        <div class="flex-1 overflow-y-auto p-4">
          <div v-if="isLoading" class="flex items-center justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
          </div>

          <div v-else-if="error" class="text-center py-8">
            <PhWarning class="w-12 h-12 text-red-400 mx-auto mb-2" />
            <p class="text-red-400">{{ error }}</p>
          </div>

          <div v-else class="grid grid-cols-2 gap-3">
            <!-- Screens Section -->
            <div v-if="screens.length > 0">
              <h3 class="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                Screens
              </h3>
              <div class="space-y-2">
                <button
                  v-for="source in screens"
                  :key="source.id"
                  type="button"
                  class="w-full flex items-center p-2 rounded-lg border transition-all duration-200 text-left"
                  :class="[
                    selectedSourceId === source.id
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-gray-600 bg-gray-700/30 hover:border-gray-500 hover:bg-gray-700/50',
                  ]"
                  @click="selectedSourceId = source.id">
                  <img
                    :src="source.thumbnail"
                    :alt="source.name"
                    class="w-20 h-12 object-cover rounded border border-gray-600 flex-shrink-0" />

                  <div class="ml-2 min-w-0">
                    <div class="text-sm text-white font-medium truncate">
                      {{ source.name }}
                    </div>
                    <div class="text-[10px] text-gray-400">Screen</div>
                  </div>
                </button>
              </div>
            </div>

            <!-- Windows Section -->
            <div v-if="windows.length > 0">
              <h3 class="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                Windows
              </h3>
              <div class="space-y-2">
                <button
                  v-for="source in windows"
                  :key="source.id"
                  type="button"
                  class="w-full flex items-center p-2 rounded-lg border transition-all duration-200 text-left"
                  :class="[
                    selectedSourceId === source.id
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-gray-600 bg-gray-700/30 hover:border-gray-500 hover:bg-gray-700/50',
                  ]"
                  @click="selectedSourceId = source.id">
                  <img
                    :src="source.thumbnail"
                    :alt="source.name"
                    class="w-20 h-12 object-cover rounded border border-gray-600 flex-shrink-0" />

                  <div class="ml-2 min-w-0">
                    <div class="text-sm text-white font-medium truncate">
                      {{ source.name }}
                    </div>
                    <div class="text-[10px] text-gray-400">Window</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Audio Option -->
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
          <p class="text-xs text-gray-500 mt-1 ml-11">
            {{
              shareAudio
                ? "System audio will be captured and shared"
                : "No system audio will be shared"
            }}
          </p>
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
            class="px-3 py-1.5 rounded-lg bg-indigo-600 text-sm text-white hover:bg-indigo-700 transition-colors duration-200 flex items-center"
            :disabled="!selectedSourceId || isStarting"
            :class="{ 'opacity-50 cursor-not-allowed': !selectedSourceId || isStarting }"
            @click="handleStartShare">
            <div
              v-if="isStarting"
              class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1.5" />
            <PhMonitorPlay class="w-4 h-4 mr-1.5" />
            Start
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue"
import { PhMonitorPlay, PhWarning } from "@phosphor-icons/vue"
import { getDesktopSources, isElectron } from "@/services/electron"
import type { DesktopSource, ScreenShareQuality } from "@/types"

interface Props {
  isOpen: boolean
  quality: ScreenShareQuality
}

interface Emit {
  "select-source": [sourceId: string, audio: boolean]
  cancel: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()

const isLoading = ref(true)
const error = ref<string | null>(null)
const sources = ref<DesktopSource[]>([])
const selectedSourceId = ref<string | null>(null)
const shareAudio = ref(false)
const isStarting = ref(false)

const screens = computed(() => sources.value.filter((s) => s.id.startsWith("screen:")))
const windows = computed(() => sources.value.filter((s) => s.id.startsWith("window:")))

watch(
  () => props.isOpen,
  async (isOpen) => {
    if (isOpen) {
      await loadSources()
    } else {
      selectedSourceId.value = null
      shareAudio.value = false
      error.value = null
    }
  },
)

async function loadSources() {
  if (!isElectron()) {
    error.value = "Not running in Electron"
    isLoading.value = false
    return
  }

  isLoading.value = true
  error.value = null

  try {
    sources.value = await getDesktopSources()
    if (sources.value.length === 0) {
      error.value = "No screens or windows available to share"
    }
  } catch (e) {
    error.value = `Failed to load sources: ${(e as Error).message}`
  } finally {
    isLoading.value = false
  }
}

function handleStartShare() {
  if (!selectedSourceId.value) return
  isStarting.value = true
  emit("select-source", selectedSourceId.value, shareAudio.value)
}

function handleCancel() {
  emit("cancel")
}
</script>
