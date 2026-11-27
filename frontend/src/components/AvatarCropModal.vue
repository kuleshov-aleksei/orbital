<template>
  <Teleport to="body">
    <!--
      Phones (incl. landscape): a full-screen editor whose action bar is always on screen.
      roomy (wide and tall): a centered dialog with the preview column on the right.
    -->
    <div
      class="fixed inset-0 z-[60] flex justify-center bg-theme-backdrop safe-area-pad roomy:items-center roomy:p-4"
      @pointerdown="backdropDown = $event.target === $event.currentTarget"
      @click.self="onBackdropClick"
      @keydown.esc="$emit('close')">
      <div
        ref="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-crop-title"
        tabindex="-1"
        data-testid="avatar-crop-modal"
        class="flex h-full w-full flex-col overflow-hidden bg-theme-bg-secondary focus:outline-none roomy:h-auto roomy:max-h-[90vh] roomy:max-w-2xl roomy:rounded-lg roomy:border roomy:border-theme-border roomy:shadow-xl">
        <!-- Header -->
        <div
          class="flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-theme-border px-4 roomy:h-auto roomy:border-0 roomy:px-6 roomy:pb-4 roomy:pt-5">
          <h2
            id="avatar-crop-title"
            class="truncate text-base font-semibold text-theme-text-primary roomy:text-xl">
            Edit profile picture
          </h2>

          <button
            type="button"
            class="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-theme-text-muted transition-colors hover:bg-theme-bg-hover hover:text-theme-text-primary"
            title="Close"
            aria-label="Close"
            @click="$emit('close')">
            <PhX class="h-5 w-5" />
          </button>
        </div>

        <!-- Body -->
        <div
          class="flex min-h-0 flex-1 flex-col roomy:flex-row roomy:gap-6 roomy:overflow-y-auto roomy:px-6">
          <div class="flex min-h-0 flex-1 flex-col roomy:flex-none">
            <!-- Cropper: fills the free height on phones, 400px square on desktop -->
            <div
              class="cropper-wrapper min-h-0 flex-1 overflow-hidden bg-black roomy:h-[400px] roomy:w-[400px] roomy:flex-none roomy:rounded-lg">
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

            <!-- Previews (phones) + zoom controls -->
            <div
              class="flex flex-shrink-0 items-center gap-3 px-4 py-3 roomy:justify-center roomy:px-0">
              <div class="flex items-center gap-3 roomy:hidden" aria-label="Preview">
                <div class="preview-circle h-14 w-14">
                  <img v-if="previewSrc" :src="previewSrc" alt="Preview" />
                </div>
                <div class="preview-circle h-8 w-8">
                  <img v-if="previewSrc" :src="previewSrc" alt="Preview small" />
                </div>
              </div>

              <div class="ml-auto flex items-center gap-1 roomy:ml-0 roomy:gap-4">
                <button
                  type="button"
                  class="tool-button"
                  title="Zoom out"
                  aria-label="Zoom out"
                  :disabled="!isReady"
                  @click="zoomOut">
                  <PhMagnifyingGlassMinus class="h-5 w-5" />
                </button>

                <button
                  type="button"
                  class="tool-button"
                  title="Zoom in"
                  aria-label="Zoom in"
                  :disabled="!isReady"
                  @click="zoomIn">
                  <PhMagnifyingGlassPlus class="h-5 w-5" />
                </button>

                <button
                  type="button"
                  class="tool-button"
                  title="Reset"
                  aria-label="Reset"
                  :disabled="!isReady"
                  @click="reset">
                  <PhArrowCounterClockwise class="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          <!-- Previews (desktop) -->
          <div class="hidden flex-col items-center gap-4 roomy:flex">
            <div class="mb-2 text-sm text-theme-text-muted">Preview</div>

            <div class="preview-circle h-32 w-32">
              <img v-if="previewSrc" :src="previewSrc" alt="Preview" />
            </div>

            <!-- Size it will appear in the UI -->
            <div class="preview-circle h-12 w-12">
              <img v-if="previewSrc" :src="previewSrc" alt="Preview small" />
            </div>

            <div class="text-center text-xs text-theme-text-muted">Final image: 512x512px</div>
          </div>
        </div>

        <!-- Error Message -->
        <div
          v-if="error"
          class="flex-shrink-0 px-4 pt-3 text-center text-sm text-red-400 roomy:px-6">
          {{ error }}
        </div>

        <!-- Actions: always visible -->
        <div
          class="flex flex-shrink-0 gap-3 border-t border-theme-border px-4 py-3 roomy:justify-end roomy:border-0 roomy:px-6 roomy:pb-6 roomy:pt-4">
          <button
            type="button"
            data-testid="avatar-crop-cancel"
            class="h-11 flex-1 rounded-lg bg-theme-bg-tertiary px-4 text-theme-text-primary transition-colors duration-200 hover:bg-theme-bg-hover roomy:h-10 roomy:flex-none"
            @click="$emit('close')">
            Cancel
          </button>

          <button
            type="button"
            data-testid="avatar-crop-save"
            :disabled="isUploading || !isReady"
            class="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-theme-accent px-4 font-medium text-theme-text-on-accent transition-colors duration-200 hover:bg-theme-accent/80 disabled:cursor-not-allowed disabled:opacity-50 roomy:h-10 roomy:flex-none"
            @click="handleUpload">
            <PhSpinner v-if="isUploading" class="h-4 w-4 animate-spin" />
            <PhCheck v-else class="h-4 w-4" />
            {{ isUploading ? "Saving…" : "Save" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, useTemplateRef } from "vue"
import { Cropper } from "vue-advanced-cropper"
import {
  PhMagnifyingGlassPlus,
  PhMagnifyingGlassMinus,
  PhArrowCounterClockwise,
  PhCheck,
  PhSpinner,
  PhX,
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

const dialog = useTemplateRef<HTMLDivElement>("dialog")
const cropperRef = useTemplateRef<InstanceType<typeof Cropper>>("cropperRef")
const previewSrc = ref<string>("")
const isReady = ref(false)
const isUploading = ref(false)
const error = ref("")

// Close on a backdrop click only when the press also started there, so a crop
// drag released outside the dialog doesn't throw the edit away.
const backdropDown = ref(false)
function onBackdropClick() {
  if (backdropDown.value) emit("close")
  backdropDown.value = false
}

onMounted(() => {
  // Focus the dialog so Esc works without clicking into it first.
  dialog.value?.focus()
})

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
.cropper-wrapper {
  /* Crop drags must not scroll or zoom the page on touch screens. */
  touch-action: none;
}

.cropper {
  height: 100%;
  background: #000;
}

.preview-circle {
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 9999px;
  background: var(--color-bg-tertiary, rgb(55 65 81));
  box-shadow: 0 0 0 2px rgb(255 255 255 / 0.15);
}

.preview-circle img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tool-button {
  display: flex;
  width: 2.75rem;
  height: 2.75rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  color: var(--color-text-secondary, rgb(156 163 175));
  transition:
    background-color 150ms,
    color 150ms;
}

.tool-button:hover:not(:disabled) {
  background: var(--color-bg-hover);
  color: var(--color-text-primary, #fff);
}

.tool-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (min-width: 768px) and (min-height: 640px) {
  .tool-button {
    width: 2.25rem;
    height: 2.25rem;
  }
}

:deep(.vue-rectangle-stencil),
:deep(.vue-circle-stencil) {
  border: 2px dashed rgba(255, 255, 255, 0.5);
}

:deep(.vue-handler-wrapper) {
  background: var(--color-accent);
  border: 2px solid white;
  width: 12px !important;
  height: 12px !important;
}

/* Bigger crop handles for fingers. */
@media (pointer: coarse) {
  :deep(.vue-handler-wrapper) {
    width: 20px !important;
    height: 20px !important;
  }
}
</style>
