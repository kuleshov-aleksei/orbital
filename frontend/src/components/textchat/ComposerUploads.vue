<template>
  <div class="flex flex-wrap gap-2 px-3 pt-2" data-testid="composer-uploads">
    <div
      v-for="u in uploads"
      :key="u.localId"
      class="relative w-28 rounded-md border bg-theme-bg-secondary overflow-hidden"
      :class="u.status === 'error' ? 'border-red-500/60' : 'border-theme-border'"
      data-testid="composer-upload">
      <div
        class="relative h-16 flex items-center justify-center overflow-hidden bg-theme-bg-tertiary text-theme-text-muted">
        <img
          v-if="u.previewUrl"
          :src="u.previewUrl"
          alt=""
          class="w-full h-full object-cover"
          :class="{ 'blur-md scale-125': u.spoiler }" />
        <PhFilmSlate v-else-if="u.kind === 'video'" class="w-7 h-7" />
        <PhWaveform v-else class="w-7 h-7" />
        <span
          v-if="u.spoiler"
          class="absolute bottom-1 left-1 px-1 rounded bg-black/70 text-[9px] font-bold tracking-wider text-white"
          >SPOILER</span
        >
        <span
          v-if="u.edit"
          class="absolute bottom-1 right-1 px-1 rounded bg-black/70 text-[9px] font-semibold text-white"
          >Edited</span
        >
      </div>
      <div class="px-1.5 py-1">
        <div class="text-[11px] truncate text-theme-text-primary" :title="u.file.name">
          {{ u.file.name }}
        </div>
        <div
          v-if="u.status === 'error'"
          class="text-[10px] text-red-400 leading-tight"
          :title="u.error ?? ''">
          {{ u.error }}
          <button type="button" class="underline ml-0.5" @click="store.retry(u.localId)">
            Retry
          </button>
        </div>
        <div v-else class="text-[10px] text-theme-text-muted">
          {{ formatBytes(u.sentBytes ?? u.file.size) }}
        </div>
      </div>
      <div
        v-if="u.status === 'uploading'"
        class="absolute left-0 bottom-0 h-0.5 bg-theme-accent transition-[width]"
        :style="{ width: `${Math.round(u.progress * 100)}%` }"
        role="progressbar"
        :aria-valuenow="Math.round(u.progress * 100)"
        aria-valuemin="0"
        aria-valuemax="100" />
      <button
        v-if="canSendOriginal(u)"
        type="button"
        class="absolute top-1 left-1 h-5 px-1.5 rounded-full text-[10px] font-semibold leading-none transition-colors"
        :class="
          u.original ? 'bg-theme-accent text-white' : 'bg-black/60 text-white/70 hover:text-white'
        "
        :aria-pressed="u.original"
        :title="hdTitle(u)"
        data-testid="composer-upload-hd"
        @click="store.setOriginal(u.localId, !u.original)">
        HD
      </button>
      <button
        v-if="canSpoiler(u)"
        type="button"
        class="absolute top-1 w-5 h-5 flex items-center justify-center rounded-full transition-colors"
        :class="[
          canEdit(u) ? 'right-[3.25rem]' : 'right-7',
          u.spoiler ? 'bg-theme-accent text-white' : 'bg-black/60 text-white/70 hover:text-white',
        ]"
        :aria-pressed="u.spoiler"
        :aria-label="u.spoiler ? `Show ${u.file.name} normally` : `Mark ${u.file.name} as spoiler`"
        :title="u.spoiler ? 'Spoiler: hidden until clicked. Click to undo.' : 'Mark as spoiler'"
        data-testid="composer-upload-spoiler"
        @click="store.setSpoiler(u.localId, !u.spoiler)">
        <PhEyeSlash class="w-3 h-3" weight="bold" />
      </button>
      <button
        v-if="canEdit(u)"
        type="button"
        class="absolute top-1 right-7 w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white/70 hover:text-white"
        :aria-label="`Crop or rotate ${u.file.name}`"
        title="Crop / rotate"
        data-testid="composer-upload-edit"
        @click="editing = u.localId">
        <PhCrop class="w-3 h-3" weight="bold" />
      </button>
      <button
        type="button"
        class="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
        :aria-label="`Remove ${u.file.name}`"
        @click="store.remove(u.localId)">
        <PhX class="w-3 h-3" />
      </button>
    </div>
    <ImageEditModal v-if="editingUpload" :upload="editingUpload" @close="editing = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { PhCrop, PhEyeSlash, PhFilmSlate, PhWaveform, PhX } from "@phosphor-icons/vue"
import ImageEditModal from "./ImageEditModal.vue"
import {
  canEdit,
  canSendOriginal,
  canSpoiler,
  useAttachmentsStore,
  type ComposerUpload,
} from "@/stores/attachments"
import { formatBytes } from "@/utils/formatBytes"

const props = defineProps<{ uploads: ComposerUpload[] }>()
const store = useAttachmentsStore()

/** The upload open in the image editor (closes if it is removed or sent). */
const editing = ref<string | null>(null)
const editingUpload = computed(() => props.uploads.find((u) => u.localId === editing.value))

function hdTitle(u: ComposerUpload): string {
  const full = formatBytes(u.file.size)
  if (u.original) return `Sending in original quality (${full}). Click to compress.`
  const sent =
    u.sentBytes !== null && u.sentBytes < u.file.size ? ` to ${formatBytes(u.sentBytes)}` : ""
  return `Compressed${sent}. Click to send in original quality (${full}).`
}
</script>
