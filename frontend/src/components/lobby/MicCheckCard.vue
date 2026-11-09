<template>
  <section
    data-testid="mic-check"
    class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 bg-theme-bg-secondary rounded-xl px-4 py-3 border border-theme-border">
    <!-- Label -->
    <div class="flex items-center gap-3 min-w-0" :class="isActive ? 'sm:shrink-0' : 'flex-1'">
      <div
        class="w-9 h-9 rounded-full bg-theme-bg-tertiary flex items-center justify-center shrink-0">
        <PhMicrophone class="w-4 h-4 text-theme-text-secondary" />
      </div>
      <div class="min-w-0">
        <h3 class="text-sm font-semibold text-theme-text-primary">Mic check</h3>
        <p class="text-xs" :class="error ? 'text-red-400' : 'text-theme-text-muted'">
          {{ statusText }}
        </p>
      </div>
    </div>

    <!-- Controls -->
    <div v-if="isActive" class="flex flex-1 items-center gap-3 min-w-0">
      <select
        v-model="selectedDevice"
        aria-label="Input device"
        class="min-w-0 w-48 shrink bg-theme-bg-tertiary text-theme-text-primary text-sm rounded-lg px-2 py-1.5 border border-theme-border focus:outline-none focus:border-theme-accent">
        <option value="">System default</option>
        <option
          v-for="device in audioStore.availableInputDevices"
          :key="device.deviceId"
          :value="device.deviceId">
          {{ device.label }}
        </option>
      </select>
      <div class="flex-1 min-w-16 h-2 rounded-full bg-theme-bg-tertiary overflow-hidden">
        <div
          data-testid="mic-check-meter"
          class="h-full rounded-full transition-[width] duration-75"
          :class="isHearing ? 'bg-green-500' : 'bg-theme-text-muted'"
          :style="{ width: `${levelPercent}%` }"></div>
      </div>
    </div>

    <button
      type="button"
      :data-testid="isActive ? 'mic-check-stop' : 'mic-check-start'"
      :disabled="isStarting"
      class="shrink-0 px-3 py-1.5 rounded-lg bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary text-sm font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
      @click="isActive ? stop() : start()">
      {{ isActive ? "Stop" : isStarting ? "Starting…" : "Test your mic" }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue"
import { PhMicrophone } from "@phosphor-icons/vue"
import { useAudioSettingsStore } from "@/stores"
import { useVoiceActivity } from "@/composables/useVoiceActivity"

const audioStore = useAudioSettingsStore()

const stream = shallowRef<MediaStream | null>(null)
const isStarting = ref(false)
const error = ref<string | null>(null)
const selectedDevice = ref<string>(audioStore.inputDeviceId ?? "")

const isActive = computed(() => stream.value !== null)

const { audioLevel, cleanup: cleanupAnalysis } = useVoiceActivity({
  stream,
  isMuted: ref(false),
  updateInterval: 50,
})

// RMS of normal speech sits around 0.02–0.2; scale so talking fills most of the bar.
const levelPercent = computed(() => Math.min(100, Math.round(audioLevel.value * 500)))
const isHearing = computed(() => levelPercent.value > 4)

const statusText = computed(() => {
  if (error.value) return error.value
  if (!isActive.value) return "Make sure people can hear you before jumping in."
  return isHearing.value ? "Sounding good!" : "Say something…"
})

function buildConstraints(): MediaTrackConstraints {
  const base = audioStore.audioConstraints
  const constraints: MediaTrackConstraints = typeof base === "object" ? { ...base } : {}
  if (selectedDevice.value) constraints.deviceId = { exact: selectedDevice.value }
  return constraints
}

function releaseStream() {
  stream.value?.getTracks().forEach((t) => t.stop())
  stream.value = null
  cleanupAnalysis()
}

async function start() {
  if (isStarting.value) return
  isStarting.value = true
  error.value = null
  try {
    const media = await navigator.mediaDevices.getUserMedia({ audio: buildConstraints() })
    releaseStream()
    stream.value = media
    // Labels are only available after permission is granted.
    await audioStore.enumerateInputDevices()
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ""
    error.value =
      name === "NotAllowedError"
        ? "Microphone access was blocked. Allow it in your browser settings."
        : name === "NotFoundError" || name === "OverconstrainedError"
          ? "No microphone found."
          : "Couldn't start the microphone."
  } finally {
    isStarting.value = false
  }
}

function stop() {
  releaseStream()
}

watch(selectedDevice, (deviceId) => {
  if ((audioStore.inputDeviceId ?? "") !== deviceId) {
    audioStore.setInputDeviceId(deviceId || null)
  }
  if (isActive.value) void start()
})

function handleVisibility() {
  if (document.hidden) stop()
}

onMounted(() => document.addEventListener("visibilitychange", handleVisibility))

// The lobby unmounts as soon as a room is joined; free the mic before LiveKit takes it.
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", handleVisibility)
  releaseStream()
})
</script>
