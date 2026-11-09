<template>
  <div class="space-y-2" data-testid="soundboard-editor">
    <SoundboardWaveform
      v-model="range"
      :pcm="audio.pcm"
      :sample-rate="audio.sampleRate"
      :max-length="MAX_DURATION_S"
      :playhead="playhead" />
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="h-8 px-2.5 rounded flex items-center gap-1.5 text-xs bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
        :title="isPreviewing ? 'Stop' : 'Preview the selection as it will be uploaded'"
        @click="togglePreview">
        <PhStop v-if="isPreviewing" class="w-4 h-4" />
        <PhPlay v-else class="w-4 h-4" />
        {{ isPreviewing ? "Stop" : "Preview" }}
      </button>
      <button
        type="button"
        class="h-8 px-2.5 rounded flex items-center gap-1.5 text-xs bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
        title="Select only the audible part"
        @click="trimSilence">
        <PhScissors class="w-4 h-4" />
        Trim silence
      </button>
      <button
        type="button"
        class="h-8 px-2.5 rounded flex items-center gap-1.5 text-xs bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
        title="Select from the start"
        @click="resetRange">
        <PhArrowCounterClockwise class="w-4 h-4" />
        Reset
      </button>
      <span class="ml-auto font-mono text-xs text-theme-text-secondary">
        {{ range.start.toFixed(2) }}–{{ range.end.toFixed(2) }}s · {{ selectionLength.toFixed(1) }}s
      </span>
    </div>
    <p class="text-[11px] text-theme-text-muted">
      Drag the highlighted range or its edges. Up to {{ MAX_DURATION_S }} seconds.
    </p>

    <!-- Loudness -->
    <div
      class="rounded border border-theme-border bg-theme-bg-tertiary/50 px-3 py-2 space-y-1.5"
      data-testid="soundboard-loudness">
      <div class="flex items-center gap-2 text-xs">
        <span class="text-theme-text-secondary">Loudness</span>
        <span
          v-if="measurement && Number.isFinite(measurement.integratedLufs)"
          class="font-mono px-1.5 py-0.5 rounded"
          :class="
            isNearTarget ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
          ">
          {{ measurement.integratedLufs.toFixed(1) }} LUFS
        </span>
        <span v-else-if="measurement" class="text-theme-text-muted">silent</span>
        <span v-else class="text-theme-text-muted">measuring…</span>
        <span
          v-if="measurement && Number.isFinite(measurement.peakDb)"
          class="font-mono text-theme-text-muted">
          peak {{ measurement.peakDb.toFixed(1) }} dB
        </span>
        <span class="ml-auto text-theme-text-muted"> recommended {{ TARGET_LUFS }} LUFS </span>
      </div>
      <label class="flex items-center gap-2 text-xs text-theme-text-primary">
        <input
          v-model="normalize"
          type="checkbox"
          class="accent-[var(--color-accent)]"
          :disabled="!gain" />
        Normalize to {{ TARGET_LUFS }} LUFS
        <span v-if="normalize && gain" class="font-mono text-theme-text-secondary">
          {{ gain.gainDb >= 0 ? "+" : "" }}{{ gain.gainDb.toFixed(1) }} dB
        </span>
        <span v-if="normalize && gain?.limited" class="text-amber-300">
          limited by peak (≈{{ resultingLufs?.toFixed(1) }} LUFS)
        </span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
// Waveform trim + loudness normalization editor, shared by the upload modal
// and the admin "Edit audio" modal. Mirrors orbital-audiospriter's editor.
import { computed, onUnmounted, ref, watch } from "vue"
import { PhArrowCounterClockwise, PhPlay, PhScissors, PhStop } from "@phosphor-icons/vue"
import SoundboardWaveform from "@/components/soundboard/SoundboardWaveform.vue"
import type { DecodedAudio } from "@/services/audioDecode"
import { disposePcmPreview, playPcmPreview, stopPcmPreview } from "@/services/pcmPreview"
import { measureLoudness, type LoudnessMeasurement } from "@/utils/loudness"
import {
  TARGET_LUFS,
  applyGain,
  detectSilenceBounds,
  normalizationGain,
  sliceRange,
  type TimeRange,
} from "@/utils/soundEdit"
import { pcmToWav16 } from "@/utils/wav"

