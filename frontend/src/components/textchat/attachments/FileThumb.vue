<template>
  <div
    class="w-14 h-14 rounded-md overflow-hidden bg-theme-bg-tertiary flex items-center justify-center text-theme-text-muted">
    <img
      v-if="file.kind === 'image' && url"
      :src="url"
      :alt="file.filename"
      class="w-full h-full object-cover"
      loading="lazy"
      @error="onError" />
    <PhFilmSlate v-else-if="file.kind === 'video'" class="w-6 h-6" />
    <PhWaveform v-else-if="file.kind === 'audio'" class="w-6 h-6" />
    <PhImage v-else class="w-6 h-6" />
  </div>
</template>

<script setup lang="ts">
import { PhFilmSlate, PhImage, PhWaveform } from "@phosphor-icons/vue"
import { useAttachmentUrl } from "@/services/attachments/urls"
import type { TextAttachment } from "@/types/textChat"

const props = defineProps<{ file: TextAttachment }>()
const { url, onError } = useAttachmentUrl(
  () => (props.file.kind === "image" ? props.file.id : null),
  () => (props.file.has_thumb ? "thumb" : "original"),
)
</script>
