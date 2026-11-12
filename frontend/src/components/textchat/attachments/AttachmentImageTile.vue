<template>
  <button
    type="button"
    class="relative block overflow-hidden rounded-lg bg-theme-bg-tertiary border border-theme-border/60 focus-visible:ring-2 focus-visible:ring-theme-accent"
    :style="boxStyle"
    :aria-label="`Open image ${attachment.filename}`"
    data-testid="attachment-image"
    @click="$emit('open')"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @contextmenu.prevent="$emit('menu', $event)">
    <img
      v-if="url"
      :src="url"
      :alt="attachment.filename"
      class="w-full h-full object-cover"
      :class="{ 'opacity-0': !loaded }"
      draggable="false"
      @load="loaded = true"
      @error="onError" />
    <div
      v-if="!loaded"
      class="absolute inset-0 flex items-center justify-center text-theme-text-muted">
      <PhImageBroken v-if="gone" class="w-6 h-6" />
      <PhImage v-else class="w-6 h-6 animate-pulse" />
    </div>
    <span
      v-if="isGif && showStill"
      class="absolute bottom-1.5 left-1.5 px-1.5 rounded bg-black/60 text-[10px] font-bold text-white tracking-wide"
      >GIF</span
    >
  </button>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { PhImage, PhImageBroken } from "@phosphor-icons/vue"
import { useAttachmentUrl } from "@/services/attachments/urls"
import { useAppSettingsStore } from "@/stores/appSettings"
import type { TextAttachment } from "@/types/textChat"

const props = withDefaults(
  defineProps<{
    attachment: TextAttachment
    /** Single image: sized by aspect ratio; otherwise a square grid cell. */
    single?: boolean
  }>(),
  { single: false },
)

defineEmits<{ open: []; menu: [event: MouseEvent] }>()

const appSettings = useAppSettingsStore()
const hovered = ref(false)
const loaded = ref(false)

const isGif = computed(() => props.attachment.mime === "image/gif")
// GIFs play unless motion is reduced (then the still thumbnail, animated on hover).
const showStill = computed(() => isGif.value && appSettings.reduceEmojiMotion && !hovered.value)
const variant = computed(() =>
  isGif.value && !showStill.value ? "original" : props.attachment.has_thumb ? "thumb" : "original",
)

const { url, gone, onError } = useAttachmentUrl(
  () => props.attachment.id,
  () => variant.value,
)
watch(variant, () => (loaded.value = false))

const MAX_W = 400
const MAX_H = 300
const boxStyle = computed(() => {
  if (!props.single) return { width: "100%", aspectRatio: "1 / 1" }
  const w = props.attachment.width || MAX_W
  const h = props.attachment.height || MAX_H
  const scale = Math.min(1, MAX_W / w, MAX_H / h)
  // The minimum keeps the corner "⋯" button off the tile's centre, so a tiny
  // image still opens on click.
  return {
    width: `${Math.max(96, Math.round(w * scale))}px`,
    minHeight: "64px",
    maxWidth: "100%",
    aspectRatio: `${w} / ${h}`,
  }
})
</script>
