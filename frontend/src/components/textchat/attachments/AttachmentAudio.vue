<template>
  <div
    class="flex items-center gap-3 w-full max-w-[420px] rounded-lg border border-theme-border bg-theme-bg-secondary px-3 py-2"
    data-testid="attachment-audio"
    @contextmenu.prevent="$emit('menu', $event)">
    <button
      type="button"
      class="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-full bg-theme-accent text-white hover:bg-theme-accent-hover disabled:opacity-50 transition-colors"
      :aria-label="playing ? 'Pause' : 'Play'"
      :disabled="gone"
      data-testid="attachment-audio-play"
      @click="toggle">
      <PhPause v-if="playing" class="w-4 h-4" weight="fill" />
      <PhPlay v-else class="w-4 h-4" weight="fill" />
    </button>
    <div class="flex-1 min-w-0">
      <div class="flex items-baseline gap-2 text-xs">
        <span class="truncate font-medium text-theme-text-primary" :title="attachment.filename">{{
          attachment.filename
        }}</span>
        <span class="ml-auto flex-shrink-0 tabular-nums text-theme-text-muted"
          >{{ formatClock(position) }} / {{ formatClock(duration) }}</span
        >
      </div>
      <!-- Waveform from stored peaks: nothing is downloaded until play. -->
      <div v-if="hasPeaks" ref="wave" class="h-8 mt-1 cursor-pointer" />
      <input
        v-else
        type="range"
        min="0"
        :max="duration || 0"
        step="0.1"
        :value="position"
        class="w-full mt-1 accent-[var(--color-accent)]"
        aria-label="Seek"
        @input="seek(Number(($event.target as HTMLInputElement).value))" />
    </div>
    <audio ref="audio" preload="none" :src="url ?? undefined" @error="onError" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue"
import WaveSurfer from "wavesurfer.js"
import { PhPause, PhPlay } from "@phosphor-icons/vue"
import { useAttachmentUrl } from "@/services/attachments/urls"
import type { TextAttachment } from "@/types/textChat"

const props = defineProps<{ attachment: TextAttachment }>()
defineEmits<{ menu: [event: MouseEvent] }>()

const audio = useTemplateRef<HTMLAudioElement>("audio")
const wave = useTemplateRef<HTMLDivElement>("wave")
const playing = ref(false)
const position = ref(0)
const duration = ref((props.attachment.duration_ms ?? 0) / 1000)
const hasPeaks = computed(() => (props.attachment.peaks?.length ?? 0) > 1 && duration.value > 0)

const { url, gone, onError } = useAttachmentUrl(
  () => props.attachment.id,
  () => "original",
)

let wavesurfer: WaveSurfer | null = null

function themeColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

onMounted(() => {
  const el = audio.value
  if (!el) return
  el.addEventListener("play", () => (playing.value = true))
  el.addEventListener("pause", () => (playing.value = false))
  el.addEventListener("ended", () => (playing.value = false))
  el.addEventListener("timeupdate", () => (position.value = el.currentTime))
  el.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(el.duration)) duration.value = el.duration
  })
  if (hasPeaks.value && wave.value) {
    // With media + peaks + duration, wavesurfer draws without fetching audio.
    wavesurfer = WaveSurfer.create({
      container: wave.value,
      media: el,
      peaks: [props.attachment.peaks!.map((p) => p / 255)],
      duration: duration.value,
      height: "auto",
      waveColor: themeColor("--color-theme-text-muted", "#888"),
      progressColor: themeColor("--color-accent", "#4f46e5"),
      cursorWidth: 0,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: false,
      dragToSeek: true,
    })
  }
})

onBeforeUnmount(() => {
  wavesurfer?.destroy()
  wavesurfer = null
})

function toggle() {
  const el = audio.value
  if (!el || !url.value) return
  if (el.paused) void el.play().catch(() => {})
  else el.pause()
}

function seek(seconds: number) {
  const el = audio.value
  if (el) el.currentTime = seconds
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
</script>
