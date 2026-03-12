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
        <video ref="videoRef" playsinline muted class="w-full h-full object-cover" />

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

    <!-- Background Blur -->
    <div class="space-y-3 pt-2">
      <div class="flex items-center justify-between">
        <label class="text-sm font-medium text-theme-text-primary"> Background Blur </label>
        <button
          type="button"
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
          :class="backgroundBlurEnabled ? 'bg-theme-accent' : 'bg-theme-bg-tertiary'"
          :disabled="!supportsProcessors"
          @click="toggleBackgroundBlur">
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
            :class="backgroundBlurEnabled ? 'translate-x-6' : 'translate-x-1'" />
        </button>
      </div>

      <div v-if="backgroundBlurEnabled && !virtualBackgroundEnabled" class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs text-theme-text-muted"> Blur Strength </label>
          <span class="text-xs text-theme-text-muted">{{ backgroundBlurRadius }}</span>
        </div>
        <input
          type="range"
          min="1"
          max="50"
          :value="backgroundBlurRadius"
          class="w-full h-2 bg-theme-bg-tertiary rounded-lg appearance-none cursor-pointer accent-theme-accent"
          @input="onBlurRadiusChange" />
      </div>

      <p v-if="!supportsProcessors" class="text-xs text-theme-text-muted">
        Background effects not supported in this browser
      </p>
    </div>

    <!-- Virtual Background -->
    <div class="space-y-3 pt-2">
      <div class="flex items-center justify-between">
        <label class="text-sm font-medium text-theme-text-primary"> Virtual Background </label>
        <button
          type="button"
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
          :class="virtualBackgroundEnabled ? 'bg-theme-accent' : 'bg-theme-bg-tertiary'"
          :disabled="!supportsProcessors"
          @click="toggleVirtualBackground">
          <span
            class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
            :class="virtualBackgroundEnabled ? 'translate-x-6' : 'translate-x-1'" />
        </button>
      </div>

      <div v-if="virtualBackgroundEnabled && !backgroundBlurEnabled" class="space-y-3">
        <label class="text-xs text-theme-text-muted block"> Select Background </label>

        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="(image, index) in presetImages"
            :key="index"
            type="button"
            class="relative aspect-video rounded-lg overflow-hidden border-2 transition-colors"
            :class="
              selectedVirtualBackground === image.path
                ? 'border-theme-accent'
                : 'border-transparent hover:border-theme-border'
            "
            @click="selectVirtualBackground(image.path)">
            <img :src="image.path" :alt="image.name" class="w-full h-full object-cover" />
          </button>

          <button
            type="button"
            class="relative aspect-video rounded-lg overflow-hidden border-2 border-dashed border-theme-border hover:border-theme-accent flex items-center justify-center bg-theme-bg-tertiary"
            @click="triggerImageUpload">
            <PhPlus class="w-6 h-6 text-theme-text-muted" />
          </button>
        </div>

        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          class="hidden"
          @change="onImageUpload" />

        <div v-if="customImages.length > 0" class="space-y-2">
          <label class="text-xs text-theme-text-muted block"> Custom Images </label>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="(image, index) in customImages"
              :key="index"
              type="button"
              class="relative aspect-video rounded-lg overflow-hidden border-2 transition-colors"
              :class="
                selectedVirtualBackground === image
                  ? 'border-theme-accent'
                  : 'border-transparent hover:border-theme-border'
              "
              @click="selectVirtualBackground(image)">
              <img :src="image" alt="Custom background" class="w-full h-full object-cover" />
            </button>
          </div>
        </div>
      </div>
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
import { ref, computed, onMounted, onUnmounted, watch, useTemplateRef } from "vue"
import { createLocalVideoTrack, VideoPresets } from "livekit-client"
import type { LocalVideoTrack } from "livekit-client"
import {
  BackgroundProcessor,
  supportsBackgroundProcessors,
  type BackgroundProcessorWrapper,
} from "@livekit/track-processors"
import { useVideoSettingsStore } from "@/stores"
import { useModalStore } from "@/stores/modal"
import { PhCamera, PhArrowCounterClockwise, PhPlus } from "@phosphor-icons/vue"

defineProps<{
  hideHeader?: boolean
}>()

const videoStore = useVideoSettingsStore()
const modalStore = useModalStore()

const videoRef = useTemplateRef<HTMLVideoElement>("videoRef")
const fileInputRef = useTemplateRef<HTMLInputElement>("fileInputRef")
const selectedDevice = ref<string>("")
const isPreviewActive = ref(false)
const previewTrack = ref<LocalVideoTrack | null>(null)
const previewProcessor = ref<BackgroundProcessorWrapper | null>(null)

const availableDevices = ref<{ deviceId: string; label: string }[]>([])
const supportsProcessors = ref(false)
const customImages = ref<string[]>([])

const presetImages = [
  { name: "Image 1", path: "/assets/virtual-backgrounds/image-1.jpg" },
  { name: "Image 2", path: "/assets/virtual-backgrounds/image-2.jpg" },
  { name: "Image 3", path: "/assets/virtual-backgrounds/image-3.png" },
  { name: "Image 4", path: "/assets/virtual-backgrounds/image-4.jpg" },
  { name: "Image 5", path: "/assets/virtual-backgrounds/image-5.jpg" },
]

