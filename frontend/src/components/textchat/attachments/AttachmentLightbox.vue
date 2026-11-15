<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[100] flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      :aria-label="current.filename"
      data-testid="attachment-lightbox"
      @click.self="$emit('close')">
      <div class="flex items-center gap-2 px-4 py-2 text-sm text-white/90">
        <span class="truncate">{{ current.filename }}</span>
        <span class="text-white/50 flex-shrink-0">{{ formatBytes(current.size) }}</span>
        <span v-if="images.length > 1" class="text-white/50 flex-shrink-0"
          >{{ index + 1 }} / {{ images.length }}</span
        >
        <div class="ml-auto flex items-center gap-1">
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
          <button
            ref="closeBtn"
            type="button"
            :class="btn"
            title="Close (Esc)"
            @click="$emit('close')">
            <PhX class="w-5 h-5" />
          </button>
        </div>
      </div>
      <div
        class="relative flex-1 min-h-0 flex items-center justify-center p-4"
        @click.self="$emit('close')">
        <!-- The thumbnail shows at once (cached or small); the original replaces it once loaded. -->
        <div
          v-if="url || thumbUrl"
          :key="current.id"
          class="relative w-full h-full flex items-center justify-center"
          @click.self="$emit('close')">
          <img
            v-if="thumbUrl && !originalLoaded"
            :src="thumbUrl"
            alt=""
            aria-hidden="true"
            class="absolute inset-0 m-auto max-w-full max-h-full object-contain select-none"
            :style="thumbStyle"
            draggable="false" />
          <img
            v-if="url"
            :src="url"
            :alt="current.filename"
            class="max-w-full max-h-full object-contain select-none"
            :class="{ 'opacity-0': !originalLoaded }"
            @load="onImageLoad"
            @error="onError" />
          <PhSpinner
            v-if="!originalLoaded"
            class="absolute bottom-2 right-2 w-5 h-5 text-white/70 animate-spin"
            aria-label="Loading full image" />
        </div>
        <PhSpinner v-else class="w-8 h-8 text-white/60 animate-spin" />
        <button
          v-if="images.length > 1"
          type="button"
          :class="[btn, 'absolute left-4 top-1/2 -translate-y-1/2 bg-black/40']"
          aria-label="Previous image"
          @click="step(-1)">
          <PhCaretLeft class="w-6 h-6" />
        </button>
        <button
          v-if="images.length > 1"
          type="button"
          :class="[btn, 'absolute right-4 top-1/2 -translate-y-1/2 bg-black/40']"
          aria-label="Next image"
          @click="step(1)">
          <PhCaretRight class="w-6 h-6" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue"
import {
  PhArrowSquareOut,
  PhCaretLeft,
  PhCaretRight,
  PhDownloadSimple,
  PhSpinner,
  PhX,
} from "@phosphor-icons/vue"
import { openAttachment, useAttachmentUrl } from "@/services/attachments/urls"
import { isMediaCached, mediaKey } from "@/services/attachments/mediaCache"
import { formatBytes } from "@/utils/formatBytes"
import type { TextAttachment } from "@/types/textChat"

const props = defineProps<{ images: TextAttachment[]; startIndex: number }>()
const emit = defineEmits<{ close: [] }>()

const btn =
  "w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"

const index = ref(Math.min(props.startIndex, props.images.length - 1))
const current = computed(() => props.images[index.value])
const { url, onError } = useAttachmentUrl(
  () => current.value?.id ?? null,
  () => "original",
)
const closeBtn = useTemplateRef<HTMLButtonElement>("closeBtn")

// Progressive loading: the thumbnail fills in while the original downloads. Skipped
// when the original is already cached on the device (it loads at once).
const originalLoaded = ref(false)
const showThumb = computed(
  () => !!current.value?.has_thumb && !isMediaCached(mediaKey(current.value.id, "original")),
)
const { url: thumbUrl } = useAttachmentUrl(
  () => (showThumb.value ? current.value.id : null),
  () => "thumb",
)
// Size the thumbnail like the original will be (object-contain keeps the ratio).
const thumbStyle = computed(() => {
  const { width, height } = current.value ?? {}
  return width && height ? { width: `${width}px`, aspectRatio: `${width} / ${height}` } : {}
})

watch(
  () => current.value?.id,
  () => (originalLoaded.value = false),
)
function onImageLoad() {
  originalLoaded.value = true
}

function step(delta: number) {
  const n = props.images.length
  index.value = (index.value + delta + n) % n
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault()
    e.stopPropagation()
    emit("close")
  } else if (e.key === "ArrowLeft") step(-1)
  else if (e.key === "ArrowRight") step(1)
}

onMounted(() => {
  window.addEventListener("keydown", onKey, true)
  closeBtn.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener("keydown", onKey, true))
</script>
