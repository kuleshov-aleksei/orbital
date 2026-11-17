<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-[60] p-4 safe-area-pad"
      @pointerdown="backdropDown = $event.target === $event.currentTarget"
      @click.self="onBackdropClick"
      @keydown.esc="$emit('close')">
      <div
        ref="dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="`Edit ${upload.sourceFile.name}`"
        tabindex="-1"
        data-testid="image-edit-modal"
        class="bg-theme-bg-secondary border border-theme-border rounded-lg p-4 w-full max-w-3xl max-h-[95vh] overflow-y-auto text-sm flex flex-col gap-3 focus:outline-none">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold text-theme-text-primary truncate">Edit image</h2>
          <button
            type="button"
            class="text-theme-text-muted hover:text-theme-text-primary"
            title="Close"
            @click="$emit('close')">
            <PhX class="w-5 h-5" />
          </button>
        </div>

        <!-- Stage: the rotated image with the crop box over it -->
        <div ref="stage" class="flex items-center justify-center min-h-[200px] select-none">
          <p v-if="loadError" class="text-red-400">{{ loadError }}</p>
          <p v-else-if="!bitmap" class="text-theme-text-muted">Loading…</p>
          <div
            v-else
            class="relative overflow-hidden touch-none"
            :style="{ width: `${displayW}px`, height: `${displayH}px` }">
            <canvas ref="canvas" class="block w-full h-full" />
            <div
              class="absolute border-2 border-white cursor-move"
              style="box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.55)"
              :style="cropStyle"
              data-testid="image-edit-crop"
              @pointerdown="startDrag($event, null)">
              <!-- Rule-of-thirds guides -->
              <div class="absolute inset-0 pointer-events-none">
                <div class="absolute inset-y-0 left-1/3 border-l border-white/40" />
                <div class="absolute inset-y-0 left-2/3 border-l border-white/40" />
                <div class="absolute inset-x-0 top-1/3 border-t border-white/40" />
                <div class="absolute inset-x-0 top-2/3 border-t border-white/40" />
              </div>
              <div
                v-for="h in HANDLES"
                :key="h.name"
                class="absolute w-5 h-5 rounded-sm bg-white border border-black/40 shadow"
                :class="h.cls"
                :data-handle="h.name"
                @pointerdown="startDrag($event, h)" />
            </div>
          </div>
        </div>

        <!-- Toolbar -->
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex gap-1">
            <button
              type="button"
              class="w-8 h-8 flex items-center justify-center rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
              title="Rotate left"
              aria-label="Rotate left"
              :disabled="!bitmap"
              @click="rotate(-90)">
              <PhArrowCounterClockwise class="w-4 h-4" />
            </button>
            <button
              type="button"
              class="w-8 h-8 flex items-center justify-center rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary"
              title="Rotate right"
              aria-label="Rotate right"
              data-testid="image-edit-rotate-right"
              :disabled="!bitmap"
              @click="rotate(90)">
              <PhArrowClockwise class="w-4 h-4" />
            </button>
          </div>
          <div class="flex flex-wrap gap-1" role="group" aria-label="Aspect ratio">
            <button
              v-for="p in PRESETS"
              :key="p.label"
              type="button"
              class="h-8 px-2.5 rounded text-xs font-medium transition-colors"
              :class="
                ratio === p.ratio
                  ? 'bg-theme-accent text-white'
                  : 'bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary'
              "
              :aria-pressed="ratio === p.ratio"
              :data-testid="`image-edit-ratio-${p.label}`"
              :disabled="!bitmap"
              @click="setRatio(p.ratio)">
              {{ p.label }}
            </button>
          </div>
          <span v-if="crop" class="ml-auto text-xs text-theme-text-muted tabular-nums">
            {{ Math.round(crop.w) }} × {{ Math.round(crop.h) }}
          </span>
        </div>

        <p v-if="applyError" class="text-xs text-red-400">{{ applyError }}</p>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="h-9 px-3 rounded text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover disabled:opacity-50"
            :disabled="applying || !upload.edit"
            title="Send the image as picked"
            data-testid="image-edit-reset"
            @click="apply(null)">
            Reset to original
          </button>
          <div class="ml-auto flex gap-2">
            <button
              type="button"
              class="h-9 px-3 rounded text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover"
              @click="$emit('close')">
              Cancel
            </button>
            <button
              type="button"
              class="h-9 px-4 rounded bg-theme-accent text-white font-medium hover:opacity-90 disabled:opacity-50"
              :disabled="applying || !bitmap || !crop"
              data-testid="image-edit-apply"
              @click="apply({ rotation, crop: crop && clampCrop(crop, rotW, rotH) })">
              {{ applying ? "Applying…" : "Apply" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue"
import { PhArrowClockwise, PhArrowCounterClockwise, PhX } from "@phosphor-icons/vue"
import { useAttachmentsStore, type ComposerUpload } from "@/stores/attachments"
import { isAnimatedImage } from "@/utils/compressImage"
import {
  centeredCrop,
  clampCrop,
  moveCrop,
  resizeCrop,
  rotateBy,
  rotatedSize,
  type CropHandle,
  type CropRect,
  type ImageEdit,
  type Rotation,
} from "@/utils/editImage"

const props = defineProps<{ upload: ComposerUpload }>()
const emit = defineEmits<{ close: [] }>()
const store = useAttachmentsStore()

const PRESETS: { label: string; ratio: number | null }[] = [
  { label: "Free", ratio: null },
  { label: "1:1", ratio: 1 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "16:9", ratio: 16 / 9 },
  { label: "9:16", ratio: 9 / 16 },
]
const HANDLES: (CropHandle & { name: string; cls: string })[] = [
  { name: "nw", sx: -1, sy: -1, cls: "left-0 top-0 cursor-nwse-resize" },
  { name: "ne", sx: 1, sy: -1, cls: "right-0 top-0 cursor-nesw-resize" },
  { name: "sw", sx: -1, sy: 1, cls: "left-0 bottom-0 cursor-nesw-resize" },
  { name: "se", sx: 1, sy: 1, cls: "right-0 bottom-0 cursor-nwse-resize" },
]
/** Smallest crop side, in screen px. */
const MIN_DISPLAY_PX = 32

const dialog = useTemplateRef<HTMLElement>("dialog")
const canvas = useTemplateRef<HTMLCanvasElement>("canvas")
const bitmap = shallowRef<ImageBitmap | null>(null)
const loadError = ref<string | null>(null)
const applyError = ref<string | null>(null)
const applying = ref(false)

const rotation = ref<Rotation>(props.upload.edit?.rotation ?? 0)
const crop = ref<CropRect | null>(props.upload.edit?.crop ?? null)
const ratio = ref<number | null>(null)

const rotW = computed(() =>
  bitmap.value ? rotatedSize(bitmap.value.width, bitmap.value.height, rotation.value)[0] : 0,
)
const rotH = computed(() =>
  bitmap.value ? rotatedSize(bitmap.value.width, bitmap.value.height, rotation.value)[1] : 0,
)

// Display size: fit the rotated image in the stage.
const viewport = ref({ w: window.innerWidth, h: window.innerHeight })
const scale = computed(() => {
  if (!rotW.value) return 1
  const maxW = Math.min(viewport.value.w - 64, 736)
  const maxH = viewport.value.h * 0.6
  return Math.min(maxW / rotW.value, maxH / rotH.value, 4)
})
const displayW = computed(() => Math.round(rotW.value * scale.value))
const displayH = computed(() => Math.round(rotH.value * scale.value))

const cropStyle = computed(() => {
  const c = crop.value
  if (!c) return {}
  const s = scale.value
  return {
    left: `${c.x * s}px`,
    top: `${c.y * s}px`,
    width: `${c.w * s}px`,
    height: `${c.h * s}px`,
  }
})

function fullCrop(): CropRect {
  return ratio.value
    ? centeredCrop(rotW.value, rotH.value, ratio.value)
    : { x: 0, y: 0, w: rotW.value, h: rotH.value }
}

function draw() {
  const el = canvas.value
  const bmp = bitmap.value
  if (!el || !bmp) return
  const dpr = window.devicePixelRatio || 1
  el.width = Math.max(1, Math.round(displayW.value * dpr))
  el.height = Math.max(1, Math.round(displayH.value * dpr))
  const ctx = el.getContext("2d")
  if (!ctx) return
  const s = scale.value * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, el.width, el.height)
  ctx.imageSmoothingQuality = "high"
  ctx.translate(el.width / 2, el.height / 2)
  ctx.rotate((rotation.value * Math.PI) / 180)
  ctx.scale(s, s)
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2)
}

