<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-[60] p-4"
      @click.self="close"
      @keydown.esc="close">
      <div
        data-testid="custom-emoji-upload-modal"
        class="bg-theme-bg-secondary border border-theme-border rounded-lg p-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-theme-text-primary">Upload an emoji</h2>
          <button
            type="button"
            class="text-theme-text-muted hover:text-theme-text-primary"
            title="Close"
            @click="close">
            <PhX class="w-5 h-5" />
          </button>
        </div>

        <form class="space-y-4" @submit.prevent="submit">
          <!-- Image -->
          <div>
            <label class="text-xs font-medium text-theme-text-secondary block mb-1.5">Image</label>
            <input
              ref="fileInput"
              type="file"
              accept="image/png"
              class="hidden"
              data-testid="custom-emoji-file"
              @change="onFileChange" />
            <div class="flex items-center gap-3">
              <div
                class="h-14 w-14 shrink-0 rounded bg-theme-bg-tertiary border border-theme-border flex items-center justify-center">
                <img
                  v-if="previewUrl"
                  :src="previewUrl"
                  alt="Preview"
                  class="max-h-12 max-w-12 object-contain" />
                <PhImage v-else class="w-6 h-6 text-theme-text-muted" />
              </div>
              <div class="min-w-0">
                <button
                  type="button"
                  class="px-3 py-1.5 text-sm rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
                  @click="fileInput?.click()">
                  {{ file ? "Change image" : "Choose image" }}
                </button>
                <p class="mt-1 text-[11px] text-theme-text-muted truncate">
                  <template v-if="file">{{ file.name }} · {{ formatSize(file.size) }}</template>
                  <template v-else>
                    PNG up to {{ MAX_UPLOAD_KB }} KB. Scaled to fit {{ MAX_DIMENSION }}×{{
                      MAX_DIMENSION
                    }}.
                  </template>
                </p>
              </div>
            </div>
          </div>

          <!-- Name -->
          <div>
            <label class="text-xs font-medium text-theme-text-secondary block mb-1.5">Name</label>
            <input
              v-model="name"
              type="text"
              :maxlength="MAX_NAME"
              placeholder="Party parrot"
              data-testid="custom-emoji-name"
              class="w-full px-2 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border rounded focus:outline-none focus:border-theme-accent text-theme-text-primary" />
          </div>

          <!-- Aliases -->
          <div>
            <label class="text-xs font-medium text-theme-text-secondary block mb-1.5">
              Aliases <span class="text-theme-text-muted font-normal">(optional, for search)</span>
            </label>
            <AliasInput
              ref="aliasInput"
              v-model="aliases"
              :max="MAX_ALIASES"
              :max-length="MAX_NAME"
              placeholder="parrot, party" />
          </div>

          <p v-if="error" class="text-sm text-red-400">{{ error }}</p>

          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              class="px-4 py-2 text-sm rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
              @click="close">
              Cancel
            </button>
            <button
              type="submit"
              class="px-4 py-2 text-sm rounded bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="!canSubmit"
              data-testid="custom-emoji-submit">
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
import AliasInput from "@/components/common/AliasInput.vue"
import { useCustomEmojisStore } from "@/stores"

const emit = defineEmits<{ close: [] }>()
// Keep in sync with backend/internal/service/emojiservice.go.
const MAX_UPLOAD_KB = 256
const MAX_UPLOAD_BYTES = MAX_UPLOAD_KB * 1024
const MAX_DIMENSION = 128
const MAX_NAME = 32
const MAX_ALIASES = 10

const customEmojisStore = useCustomEmojisStore()

const fileInput = useTemplateRef<HTMLInputElement>("fileInput")
const aliasInput = useTemplateRef<InstanceType<typeof AliasInput>>("aliasInput")
const file = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const name = ref("")
const aliases = ref<string[]>([])
const error = ref<string | null>(null)
const isUploading = ref(false)

const canSubmit = computed(() => !!file.value && name.value.trim() !== "" && !isUploading.value)

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`

function clearPreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  input.value = ""
  if (!picked) return
  error.value = null
  if (picked.type !== "image/png") {
    error.value = "Only PNG images are supported."
    return
  }
  if (picked.size > MAX_UPLOAD_BYTES) {
    error.value = `Image is too large (max ${MAX_UPLOAD_KB} KB).`
    return
  }
  clearPreview()
  file.value = picked
  previewUrl.value = URL.createObjectURL(picked)
  // Default the name to the file name, as a starting point.
  if (!name.value.trim()) {
    name.value = picked.name
      .replace(/\.png$/i, "")
      .replace(/[_-]+/g, " ")
      .trim()
      .slice(0, MAX_NAME)
  }
}

async function submit() {
  aliasInput.value?.commit()
  if (!canSubmit.value || !file.value) return
  isUploading.value = true
  error.value = null
  try {
    await customEmojisStore.upload({
      file: file.value,
      name: name.value.trim(),
      aliases: aliases.value,
    })
    close()
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Upload failed"
  } finally {
    isUploading.value = false
  }
}

function close() {
  clearPreview()
  emit("close")
}

onUnmounted(clearPreview)
</script>
