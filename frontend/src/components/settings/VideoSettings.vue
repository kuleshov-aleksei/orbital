<template>
  <div class="space-y-4">
    <h3
      v-if="!hideHeader"
      class="text-lg font-medium text-theme-text-primary flex items-center gap-2">
      <PhCamera class="w-5 h-5 text-theme-accent" />
      Video Settings
    </h3>

    <!-- Camera Selection -->
    <div class="space-y-3">
      <div>
        <label class="text-sm font-medium text-theme-text-primary block mb-1.5"> Camera </label>

        <select
          v-model="selectedDevice"
          class="w-full bg-theme-bg-tertiary border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-transparent"
          @change="onDeviceChange">
          <option value="">Default</option>
          <option
            v-for="device in availableDevices"
            :key="device.deviceId"
            :value="device.deviceId">
            {{ device.label }}
          </option>
        </select>
      </div>
    </div>

    <!-- Video Preview -->
    <div class="space-y-2">
      <label class="text-sm font-medium text-theme-text-primary block"> Preview </label>

      <div
        class="relative rounded-lg overflow-hidden bg-theme-bg-tertiary aspect-video border border-theme-border">
        <video ref="videoRef" autoplay playsinline muted class="w-full h-full object-cover" />

        <div
          v-if="!isPreviewActive"
          class="absolute inset-0 flex items-center justify-center bg-theme-bg-tertiary">
          <div class="text-center text-theme-text-muted">
            <PhCamera class="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p class="text-sm">Camera preview unavailable</p>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors"
        :class="
          isPreviewActive
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent'
        "
        @click="togglePreview">
        {{ isPreviewActive ? "Stop Preview" : "Start Preview" }}
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
import { ref, onMounted, onUnmounted, watch } from "vue"
import { useVideoSettingsStore } from "@/stores"
import { useModalStore } from "@/stores/modal"
import { PhCamera, PhArrowCounterClockwise } from "@phosphor-icons/vue"

defineProps<{
  hideHeader?: boolean
}>()

const videoStore = useVideoSettingsStore()
const modalStore = useModalStore()

const videoRef = ref<HTMLVideoElement | null>(null)
const selectedDevice = ref<string>("")
const isPreviewActive = ref(false)
const previewStream = ref<MediaStream | null>(null)
const previewTrack = ref<MediaStreamTrack | null>(null)

const availableDevices = ref<{ deviceId: string; label: string }[]>([])

async function loadDevices() {
  const devices = await videoStore.requestPermissionsAndEnumerate()
  availableDevices.value = devices
}

function onDeviceChange() {
  videoStore.setSelectedDeviceId(selectedDevice.value || null)
  if (isPreviewActive.value) {
    restartPreview()
  }
}

async function startPreview() {
  try {
    const constraints: MediaStreamConstraints = {
      video: selectedDevice.value ? { deviceId: { exact: selectedDevice.value } } : true,
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    previewStream.value = stream

    const videoTrack = stream.getVideoTracks()[0]
    previewTrack.value = videoTrack || null

    if (videoRef.value) {
      videoRef.value.srcObject = stream
    }

    isPreviewActive.value = true
  } catch (e) {
    console.error("Failed to start preview:", e)
    isPreviewActive.value = false
  }
}

function stopPreview() {
  if (previewTrack.value) {
    if (previewTrack.value.readyState === "live") {
      previewTrack.value.stop()
    }
    previewTrack.value = null
  }

  if (previewStream.value) {
    previewStream.value.getTracks().forEach((track) => track.stop())
    previewStream.value = null
  }

  if (videoRef.value) {
    videoRef.value.pause()
    videoRef.value.srcObject = null
    videoRef.value.load()
  }

  isPreviewActive.value = false
}

async function togglePreview() {
  if (isPreviewActive.value) {
    stopPreview()
  } else {
    await startPreview()
  }
}

async function restartPreview() {
  stopPreview()
  await startPreview()
}

function resetSettings() {
  if (confirm("Reset video settings to default?")) {
    videoStore.resetSettings()
    selectedDevice.value = ""
    if (isPreviewActive.value) {
      restartPreview()
    }
  }
}

watch(
  () => videoStore.selectedDeviceId,
  (newVal) => {
    selectedDevice.value = newVal || ""
  },
  { immediate: true },
)

onMounted(async () => {
  videoStore.loadSettings()
  selectedDevice.value = videoStore.selectedDeviceId || ""
  await loadDevices()
  await startPreview()
})

watch(
  () => modalStore.isUserSettingsModal,
  (isOpen) => {
    if (!isOpen) {
      stopPreview()
    }
  },
)

onUnmounted(() => {
  stopPreview()
})

defineExpose({
  stopPreview,
})
</script>
