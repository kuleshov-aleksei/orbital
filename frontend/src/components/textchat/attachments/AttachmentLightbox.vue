<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[100] flex flex-col"
      :class="{ 'pointer-events-none': closing }"
      role="dialog"
      aria-modal="true"
      :aria-label="current.filename"
      data-testid="attachment-lightbox">
      <div ref="backdrop" class="absolute inset-0 bg-black/90" aria-hidden="true" />
      <div data-chrome class="relative flex items-center gap-2 px-4 py-2 text-sm text-white/90">
        <span class="truncate">{{ current.filename }}</span>
        <span class="text-white/50 flex-shrink-0">{{ formatBytes(current.size) }}</span>
        <span v-if="images.length > 1" class="text-white/50 flex-shrink-0"
          >{{ index + 1 }} / {{ images.length }}</span
        >
        <div class="ml-auto flex items-center gap-1">
          <button
            v-if="canCopy"
            type="button"
            :class="btn"
            :title="copyTitle"
            aria-label="Copy image"
            data-testid="lightbox-copy"
            :disabled="copyState === 'busy'"
            @click="copyCurrent">
            <PhSpinner v-if="copyState === 'busy'" class="w-5 h-5 animate-spin" />
            <PhCheck v-else-if="copyState === 'done'" class="w-5 h-5 text-green-400" />
            <PhCopy v-else class="w-5 h-5" :class="{ 'text-red-400': copyState === 'error' }" />
          </button>
          <button
            type="button"
            :class="btn"
            title="Open original"
            @click="openAttachment(current.id, 'original')">
            <PhArrowSquareOut class="w-5 h-5" />
          </button>
          <button
            type="button"
            :class="btn"
            title="Download"
            @click="openAttachment(current.id, 'download')">
            <PhDownloadSimple class="w-5 h-5" />
          </button>
          <button ref="closeBtn" type="button" :class="btn" title="Close (Esc)" @click="close">
            <PhX class="w-5 h-5" />
          </button>
        </div>
      </div>
      <!-- Stage: owns the zoom/pan gestures; a tap on its empty area closes. -->
      <div
        ref="stage"
        class="relative flex-1 min-h-0 overflow-hidden touch-none select-none"
        @click.self="onBackdropClick"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel.prevent="onWheel">
        <!-- Frame: sized to the fitted image, so a grid tile's object-cover crop
             grows into it without distortion. Layers, bottom to top: the tile's
             own image (instant), the thumbnail, then the original once loaded. -->
        <div
          v-if="frame"
          ref="frameEl"
          :key="current.id"
          class="absolute overflow-hidden"
          :class="[
            zoom.s > 1 ? 'cursor-grab' : 'cursor-zoom-in',
            { 'transition-transform duration-200 ease-out': smoothZoom },
          ]"
          :style="frameStyle">
          <img
            v-if="placeholderSrc"
            :src="placeholderSrc"
            alt=""
            aria-hidden="true"
            :class="[layer, fitClass]"
            draggable="false" />
          <img
            v-if="thumbUrl && !originalLoaded"
            :src="thumbUrl"
            alt=""
            aria-hidden="true"
            :class="[layer, fitClass]"
            draggable="false" />
          <img
            v-if="url"
            :src="url"
            :alt="current.filename"
            :class="[layer, fitClass, { 'opacity-0': !originalLoaded }]"
            draggable="false"
            @load="onImageLoad"
            @error="onError" />
        </div>
        <PhSpinner
          v-if="!url && !thumbUrl && !placeholderSrc"
          class="absolute inset-0 m-auto w-8 h-8 text-white/60 animate-spin" />
        <PhSpinner
          v-else-if="!originalLoaded"
          data-chrome
          class="absolute bottom-3 right-3 w-5 h-5 text-white/70 animate-spin"
          aria-label="Loading full image" />
        <button
          v-if="images.length > 1"
          data-chrome
          type="button"
          :class="[btn, 'absolute left-4 top-1/2 -translate-y-1/2 bg-black/40']"
          aria-label="Previous image"
          @pointerdown.stop
          @click="step(-1)">
          <PhCaretLeft class="w-6 h-6" />
        </button>
        <button
          v-if="images.length > 1"
          data-chrome
          type="button"
          :class="[btn, 'absolute right-4 top-1/2 -translate-y-1/2 bg-black/40']"
          aria-label="Next image"
          @pointerdown.stop
          @click="step(1)">
          <PhCaretRight class="w-6 h-6" />
        </button>
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
  reactive,
  ref,
  useTemplateRef,
  watch,
} from "vue"
import {
  PhArrowSquareOut,
  PhCaretLeft,
  PhCaretRight,
  PhCheck,
  PhCopy,
  PhDownloadSimple,
  PhSpinner,
  PhX,
} from "@phosphor-icons/vue"
import { openAttachment, useAttachmentUrl } from "@/services/attachments/urls"
import { isMediaCached, mediaKey } from "@/services/attachments/mediaCache"
import { clipboardImageSupported, copyImageToClipboard } from "@/services/attachments/clipboard"
import { pushBackHandler } from "@/services/backButton"
import { formatBytes } from "@/utils/formatBytes"
import type { TextAttachment } from "@/types/textChat"

