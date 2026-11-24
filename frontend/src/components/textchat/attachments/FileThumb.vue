<template>
  <div
    class="relative rounded-md overflow-hidden bg-theme-bg-tertiary flex items-center justify-center text-theme-text-muted flex-shrink-0"
    :class="sizeClass">
    <img
      v-if="file.kind === 'image' && url"
      :src="url"
      :alt="file.spoiler ? '' : file.filename"
      class="w-full h-full object-cover"
      :class="{ 'blur-md scale-125': file.spoiler }"
      loading="lazy"
      @error="onError" />
    <template v-else-if="file.kind === 'video' && url && !videoFailed">
      <!-- No server poster (CHAT_SYSTEM.md §7.12): show the first frame. -->
      <video
        :src="`${url}#t=0.1`"
        preload="metadata"
        muted
        playsinline
        disablepictureinpicture
        class="w-full h-full object-cover pointer-events-none"
        :class="{ 'blur-md scale-125': file.spoiler }"
        @error="onVideoError" />
      <span
        class="absolute inset-0 m-auto w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white">
        <PhPlay weight="fill" class="w-3 h-3" />
      </span>
    </template>
    <PhFilmSlate v-else-if="file.kind === 'video'" class="w-6 h-6" />
    <PhWaveform v-else-if="file.kind === 'audio'" class="w-6 h-6" />
    <PhImage v-else class="w-6 h-6" />
    <span
      v-if="file.spoiler && url"
      class="absolute inset-0 flex items-center justify-center bg-black/30 text-white"
      title="Spoiler">
      <PhEyeSlash class="w-4 h-4" weight="bold" />
    </span>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { PhEyeSlash, PhFilmSlate, PhImage, PhPlay, PhWaveform } from "@phosphor-icons/vue"
import { useAttachmentUrl } from "@/services/attachments/urls"
import type { TextAttachment } from "@/types/textChat"

const props = withDefaults(defineProps<{ file: TextAttachment; sizeClass?: string }>(), {
  sizeClass: "w-14 h-14",
})

const { url, onError } = useAttachmentUrl(
  () => (props.file.kind === "image" || props.file.kind === "video" ? props.file.id : null),
  () => (props.file.kind === "image" && props.file.has_thumb ? "thumb" : "original"),
)

// An expired link is refetched once; a second error means the browser can't
// decode it (e.g. HEVC), so fall back to the icon.
const videoFailed = ref(false)
let refetched = false
function onVideoError(event: Event) {
  if (!refetched) {
    refetched = true
    onError(event)
    return
  }
  videoFailed.value = true
}
</script>
