<template>
  <div
    class="absolute bottom-4 right-4 z-[50] bg-theme-bg-secondary rounded-xl border border-theme-border shadow-2xl p-5 min-w-80 max-w-sm">
    <!-- Track list — always visible -->
    <h3 class="text-lg font-semibold text-theme-text-primary mb-3">Boombox</h3>

    <div v-if="tracks.length === 0" class="text-sm text-theme-text-secondary mb-3">
      No tracks available. Upload an MP3 to get started.
    </div>

    <div v-else class="max-h-48 overflow-y-auto mb-3 space-y-1">
      <button
        v-for="track in tracks"
        :key="track.id"
        type="button"
        :class="[
          'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors truncate',
          selectedTrackId === track.id
            ? 'bg-theme-accent/20 border border-theme-accent text-theme-text-primary'
            : 'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary border border-transparent',
        ]"
        @click="selectedTrackId = track.id">
        <div class="font-medium">{{ track.display_name }}</div>
        <div v-if="track.is_system" class="text-xs text-theme-text-tertiary mt-0.5">
          System track
        </div>
      </button>
    </div>

    <div v-if="uploadError" class="text-sm text-red-500 mb-2">{{ uploadError }}</div>

    <!-- Action buttons -->
    <div class="flex gap-2">
      <button
        v-if="!isPlaying"
        type="button"
        class="flex-1 px-3 py-2 bg-theme-accent hover:bg-theme-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        :disabled="!selectedTrackId"
        @click="handlePlay">
        Play
      </button>
      <button
        v-else
        type="button"
        class="flex-1 px-3 py-2 bg-theme-accent hover:bg-theme-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        :disabled="!selectedTrackId"
        @click="handleQueue">
        Queue
      </button>
      <button
        type="button"
        class="px-3 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg text-sm transition-colors"
        @click="handleUpload">
        Upload
      </button>
    </div>

    <!-- Now playing status -->
    <div v-if="isPlaying" class="mt-3 p-3 bg-theme-bg-tertiary rounded-lg">
      <p class="text-xs text-theme-text-tertiary mb-0.5">
        Now playing:
        <span class="text-theme-text-primary font-medium">
          {{ currentTrackName || currentTrackId }}
        </span>
      </p>
      <p v-if="!amIPlaying" class="text-xs text-theme-text-tertiary">
        by <span class="text-theme-text-secondary">{{ ownerNickname }}</span>
      </p>
    </div>

    <!-- Skip + Stop (I'm playing) -->
    <div v-if="amIPlaying" class="flex gap-2 mt-2">
      <button
        type="button"
        class="flex-1 px-3 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg text-sm transition-colors"
        @click="handleSkip">
        Skip
      </button>
      <button
        type="button"
        class="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
        @click="handleStop">
        Stop
      </button>
    </div>

    <!-- Playlist queue -->
    <div v-if="playlist.length > 0" class="mt-3 pt-3 border-t border-theme-border">
      <p class="text-xs text-theme-text-secondary font-medium mb-2">
        Up Next ({{ playlist.length }})
      </p>
      <ul class="space-y-1 max-h-24 overflow-y-auto">
        <li
          v-for="(entry, i) in playlist"
          :key="entry.trackId"
          class="text-sm text-theme-text-secondary truncate flex items-center gap-2">
          <span class="text-theme-text-tertiary w-4 shrink-0 text-xs">{{ i + 1 }}.</span>
          {{ entry.trackName }}
        </li>
      </ul>
    </div>

    <!-- Volume slider -->
    <div class="mt-4 pt-3 border-t border-theme-border">
      <label class="text-xs text-theme-text-secondary font-medium block mb-1.5"> Max Volume </label>
      <div class="flex items-center gap-2">
        <PhSpeakerX class="w-4 h-4 text-theme-text-tertiary shrink-0" />
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="boomboxVolume"
          class="w-full h-1.5 bg-theme-bg-tertiary rounded-full appearance-none cursor-pointer accent-theme-accent [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-theme-accent [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
          @input="
            $emit('update:boomboxVolume', parseFloat(($event.target as HTMLInputElement).value))
          " />
        <PhSpeakerHigh class="w-4 h-4 text-theme-text-tertiary shrink-0" />
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="audio/mpeg,audio/ogg"
      class="hidden"
      @change="handleFileSelected" />
  </div>
</template>

<script setup lang="ts">
import { debugWarn } from "@/utils/debug"
import { ref, onMounted, useTemplateRef } from "vue"
import { apiService } from "@/services/api"
import type { AudioFile } from "@/types"
import type { PlaylistEntry } from "@/composables/useBoombox"
import { PhSpeakerX, PhSpeakerHigh } from "@phosphor-icons/vue"

interface Props {
  isPlaying: boolean
  amIPlaying: boolean
  currentTrackId: string
  currentTrackName: string
  ownerNickname: string
  boomboxVolume: number
  playlist: PlaylistEntry[]
}

defineProps<Props>()

const emit = defineEmits<{
  play: [trackId: string, trackName: string, url: string]
  stop: []
  "update:boomboxVolume": [value: number]
  queue: [trackId: string, trackName: string]
  skip: []
}>()

const tracks = ref<AudioFile[]>([])
const selectedTrackId = ref("")
const fileInput = useTemplateRef<HTMLInputElement>("fileInput")
const uploadError = ref("")

onMounted(async () => {
  try {
    tracks.value = await apiService.getAudioFiles()
  } catch (e) {
    debugWarn("[BoomboxModal] Failed to load audio files:", e)
  }
})

const handlePlay = () => {
  const track = tracks.value.find((t) => t.id === selectedTrackId.value)
  if (!track) return
  const url = apiService.getAudioUrl(track.id)
  emit("play", track.id, track.display_name, url)
}

const handleQueue = () => {
  const track = tracks.value.find((t) => t.id === selectedTrackId.value)
  if (!track) return
  emit("queue", track.id, track.display_name)
}

const handleSkip = () => {
  emit("skip")
}

const handleStop = () => {
  emit("stop")
}

const handleUpload = () => {
  fileInput.value?.click()
}

const handleFileSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  uploadError.value = ""
  const name = file.name.replace(/\.(mp3|opus)$/i, "")

  try {
    const result = await apiService.uploadAudio(file, name)
    tracks.value.unshift({
      id: result.id,
      filename: `${result.id}.mp3`,
      display_name: result.display_name,
      uploaded_by: undefined,
      file_size: file.size,
      is_system: false,
      created_at: new Date().toISOString(),
    })
    selectedTrackId.value = result.id
  } catch (e) {
    uploadError.value = e instanceof Error ? e.message : "Upload failed"
    debugWarn("[BoomboxModal] Upload failed:", e)
  }

  input.value = ""
}
</script>
