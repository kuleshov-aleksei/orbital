<template>
  <div
    class="modal-overlay fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    @click.self="$emit('close')">
    <div class="modal-content bg-gray-800 rounded-lg p-6 w-full max-w-2xl">
      <!-- Modal Header -->
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold text-white">Edit Profile Picture</h2>

        <button
          type="button"
          class="text-gray-400 hover:text-white transition-colors duration-200"
          @click="$emit('close')">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Cropper Container -->
      <div class="flex flex-col md:flex-row gap-6">
        <!-- Cropper -->
        <div class="flex-1">
          <div class="cropper-wrapper bg-gray-900 rounded-lg overflow-hidden">
            <Cropper
              ref="cropperRef"
              class="cropper"
              :src="imageSrc"
              :stencil-props="{
                aspectRatio: 1,
                movable: true,
                resizable: true,
              }"
              stencil-component="circle-stencil"
              :min-width="128"
              :min-height="128"
              image-restriction="stencil"
              @ready="onReady"
              @change="updatePreview"
              @error="onError" />
          </div>

          <!-- Zoom Controls -->
          <div class="flex items-center justify-center gap-4 mt-4">
            <button
              type="button"
              class="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
              title="Zoom Out"
              @click="zoomOut">
              <PhMagnifyingGlassMinus class="w-5 h-5" />
            </button>

            <button
              type="button"
              class="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
              title="Zoom In"
              @click="zoomIn">
              <PhMagnifyingGlassPlus class="w-5 h-5" />
            </button>

            <button
              type="button"
              class="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
              title="Reset"
              @click="reset">
              <PhArrowCounterClockwise class="w-5 h-5" />
            </button>
          </div>
        </div>

        <!-- Preview -->
        <div class="flex flex-col items-center gap-4">
          <div class="text-sm text-gray-400 mb-2">Preview</div>

          <!-- Large Preview -->
          <div class="w-32 h-32 rounded-full overflow-hidden bg-gray-700 ring-2 ring-gray-600">
            <img
              v-if="previewSrc"
              :src="previewSrc"
              alt="Preview"
              class="w-full h-full object-cover" />
          </div>

          <!-- Small Preview (size it will appear in UI) -->
          <div class="w-12 h-12 rounded-full overflow-hidden bg-gray-700 ring-2 ring-gray-600">
            <img
              v-if="previewSrc"
              :src="previewSrc"
              alt="Preview small"
              class="w-full h-full object-cover" />
          </div>

          <div class="text-xs text-gray-500 text-center">Final image: 512x512px</div>
        </div>
      </div>

      <!-- Error Message -->
      <div v-if="error" class="mt-4 text-sm text-red-400 text-center">
        {{ error }}
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-end gap-3 mt-6">
        <button
          type="button"
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors duration-200"
          @click="$emit('close')">
          Cancel
        </button>

        <button
          type="button"
          :disabled="isUploading || !isReady"
          class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors duration-200 flex items-center gap-2"
          @click="handleUpload">
          <PhSpinner v-if="isUploading" class="w-4 h-4 animate-spin" />

          <PhUploadSimple v-else class="w-4 h-4" />
          {{ isUploading ? "Uploading..." : "Upload" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, useTemplateRef } from "vue"
import { Cropper } from "vue-advanced-cropper"
import {
  PhMagnifyingGlassPlus,
  PhMagnifyingGlassMinus,
  PhArrowCounterClockwise,
  PhUploadSimple,
  PhSpinner,
} from "@phosphor-icons/vue"
import "vue-advanced-cropper/dist/style.css"

interface Props {
  imageSrc: string
}

defineProps<Props>()

const emit = defineEmits<{
  close: []
  upload: [blob: Blob]
}>()

const cropperRef = useTemplateRef<InstanceType<typeof Cropper>>("cropperRef")
const previewSrc = ref<string>("")
const isReady = ref(false)
const isUploading = ref(false)
const error = ref("")

function onReady() {
  isReady.value = true
  updatePreview()
}

function onError() {
  error.value = "Failed to load image. Please try another file."
  isReady.value = false
}

function updatePreview() {
  if (!cropperRef.value) return

  const result = cropperRef.value.getResult()
  if (result?.canvas) {
    previewSrc.value = result.canvas.toDataURL("image/jpeg", 0.9)
  }
}

function zoomIn() {
  if (!cropperRef.value) return
  cropperRef.value.zoom(1.25)
}

function zoomOut() {
  if (!cropperRef.value) return
  cropperRef.value.zoom(0.75)
}

function reset() {
  if (!cropperRef.value) return
  cropperRef.value.reset()
}

async function handleUpload() {
  if (!cropperRef.value || !isReady.value) return

  isUploading.value = true
  error.value = ""

  try {
    const result = cropperRef.value.getResult()
    if (!result?.canvas) {
      error.value = "Failed to process image"
      return
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      result.canvas!.toBlob(
        (b) => {
          if (b) {
            resolve(b)
          } else {
            reject(new Error("Failed to create blob"))
          }
        },
        "image/jpeg",
        0.9,
      )
    })

    emit("upload", blob)
  } catch {
    error.value = "Failed to process image. Please try again."
  } finally {
    isUploading.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  backdrop-filter: blur(4px);
}

.cropper-wrapper {
  height: 400px;
  width: 400px;
}

.cropper {
  height: 100%;
  background: #1f2937;
}

:deep(.vue-rectangle-stencil) {
  border: 2px dashed rgba(255, 255, 255, 0.5);
}

:deep(.vue-circle-stencil) {
  border: 2px dashed rgba(255, 255, 255, 0.5);
}

:deep(.vue-handler-wrapper) {
  background: #6366f1;
  border: 2px solid white;
  width: 12px !important;
  height: 12px !important;
}
</style>
