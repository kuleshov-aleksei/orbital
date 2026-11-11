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
        <img
          v-if="url"
          :key="current.id"
          :src="url"
          :alt="current.filename"
          class="max-w-full max-h-full object-contain select-none"
          @error="onError" />
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
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue"
import {
  PhArrowSquareOut,
  PhCaretLeft,
  PhCaretRight,
  PhDownloadSimple,
  PhSpinner,
  PhX,
} from "@phosphor-icons/vue"
import { openAttachment, useAttachmentUrl } from "@/services/attachments/urls"
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