const props = defineProps<{ audio: DecodedAudio }>()

// Keep in sync with MaxSoundboardDuration in backend/internal/service/soundboardopus.go.
const MAX_DURATION_S = 5
/** Within this many LU of the target counts as "already fine". */
const TARGET_TOLERANCE_LU = 2

const range = ref<TimeRange>({ start: 0, end: 0 })
const measurement = ref<LoudnessMeasurement | null>(null)
const normalize = ref(true)
const isPreviewing = ref(false)
const playhead = ref<number | null>(null)

const selectionLength = computed(() => range.value.end - range.value.start)
const gain = computed(() =>
  measurement.value
    ? normalizationGain(measurement.value.integratedLufs, measurement.value.peakDb)
    : null,
)
const isNearTarget = computed(
  () =>
    !!measurement.value &&
    Math.abs(measurement.value.integratedLufs - TARGET_LUFS) <= TARGET_TOLERANCE_LU,
)
const resultingLufs = computed(() =>
  measurement.value && gain.value ? measurement.value.integratedLufs + gain.value.gainDb : null,
)
const hasValidSelection = computed(
  () => selectionLength.value > 0 && selectionLength.value <= MAX_DURATION_S + 0.01,
)

/** The selected range with normalization applied: exactly what gets uploaded. */
function processedPcm(): Float32Array {
  const slice = sliceRange(props.audio.pcm, props.audio.sampleRate, range.value)
  return normalize.value && gain.value ? applyGain(slice, gain.value.gainDb) : slice
}

/** Encode the edited selection as the WAV the backend expects, or null if empty. */
function exportWav(): Uint8Array<ArrayBuffer> | null {
  stopPreview()
  if (!hasValidSelection.value) return null
  return pcmToWav16(processedPcm(), props.audio.sampleRate)
}

// Re-measure the selection while it is being dragged, at most every 150 ms.
let measureTimer: ReturnType<typeof setTimeout> | null = null
watch(
  range,
  () => {
    stopPreview()
    if (measureTimer) clearTimeout(measureTimer)
    measureTimer = setTimeout(() => {
      measureTimer = null
      const slice = sliceRange(props.audio.pcm, props.audio.sampleRate, range.value)
      measurement.value = measureLoudness(slice, props.audio.sampleRate)
    }, 150)
  },
  { deep: true },
)

function clampedRange(bounds: TimeRange): TimeRange {
  return { start: bounds.start, end: Math.min(bounds.end, bounds.start + MAX_DURATION_S) }
}

function trimSilence() {
  const bounds = detectSilenceBounds(props.audio.pcm, props.audio.sampleRate)
  range.value = clampedRange(bounds ?? { start: 0, end: props.audio.duration })
}

function resetRange() {
  range.value = clampedRange({ start: 0, end: props.audio.duration })
}

function stopPreview() {
  stopPcmPreview()
  isPreviewing.value = false
  playhead.value = null
}

function togglePreview() {
  if (isPreviewing.value) {
    stopPreview()
    return
  }
  const start = range.value.start
  isPreviewing.value = true
  playhead.value = start
  playPcmPreview(
    processedPcm(),
    props.audio.sampleRate,
    (elapsed) => (playhead.value = start + elapsed),
    () => {
      isPreviewing.value = false
      playhead.value = null
    },
  )
}

// New audio: start from the audible part, normalized.
watch(
  () => props.audio,
  () => {
    stopPreview()
    measurement.value = null
    normalize.value = true
    trimSilence()
  },
  { immediate: true },
)

defineExpose({ exportWav, hasValidSelection })

onUnmounted(() => {
  if (measureTimer) clearTimeout(measureTimer)
  disposePcmPreview()
})
</script>