const props = defineProps<{
  images: TextAttachment[]
  startIndex: number
  /** Holds the image tiles (`data-attachment-id`) the lightbox grows from and shrinks back to. */
  originRoot?: HTMLElement | null
}>()
const emit = defineEmits<{ close: [] }>()

const btn =
  "w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
const layer = "absolute inset-0 w-full h-full select-none"

const index = ref(Math.min(props.startIndex, props.images.length - 1))
const current = computed(() => props.images[index.value])
const { url, onError } = useAttachmentUrl(
  () => current.value?.id ?? null,
  () => "original",
)
const closeBtn = useTemplateRef<HTMLButtonElement>("closeBtn")
const backdrop = useTemplateRef<HTMLDivElement>("backdrop")
const stage = useTemplateRef<HTMLDivElement>("stage")
const frameEl = useTemplateRef<HTMLDivElement>("frameEl")

// Copying the shown image (web Clipboard API; hidden in the Android app).
const canCopy = clipboardImageSupported()
const copyState = ref<"idle" | "busy" | "done" | "error">("idle")
const copyTitle = computed(() => {
  if (copyState.value === "error") return "Could not copy the image"
  if (copyState.value === "done") return "Copied to clipboard"
  return "Copy image (Ctrl+C)"
})
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copyCurrent() {
  const att = current.value
  if (!att || !canCopy || copyState.value === "busy") return
  copyState.value = "busy"
  try {
    await copyImageToClipboard(att.id)
    copyState.value = "done"
  } catch {
    copyState.value = "error"
  }
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copyTimer = null
    copyState.value = "idle"
  }, 1800)
}

// Progressive loading: the thumbnail fills in while the original downloads. Skipped
// when the original is already cached on the device (it loads at once).
const originalLoaded = ref(false)
const natural = ref<{ w: number; h: number } | null>(null)
const showThumb = computed(
  () => !!current.value?.has_thumb && !isMediaCached(mediaKey(current.value.id, "original")),
)
const { url: thumbUrl } = useAttachmentUrl(
  () => (showThumb.value ? current.value.id : null),
  () => "thumb",
)

function tileFor(id: string): HTMLElement | null {
  return (
    props.originRoot?.querySelector<HTMLElement>(`[data-attachment-id="${CSS.escape(id)}"]`) ?? null
  )
}

// The tile's already-decoded image, shown under everything else so the frame
// is never empty while it grows (the URLs below may still be resolving).
const placeholder = ref<{ id: string; src: string } | null>(null)
const placeholderSrc = computed(() =>
  placeholder.value?.id === current.value?.id ? placeholder.value.src : null,
)
function capturePlaceholder() {
  const id = current.value?.id
  const img = id ? tileFor(id)?.querySelector("img") : null
  if (id && img?.complete && img.naturalWidth) placeholder.value = { id, src: img.currentSrc }
}

watch(
  () => current.value?.id,
  () => {
    originalLoaded.value = false
    natural.value = null
    if (copyTimer) {
      clearTimeout(copyTimer)
      copyTimer = null
    }
    copyState.value = "idle"
    resetZoom(false)
  },
)
function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement
  natural.value = { w: img.naturalWidth, h: img.naturalHeight }
  originalLoaded.value = true
}

