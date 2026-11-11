<template>
  <div class="flex flex-wrap gap-2 px-3 pt-2" data-testid="composer-uploads">
    <div
      v-for="u in uploads"
      :key="u.localId"
      class="relative w-28 rounded-md border bg-theme-bg-secondary overflow-hidden"
      :class="u.status === 'error' ? 'border-red-500/60' : 'border-theme-border'"
      data-testid="composer-upload">
      <div class="h-16 flex items-center justify-center bg-theme-bg-tertiary text-theme-text-muted">
        <img v-if="u.previewUrl" :src="u.previewUrl" alt="" class="w-full h-full object-cover" />
        <PhFilmSlate v-else-if="u.kind === 'video'" class="w-7 h-7" />
        <PhWaveform v-else class="w-7 h-7" />
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
        <div v-else class="text-[10px] text-theme-text-muted">{{ formatBytes(u.file.size) }}</div>
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
        type="button"
        class="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
        :aria-label="`Remove ${u.file.name}`"
        @click="store.remove(u.localId)">
        <PhX class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PhFilmSlate, PhWaveform, PhX } from "@phosphor-icons/vue"
import { useAttachmentsStore, type ComposerUpload } from "@/stores/attachments"
import { formatBytes } from "@/utils/formatBytes"

defineProps<{ uploads: ComposerUpload[] }>()
const store = useAttachmentsStore()
</script>
