<template>
  <div class="bg-gray-800 rounded-lg border border-gray-700" data-testid="emoji-admin">
    <div class="p-4 border-b border-gray-700 flex items-center justify-between gap-4">
      <h2 class="text-lg font-semibold text-white">Custom Emojis</h2>
      <div class="flex items-center gap-3">
        <input
          v-model="query"
          type="text"
          placeholder="Search"
          class="bg-gray-700 text-white px-2 py-1 rounded text-sm border border-gray-600 focus:border-indigo-500 outline-none w-40" />
        <span class="text-sm text-gray-400 whitespace-nowrap">{{ emojis.length }} emojis</span>
        <button
          v-if="canUpload"
          type="button"
          class="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors flex items-center gap-1.5"
          @click="isUploadOpen = true">
          <PhPlus class="w-4 h-4" />
          Upload
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          :disabled="customEmojisStore.isLoading"
          @click="customEmojisStore.fetchEmojis()">
          {{ customEmojisStore.isLoading ? "Loading..." : "Refresh" }}
        </button>
      </div>
    </div>

    <p v-if="error" class="px-4 pt-3 text-sm text-red-400">{{ error }}</p>

    <div class="divide-y divide-gray-700">
      <div
        v-for="emoji in emojis"
        :key="emoji.id"
        class="p-4 hover:bg-gray-700/50 transition-colors">
        <!-- Edit mode -->
        <div v-if="editingId === emoji.id" class="space-y-2">
          <div class="flex items-center gap-2">
            <img :src="imageUrl(emoji)" :alt="emoji.name" class="w-8 h-8 object-contain shrink-0" />
            <input
              v-model="draft.name"
              type="text"
              maxlength="32"
              placeholder="Name"
              class="bg-gray-700 text-white px-2 py-1 rounded text-sm border border-gray-600 focus:border-indigo-500 outline-none flex-1"
              @keyup.enter="save(emoji.id)"
              @keyup.escape="cancelEdit" />
          </div>
          <input
            v-model="draft.aliases"
            type="text"
            placeholder="Aliases, comma separated"
            class="bg-gray-700 text-white px-2 py-1 rounded text-sm border border-gray-600 focus:border-indigo-500 outline-none w-full"
            @keyup.enter="save(emoji.id)"
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
              :disabled="busyId === emoji.id || !draft.name.trim()"
              @click="save(emoji.id)">
              {{ busyId === emoji.id ? "Saving..." : "Save" }}
            </button>
          </div>
        </div>

        <!-- View mode -->
        <div v-else class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3 min-w-0">
            <img :src="imageUrl(emoji)" :alt="emoji.name" class="w-8 h-8 object-contain shrink-0" />
            <div class="min-w-0">
              <div class="font-medium text-white truncate">{{ emoji.name }}</div>
              <div class="text-sm text-gray-400 truncate">
                <span v-if="emoji.aliases.length">{{ emoji.aliases.join(", ") }} · </span>
                {{ formatSize(emoji.file_size) }} · {{ uploaderName(emoji.uploaded_by) }} ·
                {{ new Date(emoji.created_at).toLocaleDateString() }}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <template v-if="confirmDeleteId === emoji.id">
              <span class="text-sm text-gray-300">Delete?</span>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                :disabled="busyId === emoji.id"
                @click="remove(emoji.id)">
                {{ busyId === emoji.id ? "Deleting..." : "Yes" }}
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
                @click="startEdit(emoji)">
                Edit
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded"
                @click="confirmDeleteId = emoji.id">
                Delete
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-if="emojis.length === 0 && !customEmojisStore.isLoading" class="p-8 text-center">
      <PhSmiley class="w-12 h-12 text-gray-600 mx-auto mb-4" />
      <p class="text-gray-400">
        {{ query ? "No emojis match your search" : "No custom emojis yet" }}
      </p>
    </div>

    <CustomEmojiUploadModal v-if="isUploadOpen" @close="isUploadOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import { PhPlus, PhSmiley } from "@phosphor-icons/vue"
import CustomEmojiUploadModal from "@/components/emoji/CustomEmojiUploadModal.vue"
import { useCustomEmojisStore, usePermissionsStore, useUsersStore } from "@/stores"
import { apiService } from "@/services/api"
import { Permission } from "@/types/permissions"
import type { CustomEmojiDto } from "@/types"

const customEmojisStore = useCustomEmojisStore()
const permissionsStore = usePermissionsStore()
const usersStore = useUsersStore()

const canUpload = computed(() => permissionsStore.can(Permission.UploadEmojis))

const query = ref("")
const emojis = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return customEmojisStore.emojis
  return customEmojisStore.emojis.filter(
    (e) => e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.includes(q)),
  )
})

const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const busyId = ref<string | null>(null)
const isUploadOpen = ref(false)
const error = ref<string | null>(null)
const draft = reactive({ name: "", aliases: "" })

const imageUrl = (emoji: CustomEmojiDto) => apiService.getCustomEmojiImageUrl(emoji)

const uploaderName = (id?: string) =>
  usersStore.allUsers.find((u) => u.id === id)?.nickname ?? "unknown"

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`

function startEdit(emoji: CustomEmojiDto) {
  editingId.value = emoji.id
  confirmDeleteId.value = null
  draft.name = emoji.name
  draft.aliases = emoji.aliases.join(", ")
}

function cancelEdit() {
  editingId.value = null
}

async function save(id: string) {
  if (busyId.value || !draft.name.trim()) return
  busyId.value = id
  error.value = null
  try {
    await customEmojisStore.update(id, {
      name: draft.name.trim(),
      aliases: draft.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    })
    cancelEdit()
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Failed to save emoji"
  } finally {
    busyId.value = null
  }
}

async function remove(id: string) {
  busyId.value = id
  error.value = null
  try {
    await customEmojisStore.remove(id)
    confirmDeleteId.value = null
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Failed to delete emoji"
  } finally {
    busyId.value = null
  }
}

onMounted(() => {
  void customEmojisStore.fetchEmojis()
  if (usersStore.allUsers.length === 0) void usersStore.fetchAllUsers()
})
</script>
