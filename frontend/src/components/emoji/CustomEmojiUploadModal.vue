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
          <h2 class="text-lg font-semibold text-theme-text-primary">
            {{ isBatch ? `Upload ${items.length} emojis` : "Upload an emoji" }}
          </h2>
          <button
            type="button"
            class="text-theme-text-muted hover:text-theme-text-primary"
            title="Close"
            @click="close">
            <PhX class="w-5 h-5" />
          </button>
        </div>

        <form class="space-y-4" @submit.prevent="submit">
          <!-- Image(s) -->
          <div>
            <label class="text-xs font-medium text-theme-text-secondary block mb-1.5">
              {{ isBatch ? "Images" : "Image" }}
            </label>
            <input
              ref="fileInput"
              type="file"
              multiple
              :accept="ACCEPTED_TYPES.join(',')"
              class="hidden"
              data-testid="custom-emoji-file"
              @change="onFileChange" />
            <div
              class="flex items-center gap-3 rounded border border-dashed p-2 -m-2 transition-colors"
              :class="
                isDragOver ? 'border-theme-accent bg-theme-bg-tertiary' : 'border-transparent'
              "
              @dragover.prevent="isDragOver = true"
              @dragleave.prevent="isDragOver = false"
              @drop.prevent="onDrop">
              <div
                v-if="!isBatch"
                class="h-14 w-14 shrink-0 rounded bg-theme-bg-tertiary border border-theme-border flex items-center justify-center">
                <img
                  v-if="single?.previewUrl"
                  :src="single.previewUrl"
                  alt="Preview"
                  class="max-h-12 max-w-12 object-contain" />
                <PhImage v-else class="w-6 h-6 text-theme-text-muted" />
              </div>
              <div class="min-w-0">
                <button
                  type="button"
                  class="px-3 py-1.5 text-sm rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary disabled:opacity-50"
                  :disabled="isUploading"
                  @click="fileInput?.click()">
                  {{ items.length ? "Add images" : "Choose images" }}
                </button>
                <p class="mt-1 text-[11px] text-theme-text-muted truncate">
                  <template v-if="single">
                    {{ single.file.name }} · {{ formatSize(single.file.size) }} ·
                    <button
                      type="button"
                      class="underline hover:text-theme-text-primary"
                      :disabled="isUploading"
                      @click="removeItem(single)">
                      remove
                    </button>
                  </template>
                  <template v-else>
                    PNG, GIF or WebP (animated OK) up to {{ MAX_UPLOAD_KB }} KB. Scaled to fit
                    {{ MAX_DIMENSION }}×{{ MAX_DIMENSION }}. Select or drop several to upload in
                    bulk.
                  </template>
                </p>
              </div>
            </div>
          </div>

          <!-- Single file: name + aliases -->
          <template v-if="single">
            <div>
              <label class="text-xs font-medium text-theme-text-secondary block mb-1.5">Name</label>
              <input
                v-model="single.name"
                type="text"
                :maxlength="MAX_NAME"
                placeholder="Party parrot"
                data-testid="custom-emoji-name"
                class="w-full px-2 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border rounded focus:outline-none focus:border-theme-accent text-theme-text-primary" />
            </div>

            <div>
              <label class="text-xs font-medium text-theme-text-secondary block mb-1.5">
                Aliases
                <span class="text-theme-text-muted font-normal">(optional, for search)</span>
              </label>
              <AliasInput
                ref="aliasInput"
                v-model="aliases"
                :max="MAX_ALIASES"
                :max-length="MAX_NAME"
                placeholder="parrot, party" />
            </div>
          </template>

          <!-- Batch: one row per file, named after the file -->
          <ul
            v-else-if="isBatch"
            class="space-y-1.5 max-h-80 overflow-y-auto pr-1"
            data-testid="custom-emoji-batch-list">
            <li
              v-for="item in items"
              :key="item.id"
              class="flex items-center gap-2 rounded bg-theme-bg-tertiary/60 px-2 py-1.5">
              <div class="h-8 w-8 shrink-0 flex items-center justify-center">
                <img
                  v-if="item.previewUrl"
                  :src="item.previewUrl"
                  :alt="item.name"
                  class="max-h-8 max-w-8 object-contain" />
                <PhImage v-else class="w-5 h-5 text-theme-text-muted" />
              </div>
              <div class="min-w-0 flex-1">
                <input
                  v-model="item.name"
                  type="text"
                  :maxlength="MAX_NAME"
                  :disabled="!item.valid || isUploading"
                  :title="item.file.name"
                  class="w-full px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded focus:outline-none focus:border-theme-accent text-theme-text-primary disabled:opacity-60" />
                <p v-if="item.error" class="mt-0.5 text-[11px] text-red-400 truncate">
                  {{ item.error }}
                </p>
              </div>
              <div class="w-5 shrink-0 flex justify-center">
                <PhSpinner
                  v-if="item.status === 'uploading'"
                  class="w-4 h-4 animate-spin text-theme-text-muted" />
                <PhWarningCircle v-else-if="item.status === 'error'" class="w-4 h-4 text-red-400" />
                <button
                  v-else
                  type="button"
                  class="text-theme-text-muted hover:text-theme-text-primary disabled:opacity-50"
                  title="Remove"
                  :disabled="isUploading"
                  @click="removeItem(item)">
                  <PhX class="w-4 h-4" />
                </button>
              </div>
            </li>
          </ul>

          <p v-if="isBatch && overLimit" class="text-xs text-amber-400">
            Only {{ remainingSlots }} of {{ uploadable.length }} will fit: the library holds up to
            {{ MAX_CUSTOM_EMOJIS }} emojis.
          </p>
          <p v-if="uploadedCount > 0" class="text-sm text-theme-text-secondary">
            Uploaded {{ uploadedCount }}. Fix the remaining ones and try again.
          </p>
          <p v-if="error || single?.error" class="text-sm text-red-400">
            {{ error || single?.error }}
          </p>

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
              {{ submitLabel }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef } from "vue"