const backgroundBlurEnabled = computed(() => videoStore.backgroundBlurEnabled)
const backgroundBlurRadius = computed(() => videoStore.backgroundBlurRadius)
const virtualBackgroundEnabled = computed(() => videoStore.virtualBackgroundEnabled)
const virtualBackgroundImage = computed(() => videoStore.virtualBackgroundImage)

const selectedVirtualBackground = computed(() => {
  if (virtualBackgroundImage.value) {
    return virtualBackgroundImage.value
  }
  return ""
})

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

async function createProcessor(): Promise<BackgroundProcessorWrapper | null> {
  if (!supportsProcessors.value) return null

  try {
    let mode: "background-blur" | "virtual-background" | "disabled" = "disabled"

    if (backgroundBlurEnabled.value) {
      mode = "background-blur"
    } else if (virtualBackgroundEnabled.value && virtualBackgroundImage.value) {
      mode = "virtual-background"
    }

    const processor = BackgroundProcessor({
      mode,
      ...(mode === "background-blur" && { blurRadius: backgroundBlurRadius.value }),
      ...(mode === "virtual-background" && { imagePath: virtualBackgroundImage.value }),
      assetPaths: {
        tasksVisionFileSet: "/assets/wasm",
        modelAssetPath: "/assets/models/selfie_segmenter.tflite",
      },
    })

    return processor
  } catch (e) {
    console.error("Failed to create background processor:", e)
    return null
  }
}

async function updateProcessor() {
  if (!previewProcessor.value) return

  try {
    if (backgroundBlurEnabled.value) {
      await previewProcessor.value.switchTo({
        mode: "background-blur",
        blurRadius: backgroundBlurRadius.value,
      })
    } else if (virtualBackgroundEnabled.value && virtualBackgroundImage.value) {
      await previewProcessor.value.switchTo({
        mode: "virtual-background",
        imagePath: virtualBackgroundImage.value,
      })
    } else {
      await previewProcessor.value.switchTo({ mode: "disabled" })
    }
  } catch (e) {
    console.error("Failed to update processor:", e)
  }
}

async function startPreview() {
  try {
    supportsProcessors.value = supportsBackgroundProcessors()

    const videoOptions: { resolution: typeof VideoPresets.h720; deviceId?: string } = {
      resolution: VideoPresets.h720,
    }

    if (selectedDevice.value) {
      videoOptions.deviceId = selectedDevice.value
    }

    const track = await createLocalVideoTrack(videoOptions)
    previewTrack.value = track

    if (supportsProcessors.value) {
      const processor = await createProcessor()
      if (processor) {
        previewProcessor.value = processor
        const originalError = console.error
        console.error = (...args: unknown[]) => {
          if (args[0] === "failed to play processor element, retrying") return
          originalError.apply(console, args)
        }
        try {
          await track.setProcessor(processor, true)
        } finally {
          console.error = originalError
        }
      }
    }

    if (videoRef.value) {
      track.attach(videoRef.value)
    }

    isPreviewActive.value = true
  } catch (e) {
    console.error("Failed to start preview:", e)
    isPreviewActive.value = false
  }
}

function stopPreview() {
  try {
    if (previewProcessor.value && previewTrack.value) {
      previewTrack.value.stopProcessor().catch(() => {})
      previewProcessor.value.destroy()
      previewProcessor.value = null
    }

    if (previewTrack.value) {
      previewTrack.value.stop()
      previewTrack.value = null
    }

    if (videoRef.value) {
      videoRef.value.srcObject = null
    }

    isPreviewActive.value = false
  } catch (e) {
    console.warn("Error stopping preview:", e)
    isPreviewActive.value = false
  }
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

function toggleBackgroundBlur() {
  videoStore.setBackgroundBlurEnabled(!backgroundBlurEnabled.value)
  if (isPreviewActive.value) {
    updateProcessor()
  }
}

function onBlurRadiusChange(event: Event) {
  const target = event.target as HTMLInputElement
  videoStore.setBackgroundBlurRadius(parseInt(target.value, 10))
  if (isPreviewActive.value && backgroundBlurEnabled.value) {
    updateProcessor()
  }
}

function toggleVirtualBackground() {
  videoStore.setVirtualBackgroundEnabled(!virtualBackgroundEnabled.value)
  if (isPreviewActive.value) {
    updateProcessor()
  }
}

function selectVirtualBackground(imagePath: string) {
  videoStore.setVirtualBackgroundImage(imagePath)
  if (isPreviewActive.value) {
    updateProcessor()
  }
}

function triggerImageUpload() {
  fileInputRef.value?.click()
}

function onImageUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    const base64 = e.target?.result as string
    customImages.value.push(base64)
    saveCustomImages()
    videoStore.setVirtualBackgroundImage(base64)
    if (isPreviewActive.value) {
      updateProcessor()
    }
  }
  reader.readAsDataURL(file)

  target.value = ""
}

function saveCustomImages() {
  try {
    localStorage.setItem("orbital_custom_backgrounds", JSON.stringify(customImages.value))
  } catch (e) {
    console.warn("Failed to save custom backgrounds:", e)
  }
}

function loadCustomImages() {
  try {
    const stored = localStorage.getItem("orbital_custom_backgrounds")
    if (stored) {
      customImages.value = JSON.parse(stored)
    }
  } catch (e) {
    console.warn("Failed to load custom backgrounds:", e)
  }
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
  loadCustomImages()
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
