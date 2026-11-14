<template>
  <Teleport to="body">
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-theme-backdrop backdrop-blur-sm" @click="handleCancel" />

      <!-- Electron Modal: Combined Quality + Source Selection -->
      <div
        v-if="isRunningInElectron"
        class="relative bg-theme-bg-secondary rounded-xl shadow-2xl w-full mx-4 border border-theme-border max-w-3xl max-h-[85svh] overflow-hidden flex flex-col">
        <!-- Header -->
        <div class="px-5 py-3 border-b border-theme-border flex-shrink-0">
          <div class="flex items-center">
            <PhMonitorPlay class="w-5 h-5 text-theme-accent mr-2" />
            <h2 class="text-lg font-semibold text-theme-text-primary">Share Your Screen</h2>
          </div>
          <p class="text-xs text-theme-text-muted mt-0.5">Select quality and what to share</p>
        </div>

        <!-- Quality Selection -->
        <div class="px-5 py-3 border-b border-theme-border flex-shrink-0">
          <label class="text-xs font-medium text-theme-text-secondary uppercase tracking-wide"
            >Quality</label
          >
          <div class="mt-2 flex gap-2">
            <button
              v-for="option in qualityOptions"
              :key="option.value"
              type="button"
              class="flex-1 flex items-center justify-center px-3 py-2 rounded-lg border transition-all duration-200 text-sm"
              :class="[
                selectedQuality === option.value
                  ? 'border-theme-accent bg-theme-accent/10 text-theme-text-primary'
                  : 'border-theme-border bg-theme-bg-tertiary/30 text-theme-text-secondary hover:border-theme-text-muted hover:bg-theme-bg-tertiary/50',
              ]"
              @click="selectedQuality = option.value">
              {{ option.label }}
            </button>
          </div>
        </div>

        <!-- Source List -->
        <div class="flex-1 overflow-y-auto p-4 min-h-0">
          <label
            class="text-xs font-medium text-theme-text-secondary uppercase tracking-wide block mb-3"
            >Select Source</label
          >

          <div v-if="isLoadingSources" class="flex items-center justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-theme-accent" />
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
                  ? 'border-theme-accent bg-theme-accent/10'
                  : 'border-theme-border bg-theme-bg-tertiary/30 hover:border-theme-text-muted hover:bg-theme-bg-tertiary/50',
              ]"
              @click="selectSource(source.id)">
              <img
                :src="source.thumbnail"
                :alt="source.name"
                class="w-full h-20 object-cover rounded border border-theme-border mb-2" />
              <span class="text-xs text-theme-text-primary text-center truncate w-full">{{
                source.name
              }}</span>
              <span class="text-[10px] text-theme-text-muted">{{
                source.id.startsWith("screen:") ? "Screen" : "Window"
              }}</span>
            </div>
          </div>
        </div>

        <!-- Audio Toggle -->
        <div class="px-5 py-3 border-t border-theme-border shrink-0">
          <!-- Windows: per-app capture through the process loopback helper -->
          <div v-if="winAudioSupported" class="space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-xs font-medium text-theme-text-secondary uppercase tracking-wide">
                Audio
              </span>
              <div class="flex gap-1.5">
                <button
                  v-for="option in winAudioModeOptions"
                  :key="option.value"
                  type="button"
                  class="px-2.5 py-1 rounded-lg border text-xs transition-colors duration-200"
                  :class="
                    winAudioMode === option.value
                      ? 'border-theme-accent bg-theme-accent/10 text-theme-text-primary'
                      : 'border-theme-border text-theme-text-secondary hover:border-theme-text-muted'
                  "
                  @click="winAudioMode = option.value">
                  {{ option.label }}
                </button>
              </div>
            </div>
            <div v-if="winAudioMode === 'app'" class="flex items-center gap-2">
              <select
                v-model="selectedWinAppPid"
                class="flex-1 min-w-0 bg-theme-bg-tertiary border border-theme-border rounded-lg px-2 py-1.5 text-sm text-theme-text-primary">
                <option :value="null" disabled>
                  {{ winAudioApps.length ? "Choose an app" : "No apps are playing audio" }}
                </option>
                <option v-for="appItem in winAudioApps" :key="appItem.pid" :value="appItem.pid">
                  {{ appItem.name }}{{ appItem.active ? "" : " (silent)" }}
                </option>
              </select>
              <button
                type="button"
                class="p-1.5 rounded-lg border border-theme-border text-theme-text-secondary hover:border-theme-text-muted"
                title="Refresh apps"
                aria-label="Refresh apps"
                @click="refreshWinAudioApps">
                <PhArrowClockwise class="w-4 h-4" />
              </button>
            </div>
          </div>
          <div v-else-if="selectedSourceIsWindow" class="flex items-start text-xs text-amber-400">
            <PhInfo class="w-4 h-4 mr-1.5 shrink-0 mt-0.5" />
            <span>
              System audio can only be captured when sharing an entire screen. Audio capture is not
              supported for individual windows.
            </span>
          </div>
          <label v-else class="flex items-center cursor-pointer">
            <div class="relative">
              <input v-model="shareAudio" type="checkbox" class="sr-only" />
              <div
                class="w-9 h-5 rounded-full transition-colors duration-200"
                :class="shareAudio ? 'bg-theme-accent' : 'bg-theme-bg-tertiary'" />
              <div
                class="absolute left-0.5 top-0.5 w-4 h-4 bg-theme-text-on-accent rounded-full transition-transform duration-200"
                :class="shareAudio ? 'translate-x-4' : 'translate-x-0'" />
            </div>
            <span class="ml-2 text-sm text-theme-text-secondary">
              {{ venmicAvailable ? "Share app audio" : "Share system audio" }}
            </span>
          </label>
        </div>

        <!-- Audio Source Picker -->
        <div v-if="shareAudio && venmicAvailable" class="px-5 pb-3 flex-shrink-0">
          <AudioSourcePicker v-model:selected-sources="selectedAudioSources" />
        </div>

        <!-- Actions -->
        <div
          class="px-5 py-3 border-t border-theme-border flex justify-end space-x-2 flex-shrink-0">
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg bg-theme-bg-tertiary text-sm text-theme-text-secondary hover:bg-theme-bg-primary transition-colors duration-200"
            @click="handleCancel">
            Cancel
          </button>

          <button
            type="button"
            class="px-3 py-1.5 rounded-lg bg-theme-accent text-sm text-theme-text-on-accent hover:bg-theme-accent/80 transition-colors duration-200 flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!selectedSourceId || isStarting"
            @click="handleStartShare">
            <div
              v-if="isStarting"
              class="animate-spin rounded-full h-4 w-4 border-b-2 border-theme-text-on-accent mr-1.5" />
            <PhMonitorPlay class="w-4 h-4 mr-1.5" />
            Start Sharing
          </button>
        </div>
      </div>

      <!-- Browser Modal: Original Quality Selection -->
      <div
        v-else
        class="relative bg-theme-bg-secondary rounded-xl shadow-2xl max-w-md w-full mx-4 border border-theme-border max-h-[90svh] overflow-y-auto">
        <!-- Header -->
        <div class="px-5 py-3 border-b border-theme-border">
          <div class="flex items-center">
            <PhMonitorPlay class="w-5 h-5 text-theme-accent mr-2" />
            <h2 class="text-lg font-semibold text-theme-text-primary">Share Your Screen</h2>
          </div>
          <p class="text-xs text-theme-text-muted mt-0.5">Select streaming quality and audio</p>
        </div>

        <!-- Quality Selection -->
        <div class="px-5 py-3 space-y-2">
          <label class="text-xs font-medium text-theme-text-secondary uppercase tracking-wide"
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
                  ? 'border-theme-accent bg-theme-accent/10'
                  : 'border-theme-border bg-theme-bg-tertiary/30 hover:border-theme-text-muted hover:bg-theme-bg-tertiary/50',
              ]"
              @click="selectedQuality = option.value">
              <div
                class="w-3 h-3 rounded-full border mr-2 flex-shrink-0 flex items-center justify-center"
                :class="[
                  selectedQuality === option.value
                    ? 'border-theme-accent bg-theme-accent'
                    : 'border-theme-text-muted',
                ]">
                <div
                  v-if="selectedQuality === option.value"
                  class="w-1.5 h-1.5 bg-theme-text-on-accent rounded-full" />
              </div>
              <div class="min-w-0">
                <div class="text-sm text-theme-text-primary font-medium leading-tight">
                  {{ option.label }}
                </div>
                <div class="text-[10px] text-theme-text-muted truncate">
                  {{ option.description }}
                </div>
              </div>
            </button>
          </div>
        </div>

        <!-- Audio Info -->
        <div class="px-5 py-2 border-t border-theme-border">
          <p
            v-if="!isScreenShareAudioSupported"
            class="text-xs text-theme-text-muted flex items-start">
            <PhInfo class="w-3.5 h-3.5 mr-1 flex-shrink-0 mt-0.5" />
            <span>System audio sharing is only available in Chrome and Edge browsers</span>
          </p>
          <p v-else class="text-xs text-theme-text-muted flex items-start">
            <PhSpeakerHigh class="w-3.5 h-3.5 mr-1 flex-shrink-0 mt-0.5" />
            <span>Audio will be requested in the browser's screen share dialog</span>
          </p>
        </div>

        <!-- Actions -->
        <div class="px-5 py-3 border-t border-theme-border flex justify-end space-x-2">
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg bg-theme-bg-tertiary text-sm text-theme-text-secondary hover:bg-theme-bg-primary transition-colors duration-200"
            @click="handleCancel">
            Cancel
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg bg-theme-accent text-sm text-theme-text-on-accent hover:bg-theme-accent/80 transition-colors duration-200 flex items-center"
            @click="handleBrowserStartShare">
            <PhMonitorPlay class="w-4 h-4 mr-1.5" />
            Start
          </button>
        </div>
      </div>

      <!-- Error Banner -->
      <AudioCaptureError :visible="!!audioCaptureError" :message="audioCaptureError ?? ''" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from "vue"