watch([bitmap, rotation, displayW, displayH], () => void nextTick(draw))

function rotate(delta: 90 | -90) {
  rotation.value = rotateBy(rotation.value, delta)
  crop.value = fullCrop()
}

function setRatio(r: number | null) {
  ratio.value = r
  if (r) crop.value = centeredCrop(rotW.value, rotH.value, r)
}

// --- Dragging --------------------------------------------------------------

let drag: {
  id: number
  handle: CropHandle | null
  startX: number
  startY: number
  start: CropRect
} | null = null

function startDrag(e: PointerEvent, handle: CropHandle | null) {
  if (!crop.value || e.button > 0) return
  // A handle's press bubbles to the crop box: the handle already took it.
  if (!handle && (e.target as HTMLElement).dataset.handle) return
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  drag = { id: e.pointerId, handle, startX: e.clientX, startY: e.clientY, start: { ...crop.value } }
  window.addEventListener("pointermove", onDrag)
  window.addEventListener("pointerup", endDrag)
  window.addEventListener("pointercancel", endDrag)
}

function onDrag(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return
  const dx = (e.clientX - drag.startX) / scale.value
  const dy = (e.clientY - drag.startY) / scale.value
  crop.value = drag.handle
    ? resizeCrop(
        drag.start,
        drag.handle,
        dx,
        dy,
        rotW.value,
        rotH.value,
        ratio.value,
        MIN_DISPLAY_PX / scale.value,
      )
    : moveCrop(drag.start, dx, dy, rotW.value, rotH.value)
}

