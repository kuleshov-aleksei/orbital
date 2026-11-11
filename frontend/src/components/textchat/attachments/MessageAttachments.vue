<template>
  <div class="mt-1 flex flex-col gap-1.5 items-start max-w-full" data-testid="message-attachments">
    <!-- Images: one sized by aspect ratio, several in a grid -->
    <div
      v-if="images.length"
      :class="images.length === 1 ? 'max-w-full' : 'grid grid-cols-2 gap-1 w-full max-w-[400px]'">
      <div v-for="(img, i) in images" :key="img.id" class="relative group/att max-w-full">
        <AttachmentImageTile
          :attachment="img"
          :single="images.length === 1"
          @open="lightboxIndex = i"
          @menu="(e) => openMenu(img, e)" />
        <div class="absolute top-1 right-1 flex gap-1">
          <PhLock
            v-if="img.protected"
            class="w-5 h-5 p-0.5 rounded bg-black/60 text-white"
            weight="fill"
            aria-label="Protected from auto-removal" />
          <button
            v-if="!pending"
            type="button"
            class="w-6 h-6 hidden group-hover/att:flex items-center justify-center rounded bg-black/60 text-white hover:bg-black/80"
            aria-label="File actions"
            @click.stop="(e) => openMenu(img, e)">
            <PhDotsThree class="w-4 h-4" weight="bold" />
          </button>
        </div>
      </div>
    </div>

    <template v-for="att in others" :key="att.id">
      <AttachmentVideo
        v-if="att.kind === 'video'"
        :attachment="att"
        @menu="(e) => openMenu(att, e)"
        @download="openAttachment(att.id, 'download')" />
      <AttachmentAudio v-else :attachment="att" @menu="(e) => openMenu(att, e)" />
      <!-- File row -->
      <div class="flex items-center gap-2 text-xs text-theme-text-muted max-w-full -mt-1">
        <PhLock v-if="att.protected" class="w-3.5 h-3.5" weight="fill" aria-label="Protected" />
        <span v-if="att.kind === 'video'" class="truncate">{{ att.filename }}</span>
        <span>{{ formatBytes(att.size) }}</span>
        <button
          v-if="!pending"
          type="button"
          class="hover:text-theme-text-primary"
          :aria-label="`Download ${att.filename}`"
          title="Download"
          @click="openAttachment(att.id, 'download')">
          <PhDownloadSimple class="w-3.5 h-3.5" />
        </button>
        <button
          v-if="!pending"
          type="button"
          class="hover:text-theme-text-primary"
          aria-label="File actions"
          @click="(e) => openMenu(att, e)">
          <PhDotsThree class="w-4 h-4" weight="bold" />
        </button>
      </div>
    </template>

    <!-- Removed files -->
    <div
      v-for="att in removed"
      :key="att.id"
      class="flex items-center gap-1.5 text-xs italic text-theme-text-muted"
      data-testid="attachment-tombstone">
      <PhPaperclip class="w-3.5 h-3.5" />
      <span class="truncate max-w-[min(280px,50vw)]">{{ att.filename }}</span>
      <span>— removed ({{ removedLabel(att) }})</span>
    </div>

    <p v-if="actionError" class="text-xs text-red-400">{{ actionError }}</p>

    <AttachmentMenu
      v-if="menu"
      :attachment="menu.attachment"
      :x="menu.x"
      :y="menu.y"
      :is-own="isOwn"
      :can-manage="canManage"
      @action="onAction"
      @close="menu = null" />
    <AttachmentLightbox
      v-if="lightboxIndex !== null"
      :images="images"
      :start-index="lightboxIndex"
      @close="lightboxIndex = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { PhDotsThree, PhDownloadSimple, PhLock, PhPaperclip } from "@phosphor-icons/vue"
import AttachmentImageTile from "./AttachmentImageTile.vue"
import AttachmentVideo from "./AttachmentVideo.vue"
import AttachmentAudio from "./AttachmentAudio.vue"
import AttachmentLightbox from "./AttachmentLightbox.vue"
import AttachmentMenu, { type AttachmentAction } from "./AttachmentMenu.vue"
import { apiService } from "@/services/api"
import { forgetAttachmentUrls, openAttachment, openStoragePage } from "@/services/attachments/urls"
import { formatBytes } from "@/utils/formatBytes"
import type { TextAttachment } from "@/types/textChat"

const props = withDefaults(
  defineProps<{
    attachments: TextAttachment[]
    /** The viewer uploaded these files (the message author). */
    isOwn?: boolean
    /** ManageMessages in the channel: may delete others' files. */
    canManage?: boolean
    /** Optimistic message: no actions yet. */
    pending?: boolean
  }>(),
  { isOwn: false, canManage: false, pending: false },
)

const live = computed(() => props.attachments.filter((a) => !a.removed))
const images = computed(() => live.value.filter((a) => a.kind === "image"))
const others = computed(() => live.value.filter((a) => a.kind !== "image"))
const removed = computed(() => props.attachments.filter((a) => a.removed))

const lightboxIndex = ref<number | null>(null)
const menu = ref<{ attachment: TextAttachment; x: number; y: number } | null>(null)
const actionError = ref<string | null>(null)

function openMenu(attachment: TextAttachment, e: MouseEvent) {
  if (props.pending) return
  menu.value = { attachment, x: e.clientX, y: e.clientY }
}

function removedLabel(att: TextAttachment): string {
  switch (att.removed) {
    case "quota":
      return "storage limit"
    case "moderator":
      return "by a moderator"
    default:
      return "by uploader"
  }
}

async function onAction(action: AttachmentAction) {
  const att = menu.value?.attachment
  if (!att) return
  actionError.value = null
  try {
    switch (action) {
      case "open":
        if (att.kind === "image")
          lightboxIndex.value = images.value.findIndex((a) => a.id === att.id)
        else await openAttachment(att.id, "original")
        break
      case "download":
        await openAttachment(att.id, "download")
        break
      case "protect":
        // The message updates through text_message_updated.
        await apiService.setAttachmentProtected(att.id, !att.protected)
        break
      case "storage":
        openStoragePage()
        break
      case "delete":
        await apiService.deleteAttachment(att.id)
        forgetAttachmentUrls(att.id)
        break
    }
  } catch {
    actionError.value =
      action === "delete" ? "The file could not be deleted." : "That didn't work. Try again."
  }
}
</script>
