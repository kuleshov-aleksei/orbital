<template>
  <div class="bg-gray-800 rounded-lg border border-gray-700">
    <div class="p-4 border-b border-gray-700 flex items-center justify-between">
      <h2 class="text-lg font-semibold text-white">Audio Files</h2>
      <div class="flex items-center gap-4">
        <span class="text-sm text-gray-400">{{ audioFiles.length }} files</span>
        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          :disabled="loadingAudio"
          @click="loadAudio">
          <span v-if="loadingAudio">Loading...</span>
          <span v-else>Refresh</span>
        </button>
      </div>
    </div>

    <div class="divide-y divide-gray-700">
      <div
        v-for="file in audioFiles"
        :key="file.id"
        class="p-4 flex items-center justify-between hover:bg-gray-700/50 transition-colors">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <template v-if="renamingAudioId === file.id">
              <input
                v-model="renameValue"
                type="text"
                class="bg-gray-700 text-white px-2 py-1 rounded text-sm border border-gray-600 focus:border-indigo-500 outline-none w-48"
                @keyup.enter="doRenameAudio(file.id)"
                @keyup.escape="renamingAudioId = null"
                @blur="doRenameAudio(file.id)" />
            </template>
            <span v-else class="font-medium text-white truncate">{{ file.display_name }}</span>
            <span
              v-if="file.is_system"
              class="text-xs px-2 py-0.5 bg-indigo-600/20 text-indigo-400 rounded"
              >System</span
            >
          </div>
          <div class="text-sm text-gray-400 flex items-center gap-2 mt-0.5">
            <span>{{ formatFileSize(file.file_size) }}</span>
            <span class="text-gray-600">•</span>
            <span>{{ formatDate(file.created_at) }}</span>
          </div>
        </div>

        <div class="flex items-center gap-2 ml-4 flex-shrink-0">
          <button
            v-if="!file.is_system && !renamingAudioId && deletingAudioId !== file.id"
            type="button"
            class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
            @click="startRename(file)">
            Rename
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50"
            :disabled="deletingAudioId === file.id"
            @click="confirmDeleteAudio(file.id)">
            <span v-if="deletingAudioId === file.id">Deleting...</span>
            <span v-else>Delete</span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="audioFiles.length === 0 && !loadingAudio" class="p-8 text-center">
      <PhMusicNote class="w-12 h-12 text-gray-600 mx-auto mb-4" />
      <p class="text-gray-400">No audio files found</p>
    </div>
  </div>

  <!-- Delete Audio Confirmation Modal -->
  <div
    v-if="showDeleteAudioModal"
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    @click.self="showDeleteAudioModal = false">
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4">
      <h3 class="text-lg font-semibold text-white mb-4">Delete Audio File</h3>
      <p class="text-gray-300 mb-6">
        Are you sure you want to delete this audio file? This action cannot be undone.
      </p>
      <div class="flex justify-end gap-3">
        <button
          type="button"
          class="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          @click="showDeleteAudioModal = false">
          Cancel
        </button>
        <button
          type="button"
          class="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
          @click="deleteAudioFile">
          Delete
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue"
import { apiService } from "@/services/api"
import type { AudioFile } from "@/types"
import { PhMusicNote } from "@phosphor-icons/vue"

const audioFiles = ref<AudioFile[]>([])
const loadingAudio = ref(false)
const renamingAudioId = ref<string | null>(null)
const renameValue = ref("")
const deletingAudioId = ref<string | null>(null)
const showDeleteAudioModal = ref(false)
const audioToDelete = ref<string | null>(null)

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const formatDate = (dateStr: string): string => {
  if (!dateStr) return ""
  return new Date(dateStr).toLocaleString()
}

const loadAudio = async () => {
  loadingAudio.value = true
  try {
    audioFiles.value = await apiService.getAudioFiles()
  } catch (error) {
    console.error("Failed to load audio files:", error)
  } finally {
    loadingAudio.value = false
  }
}

const startRename = (file: AudioFile) => {
  renamingAudioId.value = file.id
  renameValue.value = file.display_name
}

const doRenameAudio = async (id: string) => {
  const name = renameValue.value.trim()
  if (!name || renamingAudioId.value !== id) {
    renamingAudioId.value = null
    return
  }
  renamingAudioId.value = null
  try {
    await apiService.renameAudio(id, name)
    await loadAudio()
  } catch (error) {
    console.error("Failed to rename audio:", error)
  }
}

const confirmDeleteAudio = (id: string) => {
  audioToDelete.value = id
  showDeleteAudioModal.value = true
}

const deleteAudioFile = async () => {
  if (!audioToDelete.value) return
  deletingAudioId.value = audioToDelete.value
  showDeleteAudioModal.value = false
  try {
    await apiService.deleteAudio(audioToDelete.value)
    await loadAudio()
  } catch (error) {
    console.error("Failed to delete audio:", error)
  } finally {
    deletingAudioId.value = null
    audioToDelete.value = null
  }
}

onMounted(() => {
  void loadAudio()
})
</script>
