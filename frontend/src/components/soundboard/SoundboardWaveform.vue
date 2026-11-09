<template>
  <div class="relative">
    <div
      ref="container"
      data-testid="soundboard-waveform"
      class="h-24 w-full rounded border border-theme-border bg-theme-bg-tertiary overflow-hidden"></div>
    <div
      v-if="playhead !== null && duration > 0"
      class="pointer-events-none absolute top-0 bottom-0 w-px bg-theme-text-primary"
      :style="{ left: `${(playhead / duration) * 100}%` }"></div>
  </div>
</template>

<script setup lang="ts">
// Waveform + single trim region, following orbital-audiospriter's EditorView
// wiring. Playback is owned by the parent (Web Audio, so previews can apply
// normalization gain); this component only renders and edits the range.
import { computed, onMounted, onUnmounted, useTemplateRef, watch } from "vue"
import WaveSurfer from "wavesurfer.js"
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js"
import type { Region } from "wavesurfer.js/dist/plugins/regions.js"
import type { TimeRange } from "@/utils/soundEdit"

const props = defineProps<{
  pcm: Float32Array
  sampleRate: number
  maxLength: number
  /** Preview position in seconds, or null when not playing. */
  playhead: number | null
}>()
const range = defineModel<TimeRange>({ required: true })

const container = useTemplateRef<HTMLDivElement>("container")
const PEAK_BUCKETS = 1200

let wavesurfer: WaveSurfer | null = null
let region: Region | null = null
const duration = computed(() => props.pcm.length / props.sampleRate)

/** Max-abs envelope; wavesurfer only needs one value per drawn bar. */
function computePeaks(pcm: Float32Array): Float32Array {
  const buckets = Math.min(PEAK_BUCKETS, pcm.length)
  const size = pcm.length / buckets
  const peaks = new Float32Array(buckets)
  for (let b = 0; b < buckets; b++) {
    let max = 0
    const end = Math.min(pcm.length, Math.floor((b + 1) * size))
    for (let i = Math.floor(b * size); i < end; i++) {
      const v = Math.abs(pcm[i])
      if (v > max) max = v
    }
    peaks[b] = max
  }
  return peaks
}

function themeColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function destroy() {
  wavesurfer?.destroy()
  wavesurfer = null
  region = null
}

async function render() {
  destroy()
  if (!container.value || props.pcm.length === 0) return
  const muted = themeColor("--color-text-muted", "#9ca3af")
  const instance = WaveSurfer.create({
    container: container.value,
    height: "auto",
    waveColor: muted,
    progressColor: muted,
    cursorWidth: 0,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    interact: false,
  })
  const regions = instance.registerPlugin(RegionsPlugin.create())
  wavesurfer = instance
  try {
    await instance.load("", [computePeaks(props.pcm)], duration.value)
  } catch {
    return // superseded by a newer render, or destroyed
  }
  if (wavesurfer !== instance) return

  region = regions.addRegion({
    start: range.value.start,
    end: range.value.end,
    color: "color-mix(in srgb, var(--color-accent) 30%, transparent)",
    drag: true,
    resize: true,
    minLength: 0.05,
    maxLength: props.maxLength,
  })
  region.on("update", () => {
    if (region) range.value = { start: region.start, end: region.end }
  })
}

// External changes (Trim silence / Reset) move the region.
watch(range, (next) => {
  if (!region) return
  if (Math.abs(region.start - next.start) > 1e-4 || Math.abs(region.end - next.end) > 1e-4) {
    region.setOptions({ start: next.start, end: next.end })
  }
})

watch(() => props.pcm, render)
onMounted(render)
onUnmounted(destroy)
</script>
