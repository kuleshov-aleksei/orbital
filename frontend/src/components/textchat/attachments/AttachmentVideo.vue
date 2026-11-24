<template>
  <div
    class="relative rounded-lg overflow-hidden bg-black border border-theme-border/60"
    :style="boxStyle"
    data-testid="attachment-video"
    :data-spoiler="hidden ? 'hidden' : undefined"
    @contextmenu.prevent="$emit('menu', $event)">
    <!-- The #t fragment seeks on load, which clears the "show poster" flag:
         Android WebView otherwise covers the decoded first frame with its
         built-in grey play-icon poster until playback starts. -->
    <video
      v-if="url && !failed"
      :src="`${url}#t=0.001`"
      :controls="!hidden"
      preload="metadata"
      playsinline
      class="w-full h-full"
      :class="{ 'blur-2xl scale-125 pointer-events-none': hidden }"
      :aria-hidden="hidden || undefined"
      @error="onVideoError" />
    <div
      v-else
      class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-theme-text-muted p-4 text-center">
      <PhFilmSlate class="w-7 h-7" />
      <template v-if="failed">
        <span>This video can't be played here.</span>
        <button type="button" class="text-theme-accent hover:underline" @click="$emit('download')">
          Download it
        </button>
      </template>
    </div>
    <SpoilerCover v-if="hidden" @reveal="$emit('reveal')" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { PhFilmSlate } from "@phosphor-icons/vue"
import SpoilerCover from "./SpoilerCover.vue"
import { useAttachmentUrl } from "@/services/attachments/urls"
import { debugWarn } from "@/utils/debug"
import type { TextAttachment } from "@/types/textChat"

const props = withDefaults(
  defineProps<{
    attachment: TextAttachment
    /** An unrevealed spoiler: blurred first frame under a cover. */
    hidden?: boolean
  }>(),
  { hidden: false },
)
defineEmits<{ menu: [event: MouseEvent]; download: []; reveal: [] }>()

const failed = ref(false)
let refetched = false
const { url, onError } = useAttachmentUrl(
  () => props.attachment.id,
  () => "original",
)

// An expired link is refetched once; a second error means the codec is
// unsupported (e.g. HEVC), so offer the download instead.
function onVideoError(event: Event) {
  if (!refetched) {
    refetched = true
    onError(event)
    return
  }
  const media = (event.target as HTMLVideoElement).error
  debugWarn(
    `[MediaCache] ${props.attachment.id}: video failed twice, showing download`,
    media ? `mediaError=${media.code} ${media.message}` : "",
  )
  failed.value = true
}

const MAX_W = 480
const MAX_H = 360
const boxStyle = computed(() => {
  const w = props.attachment.width || 16
  const h = props.attachment.height || 9
  const scale = Math.min(MAX_W / w, MAX_H / h)
  return { width: `${Math.round(w * scale)}px`, maxWidth: "100%", aspectRatio: `${w} / ${h}` }
})
</script>
