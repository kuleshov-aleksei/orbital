<template>
  <div class="absolute bottom-4 right-4 z-50 bg-theme-bg-secondary rounded-xl border border-theme-border shadow-2xl p-5 min-w-80 max-w-sm">
    <!-- No one playing -->
    <template v-if="!isPlaying">
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
          <div v-if="track.is_system" class="text-xs text-theme-text-tertiary mt-0.5">System track</div>
        </button>
      </div>

      <div class="flex gap-2">
        <button
          type="button"
          class="flex-1 px-3 py-2 bg-theme-accent hover:bg-theme-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          :disabled="!selectedTrackId"
          @click="handlePlay">
          Play
        </button>
        <button
          type="button"
          class="px-3 py-2 bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary rounded-lg text-sm transition-colors"
          @click="handleUpload">
          Upload
        </button>
      </div>
    </template>

    <!-- I am playing -->
    <template v-else-if="amIPlaying">
      <h3 class="text-lg font-semibold text-theme-text-primary mb-2">Boombox</h3>
      <p class="text-sm text-theme-text-secondary mb-1">Now playing:</p>
      <p class="text-base font-medium text-theme-text-primary mb-3">{{ currentTrackName || currentTrackId }}</p>
      <button
        type="button"
        class="w-full px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
        @click="handleStop">
        Stop
      </button>
    </template>

    <!-- Someone else is playing -->
    <template v-else>
      <h3 class="text-lg font-semibold text-theme-text-primary mb-1">Boombox</h3>
      <p class="text-sm text-theme-text-secondary">
        <span class="font-medium text-theme-text-primary">{{ ownerNickname }}</span> is playing
      </p>
      <p class="text-sm text-theme-text-secondary">
        {{ currentTrackName || currentTrackId }}
      </p>
    </template>

    <input
      ref="fileInput"
      type="file"
      accept="audio/mpeg,audio/ogg"
      class="hidden"
      @change="handleFileSelected" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue"
import { apiService, resolveUrl } from "@/services/api"
import type { AudioFile } from "@/types"

interface Props {
  isPlaying: boolean
  amIPlaying: boolean
  currentTrackId: string
  currentTrackName: string
  ownerNickname: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  play: [trackId: string, trackName: string, url: string]
  stop: []
}>()

const tracks = ref<AudioFile[]>([])
const selectedTrackId = ref("")
const fileInput = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  try {
    tracks.value = await apiService.getAudioFiles()
  } catch (e) {
    console.warn("[BoomboxModal] Failed to load audio files:", e)
  }
})

const handlePlay = () => {
  const track = tracks.value.find((t) => t.id === selectedTrackId.value)
  if (!track) return
  const url = apiService.getAudioUrl(track.id)
  emit("play", track.id, track.display_name, url)
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
    console.warn("[BoomboxModal] Upload failed:", e)
  }

  input.value = ""
}
</script>
