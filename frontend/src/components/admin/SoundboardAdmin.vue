<template>
  <div class="bg-gray-800 rounded-lg border border-gray-700" data-testid="soundboard-admin">
    <div class="p-4 border-b border-gray-700 flex items-center justify-between gap-4">
      <h2 class="text-lg font-semibold text-white">Soundboard</h2>
      <div class="flex items-center gap-3">
        <input
          v-model="query"
          type="text"
          placeholder="Search"
          class="bg-gray-700 text-white px-2 py-1 rounded text-sm border border-gray-600 focus:border-indigo-500 outline-none w-40" />
        <span class="text-sm text-gray-400 whitespace-nowrap">{{ sounds.length }} sounds</span>
        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          :disabled="soundboardStore.isLoading"
          @click="soundboardStore.fetchSounds()">
          {{ soundboardStore.isLoading ? "Loading..." : "Refresh" }}
        </button>
      </div>
    </div>

    <p v-if="error" class="px-4 pt-3 text-sm text-red-400">{{ error }}</p>

    <div class="divide-y divide-gray-700">
      <div
        v-for="sound in sounds"
        :key="sound.id"
        class="p-4 hover:bg-gray-700/50 transition-colors">
        <!-- Edit mode -->
        <div v-if="editingId === sound.id" class="space-y-2">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="h-8 w-8 shrink-0 rounded flex items-center justify-center bg-gray-700 hover:bg-gray-600"
              title="Pick an emoji"
              @click="isPickerOpen = !isPickerOpen">
              <EmojiGlyph v-if="draft.emoji" :emoji-ref="draft.emoji" :size="18" />
              <PhSmiley v-else class="w-4 h-4 text-gray-400" />
            </button>
            <input
              v-model="draft.name"
              type="text"
              maxlength="32"
              placeholder="Name"
              class="bg-gray-700 text-white px-2 py-1 rounded text-sm border border-gray-600 focus:border-indigo-500 outline-none flex-1"
              @keyup.enter="save(sound.id)"
              @keyup.escape="cancelEdit" />
            <button
              v-if="draft.emoji"
              type="button"
              class="text-xs text-gray-400 hover:text-white"
              @click="draft.emoji = ''">
              Clear emoji
            </button>
          </div>
          <EmojiPicker
            v-if="isPickerOpen"
            class="max-w-sm"
            @select="pickEmoji"
            @close="isPickerOpen = false" />
          <input
            v-model="draft.aliases"
            type="text"
            placeholder="Aliases, comma separated"
            class="bg-gray-700 text-white px-2 py-1 rounded text-sm border border-gray-600 focus:border-indigo-500 outline-none w-full"
            @keyup.enter="save(sound.id)"
            @keyup.escape="cancelEdit" />
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded"
              @click="cancelEdit">
              Cancel
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50"
              :disabled="busyId === sound.id || !draft.name.trim()"
              @click="save(sound.id)">
              {{ busyId === sound.id ? "Saving..." : "Save" }}
            </button>
          </div>
        </div>

        <!-- View mode -->
        <div v-else class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-8 text-center shrink-0">
              <EmojiGlyph v-if="sound.emoji" :emoji-ref="sound.emoji" :size="20" />
              <PhSpeakerHigh v-else class="w-5 h-5 text-gray-500 inline" />
            </span>
            <div class="min-w-0">
              <div class="font-medium text-white truncate">{{ sound.name }}</div>
              <div class="text-sm text-gray-400 truncate">
                <span v-if="sound.aliases.length">{{ sound.aliases.join(", ") }} · </span>
                {{ formatSize(sound.file_size) }} · {{ uploaderName(sound.uploaded_by) }} ·
                {{ new Date(sound.created_at).toLocaleDateString() }}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              class="h-8 w-8 flex items-center justify-center bg-gray-600 hover:bg-gray-500 text-white rounded"
              title="Preview (only you hear it)"
              @click="previewSoundboardSound(sound)">
              <PhPlay class="w-4 h-4" />
            </button>
            <template v-if="confirmDeleteId === sound.id">
              <span class="text-sm text-gray-300">Delete?</span>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                :disabled="busyId === sound.id"
                @click="remove(sound.id)">
                {{ busyId === sound.id ? "Deleting..." : "Yes" }}
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded"
                @click="confirmDeleteId = null">
                No
              </button>
            </template>
            <template v-else>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded"
                @click="startEdit(sound)">
                Edit
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded"
                @click="confirmDeleteId = sound.id">
                Delete
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-if="sounds.length === 0 && !soundboardStore.isLoading" class="p-8 text-center">
      <PhMusicNotes class="w-12 h-12 text-gray-600 mx-auto mb-4" />
      <p class="text-gray-400">
        {{ query ? "No sounds match your search" : "No soundboard sounds yet" }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import { PhMusicNotes, PhPlay, PhSmiley, PhSpeakerHigh } from "@phosphor-icons/vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import EmojiPicker from "@/components/EmojiPicker.vue"
import { useSoundboardStore, useUsersStore } from "@/stores"
import { previewSoundboardSound } from "@/services/soundboardPlayer"
import type { EmojiRef } from "@/services/emoji"
import type { SoundboardSound } from "@/types"

const soundboardStore = useSoundboardStore()
const usersStore = useUsersStore()

const query = ref("")
const sounds = computed(() => soundboardStore.search(query.value))

const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const busyId = ref<string | null>(null)
const isPickerOpen = ref(false)
const error = ref<string | null>(null)
const draft = reactive({ name: "", emoji: "" as EmojiRef, aliases: "" })

const uploaderName = (id?: string) =>
  usersStore.allUsers.find((u) => u.id === id)?.nickname ?? "unknown"

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`

function startEdit(sound: SoundboardSound) {
  editingId.value = sound.id
  confirmDeleteId.value = null
  isPickerOpen.value = false
  draft.name = sound.name
  draft.emoji = sound.emoji
  draft.aliases = sound.aliases.join(", ")
}

function cancelEdit() {
  editingId.value = null
  isPickerOpen.value = false
}

function pickEmoji(ref: EmojiRef) {
  draft.emoji = ref
  isPickerOpen.value = false
}

async function save(id: string) {
  if (busyId.value || !draft.name.trim()) return
  busyId.value = id
  error.value = null
  try {
    await soundboardStore.update(id, {
      name: draft.name.trim(),
      emoji: draft.emoji,
      aliases: draft.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    })
    cancelEdit()
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Failed to save sound"
  } finally {
    busyId.value = null
  }
}

async function remove(id: string) {
  busyId.value = id
  error.value = null
  try {
    await soundboardStore.remove(id)
    confirmDeleteId.value = null
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Failed to delete sound"
  } finally {
    busyId.value = null
  }
}

onMounted(() => {
  void soundboardStore.fetchSounds()
  if (usersStore.allUsers.length === 0) void usersStore.fetchAllUsers()
})
</script>
