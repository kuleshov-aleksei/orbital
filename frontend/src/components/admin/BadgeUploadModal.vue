<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-[80] p-4"
      @click.self="close"
      @keydown.esc="close">
      <div
        data-testid="badge-upload-modal"
        class="bg-theme-bg-secondary border border-theme-border rounded-lg p-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-theme-text-primary">New badge</h2>
          <button
            type="button"
            class="text-theme-text-muted hover:text-theme-text-primary"
            title="Close"
            @click="close">
            <PhX class="w-5 h-5" />
          </button>
        </div>

        <form class="space-y-4" @submit.prevent="submit">
          <div>
            <label class="text-xs font-medium text-theme-text-secondary block mb-1.5">Image</label>
            <input
              ref="fileInput"
              type="file"
              :accept="ACCEPTED_TYPES.join(',')"
              class="hidden"
              data-testid="badge-file"
              @change="onFileChange" />
            <div class="flex items-center gap-3">
              <div
                class="h-20 w-20 shrink-0 rounded-lg bg-theme-bg-tertiary border border-theme-border flex items-center justify-center">
                <img
                  v-if="previewUrl"
                  :src="previewUrl"
                  alt="Preview"
                  class="max-h-16 max-w-16 object-contain" />
                <PhImage v-else class="w-7 h-7 text-theme-text-muted" />
              </div>
              <div class="min-w-0">
                <button
                  type="button"
                  class="px-3 py-1.5 text-sm rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary disabled:opacity-50"
                  :disabled="isUploading"
                  @click="fileInput?.click()">
                  {{ file ? "Choose another" : "Choose image" }}
                </button>
                <p class="mt-1 text-[11px] text-theme-text-muted">
                  <template v-if="file">
                    {{ file.name }} · {{ formatSize(file.size) }} ·
                    <button
                      type="button"
                      class="underline hover:text-theme-text-primary"
                      :disabled="isUploading"
                      @click="clearFile">
                      remove
                    </button>
                  </template>
                  <template v-else>
                    PNG, GIF or WebP up to {{ MAX_UPLOAD_KB }} KB. Scaled to fit
                    {{ MAX_DIMENSION }}×{{ MAX_DIMENSION }}.
                  </template>
                </p>
              </div>
            </div>
          </div>

          <div>
            <label
              class="text-xs font-medium text-theme-text-secondary block mb-1.5"
              for="badge-name">
              Name
            </label>
            <input
              id="badge-name"
              v-model="name"
              type="text"
              :maxlength="MAX_NAME"
              placeholder="Night Owl"
              data-testid="badge-name"
              class="w-full px-2 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border rounded focus:outline-none focus:border-theme-accent text-theme-text-primary" />
            <p class="mt-1 text-[11px] text-theme-text-muted">
              {{ nameChars }} / {{ MAX_NAME }} — names are unique.
            </p>
          </div>

          <div>
            <label
              class="text-xs font-medium text-theme-text-secondary block mb-1.5"
              for="badge-description">
              Description
            </label>
            <textarea
              id="badge-description"
              v-model="description"
              :maxlength="MAX_DESCRIPTION"
              rows="3"
              placeholder="What it was awarded for"
              data-testid="badge-description"
              class="w-full px-2 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border rounded focus:outline-none focus:border-theme-accent text-theme-text-primary resize-none" />
            <p class="mt-1 text-[11px] text-theme-text-muted">
              {{ descriptionChars }} / {{ MAX_DESCRIPTION }}
            </p>
          </div>

          <p v-if="error" class="text-sm text-red-400" data-testid="badge-upload-error">
            {{ error }}
          </p>

          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary disabled:opacity-50"
              :disabled="isUploading"
              @click="close">
              Cancel
            </button>
            <button
              type="submit"
              class="px-3 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
              :disabled="!canSubmit"
              data-testid="badge-upload-submit">
              {{ isUploading ? "Uploading…" : "Upload" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, useTemplateRef } from "vue"
import { PhImage, PhX } from "@phosphor-icons/vue"
import { useBadgesStore } from "@/stores"

const emit = defineEmits<{ close: [] }>()

// Keep in sync with backend/internal/service/badgeservice.go.
const MAX_UPLOAD_KB = 512
const MAX_UPLOAD_BYTES = MAX_UPLOAD_KB * 1024
const MAX_DIMENSION = 256
const MAX_NAME = 48
const MAX_DESCRIPTION = 200
const ACCEPTED_TYPES = ["image/png", "image/gif", "image/webp"]

const badgesStore = useBadgesStore()

const fileInput = useTemplateRef<HTMLInputElement>("fileInput")
const file = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const name = ref("")
const description = ref("")
const error = ref<string | null>(null)
const isUploading = ref(false)

const nameChars = computed(() => Array.from(name.value).length)
const descriptionChars = computed(() => Array.from(description.value).length)

const canSubmit = computed(() => !!file.value && name.value.trim() !== "" && !isUploading.value)

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`

function revokePreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
}

function clearFile() {
  revokePreview()
  file.value = null
  if (fileInput.value) fileInput.value.value = ""
}

function pick(selected: File) {
  error.value = null
  if (!ACCEPTED_TYPES.includes(selected.type)) {
    error.value = "Only PNG, GIF and WebP images are supported."
    return
  }
  if (selected.size > MAX_UPLOAD_BYTES) {
    error.value = `Image is too large (max ${MAX_UPLOAD_KB} KB).`
    return
  }
  clearFile()
  file.value = selected
  previewUrl.value = URL.createObjectURL(selected)
  if (!name.value.trim()) {
    name.value = selected.name
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NAME)
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0]
  input.value = ""
  if (selected) pick(selected)
}

async function submit() {
  if (!canSubmit.value || !file.value) return
  isUploading.value = true
  error.value = null
  try {
    await badgesStore.upload({
      file: file.value,
      name: name.value.trim(),
      description: description.value.trim(),
    })
    emit("close")
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Failed to upload badge"
  } finally {
    isUploading.value = false
  }
}

function close() {
  if (isUploading.value) return
  emit("close")
}

onUnmounted(revokePreview)
</script>
