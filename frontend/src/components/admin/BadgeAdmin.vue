<template>
  <div class="bg-gray-800 rounded-lg border border-gray-700" data-testid="badge-admin">
    <div class="p-4 border-b border-gray-700 flex items-center justify-between gap-4">
      <h2 class="text-lg font-semibold text-white">Badges</h2>
      <div class="flex items-center gap-3">
        <span class="text-sm text-gray-400 whitespace-nowrap">
          {{ badgesStore.definitions.length }} badges
        </span>
        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors flex items-center gap-1.5"
          data-testid="badge-admin-upload"
          @click="isUploadOpen = true">
          <PhPlus class="w-4 h-4" />
          New badge
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          :disabled="badgesStore.isLoading"
          @click="reload">
          {{ badgesStore.isLoading ? "Loading..." : "Refresh" }}
        </button>
      </div>
    </div>

    <p v-if="error" class="px-4 pt-3 text-sm text-red-400" data-testid="badge-admin-error">
      {{ error }}
    </p>

    <div class="divide-y divide-gray-700">
      <div
        v-for="badge in badgesStore.allBadges"
        :key="badge.id"
        class="p-4 hover:bg-gray-700/50 transition-colors"
        :data-testid="`badge-row-${badge.id}`">
        <!-- Edit mode -->
        <div v-if="editingId === badge.id" class="space-y-2">
          <div class="flex items-center gap-3">
            <BadgeIcon :badge="badge" :size="32" />
            <input
              v-model="draft.name"
              type="text"
              :maxlength="MAX_NAME"
              placeholder="Name"
              class="bg-gray-700 text-white px-2 py-1 rounded text-sm border border-gray-600 focus:border-indigo-500 outline-none flex-1"
              data-testid="badge-edit-name"
              @keyup.enter="save(badge)"
              @keyup.escape="cancelEdit" />
          </div>
          <textarea
            v-model="draft.description"
            :maxlength="MAX_DESCRIPTION"
            rows="2"
            placeholder="Description"
            class="w-full bg-gray-700 text-white px-2 py-1 rounded text-sm border border-gray-600 focus:border-indigo-500 outline-none resize-none"
            data-testid="badge-edit-description"
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
              :disabled="busyId === badge.id || !draft.name.trim()"
              data-testid="badge-edit-save"
              @click="save(badge)">
              {{ busyId === badge.id ? "Saving..." : "Save" }}
            </button>
          </div>
        </div>

        <!-- View mode -->
        <div v-else class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3 min-w-0">
            <BadgeIcon :badge="badge" :size="40" class="shrink-0" />
            <div class="min-w-0">
              <div class="font-medium text-white truncate">{{ badge.name }}</div>
              <div class="text-sm text-gray-400 break-words">
                {{ badge.description || "No description" }}
              </div>
              <div class="text-xs text-gray-500">
                {{ holderCount(badge.id) }}
                {{ holderCount(badge.id) === 1 ? "holder" : "holders" }} ·
                {{ formatSize(badgeSize(badge.id)) }}
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <template v-if="confirmDeleteId === badge.id">
              <span class="text-sm text-gray-300">Delete for everyone?</span>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                :disabled="busyId === badge.id"
                data-testid="badge-delete-confirm"
                @click="remove(badge.id)">
                {{ busyId === badge.id ? "Deleting..." : "Yes" }}
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
                data-testid="badge-award"
                @click="awarding = badge">
                Award
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded"
                @click="startEdit(badge)">
                Edit
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded disabled:opacity-50"
                :disabled="busyId === badge.id"
                @click="pickImage(badge.id)">
                {{ busyId === badge.id ? "Uploading..." : "Image" }}
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded"
                data-testid="badge-delete"
                @click="confirmDeleteId = badge.id">
                Delete
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="!badgesStore.definitions.length && !badgesStore.isLoading"
      class="p-8 text-center"
      data-testid="badge-admin-empty">
      <PhMedal class="w-12 h-12 text-gray-600 mx-auto mb-4" />
      <p class="text-gray-400">No badges yet — upload one and award it to a member.</p>
    </div>

    <input
      ref="imageInput"
      type="file"
      accept="image/png,image/gif,image/webp"
      class="hidden"
      @change="onImagePicked" />

    <BadgeUploadModal v-if="isUploadOpen" @close="isUploadOpen = false" />
    <BadgeAssignModal v-if="awarding" :badge="awarding" @close="awarding = null" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, useTemplateRef } from "vue"
import { PhMedal, PhPlus } from "@phosphor-icons/vue"
import BadgeIcon from "@/components/badges/BadgeIcon.vue"
import BadgeUploadModal from "@/components/admin/BadgeUploadModal.vue"
import BadgeAssignModal from "@/components/admin/BadgeAssignModal.vue"
import { useBadgesStore, useUsersStore, type Badge } from "@/stores"

// Keep in sync with backend/internal/service/badgeservice.go.
const MAX_NAME = 48
const MAX_DESCRIPTION = 200
const MAX_IMAGE_BYTES = 512 * 1024

const badgesStore = useBadgesStore()
const usersStore = useUsersStore()

const isUploadOpen = ref(false)
const awarding = ref<Badge | null>(null)
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)
const busyId = ref<string | null>(null)
const error = ref<string | null>(null)
const draft = reactive({ name: "", description: "" })

const imageInput = useTemplateRef<HTMLInputElement>("imageInput")
let pendingImageId: string | null = null

const holderCount = (badgeId: string) => badgesStore.holderIDs(badgeId).length

const badgeSize = (badgeId: string) => {
  const dto = badgesStore.definitions.find((b) => b.id === badgeId)
  return dto?.file_size ?? 0
}

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`

function reload() {
  error.value = null
  void badgesStore.load()
}

function startEdit(badge: Badge) {
  editingId.value = badge.id
  confirmDeleteId.value = null
  draft.name = badge.name
  draft.description = badge.description
}

function cancelEdit() {
  editingId.value = null
}

async function save(badge: Badge) {
  if (busyId.value || !draft.name.trim()) return
  busyId.value = badge.id
  error.value = null
  try {
    await badgesStore.update(badge.id, {
      name: draft.name.trim(),
      description: draft.description.trim(),
    })
    editingId.value = null
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Failed to save badge"
  } finally {
    busyId.value = null
  }
}

async function remove(id: string) {
  busyId.value = id
  error.value = null
  try {
    await badgesStore.remove(id)
    confirmDeleteId.value = null
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Failed to delete badge"
  } finally {
    busyId.value = null
  }
}

function pickImage(id: string) {
  pendingImageId = id
  imageInput.value?.click()
}

async function onImagePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  const id = pendingImageId
  pendingImageId = null
  if (!file || !id) return
  if (!["image/png", "image/gif", "image/webp"].includes(file.type)) {
    error.value = "Only PNG, GIF and WebP images are supported."
    return
  }
  if (file.size > MAX_IMAGE_BYTES) {
    error.value = "Image is too large (max 512 KB)."
    return
  }
  busyId.value = id
  error.value = null
  try {
    await badgesStore.replaceImage(id, file)
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Failed to replace image"
  } finally {
    busyId.value = null
  }
}

onMounted(() => {
  void badgesStore.ensureLoaded()
  if (usersStore.allUsers.length === 0) void usersStore.fetchAllUsers()
})
</script>