import {
  PhMonitorPlay,
  PhSpeakerHigh,
  PhInfo,
  PhWarning,
  PhArrowClockwise,
} from "@phosphor-icons/vue"
import { useScreenShareSupport } from "@/composables/useScreenShareSupport"
import { getDesktopSources, getPlatform } from "@/services/electron"
import { hasVenmic, hasPipeWire, getSavedSources, saveSources } from "@/services/venmic"
import { isWinAudioSupported, listWinAudioApps, pidOfWindowSource } from "@/services/winAudio"
import AudioSourcePicker from "./AudioSourcePicker.vue"
import AudioCaptureError from "./AudioCaptureError.vue"
import type {
  DesktopSource,
  ScreenShareQuality,
  VenmicSource,
  WinAudioApp,
  WinAudioTarget,
} from "@/types"

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
  "select-electron-source": [
    quality: ScreenShareQuality,
    sourceId: string,
    audio: boolean,
    audioSources?: VenmicSource[],
    winAudioTarget?: WinAudioTarget,
  ]
  cancel: []
}>()

const { isRunningInElectron, isScreenShareAudioSupported } = useScreenShareSupport()

const qualityOptions: QualityOption[] = [
  { value: "adaptive", label: "Adaptive", description: "LiveKit adjusts quality automatically" },
  {
    value: "fullhd60",
    label: "Full HD 60fps",
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

const sources = ref<DesktopSource[]>([])
const selectedSourceId = ref<string | null>(null)
const isLoadingSources = ref(false)
const sourcesError = ref<string | null>(null)
const isStarting = ref(false)

const venmicAvailable = ref(false)
const audioCaptureError = ref<string | null>(null)
const selectedAudioSources = ref<VenmicSource[]>([])

const platform = ref<string | null>(null)

// Windows per-app audio (docs/specs/WINDOWS_APP_AUDIO.md)
type WinAudioMode = "off" | "system" | "app"
const winAudioModeOptions: { value: WinAudioMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "system", label: "System (without Orbital)" },
  { value: "app", label: "One app" },
]
const winAudioSupported = ref(false)
const winAudioMode = ref<WinAudioMode>("off")
const winAudioApps = ref<WinAudioApp[]>([])
const selectedWinAppPid = ref<number | null>(null)

async function refreshWinAudioApps() {
  const apps = await listWinAudioApps()
  // Keep the current pick even if its app has no audio session right now.
  const picked = winAudioApps.value.find((a) => a.pid === selectedWinAppPid.value)
  if (picked && !apps.some((a) => a.pid === picked.pid)) apps.push(picked)
  winAudioApps.value = apps
}

// Sharing a window: preselect the app that owns it.
watch(selectedSourceId, async (id) => {
  if (!winAudioSupported.value || !id?.startsWith("window:")) return
  const pid = await pidOfWindowSource(id)
  if (!pid || selectedSourceId.value !== id) return
  if (!winAudioApps.value.some((a) => a.pid === pid)) {
    const source = sources.value.find((s) => s.id === id)
    winAudioApps.value = [
      ...winAudioApps.value,
      { pid, name: source?.name ?? `Process ${pid}`, exe: "", active: false },
    ]
  }
  selectedWinAppPid.value = pid
})

const selectedSourceIsWindow = computed(
  () => platform.value === "win32" && (selectedSourceId.value?.startsWith("window:") ?? false),
)

const hasSelectedSource = computed(
  () => selectedSourceId.value !== null && selectedSourceId.value !== "",
)

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
      venmicAvailable.value = false
      selectedAudioSources.value = []
      audioCaptureError.value = null
      winAudioSupported.value = false
      winAudioMode.value = "off"
      winAudioApps.value = []
      selectedWinAppPid.value = null

      if (isRunningInElectron.value) {
        sources.value = []
        await loadSources()

        platform.value = await getPlatform()
        if (platform.value === "linux") {
          const [venmic, pipewire] = await Promise.all([hasVenmic(), hasPipeWire()])
          venmicAvailable.value = venmic && pipewire
          if (venmicAvailable.value) {
            selectedAudioSources.value = await getSavedSources()
          }
        } else if (platform.value === "win32") {
          winAudioSupported.value = await isWinAudioSupported()
          if (winAudioSupported.value) await refreshWinAudioApps()
        }
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

  if (shareAudio.value && venmicAvailable.value && selectedAudioSources.value.length === 0) {
    audioCaptureError.value = "Please select at least one audio source"
    return
  }

  if (winAudioSupported.value) {
    let target: WinAudioTarget | undefined
    if (winAudioMode.value === "system") {
      target = { mode: "exclude-self" }
    } else if (winAudioMode.value === "app") {
      if (selectedWinAppPid.value === null) {
        audioCaptureError.value = "Choose an app to share audio from"
        return
      }
      target = { mode: "include", pid: selectedWinAppPid.value }
    }
    audioCaptureError.value = null
    isStarting.value = true
    emit(
      "select-electron-source",
      selectedQuality.value,
      selectedSourceId.value,
      !!target,
      undefined,
      target,
    )
    return
  }

  audioCaptureError.value = null
  isStarting.value = true
  const effectiveAudio =
    platform.value === "win32" && selectedSourceId.value.startsWith("window:")
      ? false
      : shareAudio.value
  if (effectiveAudio && venmicAvailable.value && selectedAudioSources.value.length > 0) {
    void saveSources(selectedAudioSources.value)
  }
  emit(
    "select-electron-source",
    selectedQuality.value,
    selectedSourceId.value,
    effectiveAudio,
    effectiveAudio ? selectedAudioSources.value : undefined,
  )
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