function endDrag(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return
  drag = null
  removeDragListeners()
}

function removeDragListeners() {
  window.removeEventListener("pointermove", onDrag)
  window.removeEventListener("pointerup", endDrag)
  window.removeEventListener("pointercancel", endDrag)
}

// Close on a backdrop click only when the press started there too (a crop
// drag released outside the dialog must not close it).
const backdropDown = ref(false)
function onBackdropClick() {
  if (backdropDown.value) emit("close")
  backdropDown.value = false
}

// --- Lifecycle ---------------------------------------------------------------

function onResize() {
  viewport.value = { w: window.innerWidth, h: window.innerHeight }
}

onMounted(async () => {
  dialog.value?.focus()
  window.addEventListener("resize", onResize)
  try {
    if (await isAnimatedImage(props.upload.sourceFile)) {
      loadError.value = "Animated images can't be edited."
      return
    }
    // from-image: the editor works on the upright image, like the upload.
    const bmp = await createImageBitmap(props.upload.sourceFile, {
      imageOrientation: "from-image",
    })
    if (unmounted) {
      bmp.close()
      return
    }
    bitmap.value = bmp
    const [w, h] = rotatedSize(bmp.width, bmp.height, rotation.value)
    crop.value = crop.value ? clampCrop(crop.value, w, h) : { x: 0, y: 0, w, h }
  } catch {
    loadError.value = "This image could not be opened."
  }
})

let unmounted = false
onBeforeUnmount(() => {
  unmounted = true
  window.removeEventListener("resize", onResize)
  removeDragListeners()
  bitmap.value?.close()
})

async function apply(edit: ImageEdit | null) {
  applying.value = true
  applyError.value = null
  try {
    await store.applyEdit(props.upload.localId, edit)
    emit("close")
  } catch {
    applyError.value = "The image could not be edited."
  } finally {
    applying.value = false
  }
}
</script>