// ── Layout: the frame is the image fitted into the stage (never upscaled) ──
const MARGIN = 16
const stageSize = ref({ w: 0, h: 0 })
function measure() {
  const r = stage.value?.getBoundingClientRect()
  if (r) stageSize.value = { w: r.width, h: r.height }
}
const dims = computed(() => {
  const a = current.value
  return a?.width && a?.height ? { w: a.width, h: a.height } : natural.value
})
const frame = computed(() => {
  const { w: sw, h: sh } = stageSize.value
  if (!sw || !sh) return null
  const aw = Math.max(1, sw - 2 * MARGIN)
  const ah = Math.max(1, sh - 2 * MARGIN)
  const d = dims.value
  // Unknown size: fill the stage and let object-contain fit the image.
  if (!d) return { left: MARGIN, top: MARGIN, width: aw, height: ah, exact: false }
  const scale = Math.min(1, aw / d.w, ah / d.h)
  const width = d.w * scale
  const height = d.h * scale
  return { left: (sw - width) / 2, top: (sh - height) / 2, width, height, exact: true }
})
const fitClass = computed(() => (frame.value?.exact ? "object-cover" : "object-contain"))

// ── Zoom: translate (px, from the stage centre) + scale around the frame centre ──
const zoom = reactive({ s: 1, x: 0, y: 0 })
const smoothZoom = ref(false)
const transform = computed(() => `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`)
const frameStyle = computed(() => {
  const f = frame.value
  if (!f) return {}
  return {
    left: `${f.left}px`,
    top: `${f.top}px`,
    width: `${f.width}px`,
    height: `${f.height}px`,
    transform: transform.value,
  }
})
// Up to 1:1 pixels for big photos, at least 4×.
const maxZoom = computed(() => {
  const d = dims.value
  const f = frame.value
  return Math.max(4, d && f ? d.w / f.width : 1)
})
const DOUBLE_TAP_ZOOM = 2.5

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}
function setZoom(s: number, x: number, y: number) {
  const f = frame.value
  if (!f) return
  s = clamp(s, 1, maxZoom.value)
  // Keep the image covering the stage once it is larger than it.
  const mx = Math.max(0, (f.width * s - stageSize.value.w) / 2)
  const my = Math.max(0, (f.height * s - stageSize.value.h) / 2)
  zoom.s = s
  zoom.x = clamp(x, -mx, mx)
  zoom.y = clamp(y, -my, my)
}
/** Zooms to `s`, keeping the stage point (px, py) (from its centre) in place. */
function zoomAt(s: number, px: number, py: number) {
  const k = clamp(s, 1, maxZoom.value) / zoom.s
  setZoom(zoom.s * k, px - k * (px - zoom.x), py - k * (py - zoom.y))
}
function resetZoom(smooth: boolean) {
  smoothZoom.value = smooth
  zoom.s = 1
  zoom.x = 0
  zoom.y = 0
}

// ── Gestures: one pointer pans (when zoomed), two pinch, a double tap toggles ──
type Point = { x: number; y: number }
const pointers = new Map<number, Point>()
let gesture:
  | { kind: "pan"; start: Point; tx: number; ty: number }
  | { kind: "pinch"; dist: number; mid: Point; s: number; tx: number; ty: number }
  | null = null
let moved = false
let lastTap = { t: 0, x: 0, y: 0 }
const TAP_SLOP = 8

function local(e: PointerEvent | WheelEvent): Point {
  const r = stage.value!.getBoundingClientRect()
  return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }
}
function startGesture() {
  const pts = [...pointers.values()]
  smoothZoom.value = false
  if (pts.length >= 2) {
    const [a, b] = pts
    gesture = {
      kind: "pinch",
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      s: zoom.s,
      tx: zoom.x,
      ty: zoom.y,
    }
  } else if (pts.length === 1) {
    gesture = { kind: "pan", start: pts[0], tx: zoom.x, ty: zoom.y }
  } else {
    gesture = null
  }
}
function onPointerDown(e: PointerEvent) {
  if (e.pointerType === "mouse" && e.button !== 0) return
  if (pointers.size === 0) moved = false
  else moved = true // a second finger: never a tap
  pointers.set(e.pointerId, local(e))
  startGesture()
}
function onPointerMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return
  const p = local(e)
  pointers.set(e.pointerId, p)
  if (gesture?.kind === "pinch") {
    const [a, b] = [...pointers.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const s = clamp((gesture.s * dist) / gesture.dist, 1, maxZoom.value)
    const k = s / gesture.s
    // The image point under the starting midpoint follows the fingers.
    setZoom(s, mid.x - k * (gesture.mid.x - gesture.tx), mid.y - k * (gesture.mid.y - gesture.ty))
  } else if (gesture?.kind === "pan") {
    const dx = p.x - gesture.start.x
    const dy = p.y - gesture.start.y
    if (!moved && Math.hypot(dx, dy) > TAP_SLOP) moved = true
    if (moved && zoom.s > 1) setZoom(zoom.s, gesture.tx + dx, gesture.ty + dy)
  }
}
function onPointerUp(e: PointerEvent) {
  const p = pointers.get(e.pointerId)
  if (!p) return
  pointers.delete(e.pointerId)
  if (pointers.size > 0) {
    startGesture() // pinch → pan with the remaining finger
    return
  }
  gesture = null
  if (!moved && e.type === "pointerup") onTap(p)
}
function onTap(p: Point) {
  const now = performance.now()
  if (now - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
    lastTap.t = 0
    if (zoom.s > 1) resetZoom(true)
    else {
      smoothZoom.value = true
      zoomAt(DOUBLE_TAP_ZOOM, p.x, p.y)
    }
  } else {
    lastTap = { t: now, ...p }
  }
}
function onWheel(e: WheelEvent) {
  smoothZoom.value = false
  const p = local(e)
  zoomAt(zoom.s * Math.exp(-e.deltaY * 0.0015), p.x, p.y)
}
function onBackdropClick() {
  if (!moved) close()
}