import { PhImage, PhSpinner, PhWarningCircle, PhX } from "@phosphor-icons/vue"
import AliasInput from "@/components/common/AliasInput.vue"
import { useCustomEmojisStore } from "@/stores"

const emit = defineEmits<{ close: [] }>()
// Keep in sync with backend/internal/service/emojiservice.go.
const MAX_UPLOAD_KB = 256
const MAX_UPLOAD_BYTES = MAX_UPLOAD_KB * 1024
const MAX_DIMENSION = 128
const MAX_NAME = 32
const MAX_ALIASES = 10
const MAX_CUSTOM_EMOJIS = 200
const ACCEPTED_TYPES = ["image/png", "image/gif", "image/webp"]

interface UploadItem {
  id: number
  file: File
  previewUrl: string | null
  name: string
  /** False when the file failed local checks; it is listed but never uploaded. */
  valid: boolean
  status: "pending" | "uploading" | "error"
  error: string | null
}

const customEmojisStore = useCustomEmojisStore()

const fileInput = useTemplateRef<HTMLInputElement>("fileInput")
const aliasInput = useTemplateRef<InstanceType<typeof AliasInput>>("aliasInput")
const items = ref<UploadItem[]>([])
const aliases = ref<string[]>([])
const error = ref<string | null>(null)
const isUploading = ref(false)
const isDragOver = ref(false)
const uploadedCount = ref(0)
const progress = ref(0)
let nextId = 0

const isBatch = computed(() => items.value.length > 1)
const single = computed(() => (items.value.length === 1 ? items.value[0] : null))
const uploadable = computed(() => items.value.filter((i) => i.valid))
const remainingSlots = computed(() =>
  Math.max(0, MAX_CUSTOM_EMOJIS - customEmojisStore.emojis.length),
)
const overLimit = computed(
  () => customEmojisStore.isLoaded && uploadable.value.length > remainingSlots.value,
)

const canSubmit = computed(
  () =>
    !isUploading.value &&
    uploadable.value.length > 0 &&
    uploadable.value.every((i) => i.name.trim() !== ""),
)

const submitLabel = computed(() => {
  if (isUploading.value) {
    return isBatch.value ? `Uploading ${progress.value}/${uploadable.value.length}…` : "Uploading…"
  }
  return uploadable.value.length > 1 ? `Upload ${uploadable.value.length}` : "Upload"
})

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`

/** "party_parrot.webp" -> "party parrot", cut to MAX_NAME characters (code points, as the backend counts). */
function nameFromFile(filename: string): string {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return Array.from(base).slice(0, MAX_NAME).join("").trim()
}

function checkFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return "Only PNG, GIF and WebP images are supported."
  if (file.size > MAX_UPLOAD_BYTES) return `Image is too large (max ${MAX_UPLOAD_KB} KB).`
  return null
}

function addFiles(files: File[]) {
  if (!files.length || isUploading.value) return
  error.value = null
  uploadedCount.value = 0
  for (const file of files) {
    const problem = checkFile(file)
    items.value.push({
      id: nextId++,
      file,
      previewUrl: problem ? null : URL.createObjectURL(file),
      name: nameFromFile(file.name),
      valid: !problem,
      status: problem ? "error" : "pending",
      error: problem,
    })
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  input.value = ""
  addFiles(picked)
}

function onDrop(event: DragEvent) {
  isDragOver.value = false
  addFiles(Array.from(event.dataTransfer?.files ?? []))
}

function revoke(item: UploadItem) {
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  item.previewUrl = null
}

function removeItem(item: UploadItem) {
  revoke(item)
  items.value = items.value.filter((i) => i.id !== item.id)
}

async function submit() {
  aliasInput.value?.commit()
  if (!canSubmit.value) return
  isUploading.value = true
  error.value = null
  progress.value = 0
  // Aliases only apply to a single upload; batch uploads are name-only.
  const batchAliases = isBatch.value ? [] : aliases.value
  const queue = [...uploadable.value]
  let uploaded = 0
  try {
    for (const item of queue) {
      progress.value++
      item.status = "uploading"
      item.error = null
      try {
        await customEmojisStore.upload(
          { file: item.file, name: item.name.trim(), aliases: batchAliases },
          { refresh: false },
        )
        uploaded++
        removeItem(item)
      } catch (err) {
        item.status = "error"
        item.error = err instanceof Error && err.message ? err.message : "Upload failed"
      }
    }
  } finally {
    isUploading.value = false
    if (uploaded > 0) await customEmojisStore.fetchEmojis()
  }
  uploadedCount.value += uploaded
  // Failed items stay listed with their error so they can be renamed and retried.
  for (const item of items.value) if (item.valid && item.status === "error") item.status = "pending"
  if (items.value.length === 0) close()
}

function clearPreviews() {
  for (const item of items.value) revoke(item)
}

function close() {
  clearPreviews()
  emit("close")
}

onMounted(() => void customEmojisStore.ensureLoaded())
onUnmounted(clearPreviews)
</script>