// ── Open/close: grow from the tile, shrink back into it ──
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
const EASE = "cubic-bezier(0.2, 0, 0, 1)"
const closing = ref(false)

/** The current image's tile, if it is on screen. */
function originRect(): DOMRect | null {
  const id = current.value?.id
  const el = id ? tileFor(id) : null
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height || r.bottom < 0 || r.top > window.innerHeight) return null
  return r
}
function tileKeyframe(r: DOMRect): Keyframe {
  const s = stage.value!.getBoundingClientRect()
  return {
    left: `${r.left - s.left}px`,
    top: `${r.top - s.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    borderRadius: "8px",
    transform: "none",
  }
}
function restKeyframe(): Keyframe {
  return { ...frameStyle.value, borderRadius: "0px" }
}
function fadeChrome(opacity: [number, number], options: KeyframeAnimationOptions) {
  const els = [
    backdrop.value,
    ...(stage.value?.parentElement?.querySelectorAll("[data-chrome]") ?? []),
  ]
  return els.filter((el) => !!el).map((el) => el.animate({ opacity }, options))
}

function playOpen() {
  const fade = { duration: reduceMotion ? 0 : 220, easing: "ease-out" }
  fadeChrome([0, 1], fade)
  const from = !reduceMotion && frame.value?.exact ? originRect() : null
  if (from)
    frameEl.value?.animate([tileKeyframe(from), restKeyframe()], { duration: 300, easing: EASE })
  else frameEl.value?.animate({ opacity: [0, 1] }, fade)
}

function close() {
  if (closing.value) return
  closing.value = true
  const to = !reduceMotion && frame.value?.exact ? originRect() : null
  const options: KeyframeAnimationOptions = {
    duration: reduceMotion ? 0 : to ? 250 : 160,
    easing: EASE,
    fill: "forwards",
  }
  const anims = fadeChrome([1, 0], options)
  if (frameEl.value) {
    anims.push(
      to
        ? frameEl.value.animate([restKeyframe(), tileKeyframe(to)], options)
        : frameEl.value.animate({ opacity: [1, 0] }, options),
    )
  }
  void Promise.allSettled(anims.map((a) => a.finished)).then(() => emit("close"))
}

function step(delta: number) {
  const n = props.images.length
  index.value = (index.value + delta + n) % n
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault()
    e.stopPropagation()
    close()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
    if (!canCopy) return
    e.preventDefault()
    void copyCurrent()
  } else if (e.key === "ArrowLeft") step(-1)
  else if (e.key === "ArrowRight") step(1)
}

let removeBack: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
onMounted(async () => {
  window.addEventListener("keydown", onKey, true)
  removeBack = pushBackHandler(close)
  closeBtn.value?.focus()
  capturePlaceholder()
  measure()
  resizeObserver = new ResizeObserver(() => {
    measure()
    resetZoom(false)
  })
  if (stage.value) resizeObserver.observe(stage.value)
  await nextTick() // the frame renders once the stage is measured
  playOpen()
})
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey, true)
  if (copyTimer) clearTimeout(copyTimer)
  removeBack?.()
  resizeObserver?.disconnect()
})
</script>
