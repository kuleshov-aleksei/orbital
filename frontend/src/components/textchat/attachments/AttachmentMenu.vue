<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[90]"
      @pointerdown="$emit('close')"
      @contextmenu.prevent="$emit('close')" />
    <div
      ref="menu"
      class="fixed z-[91] min-w-[220px] py-1 rounded-lg border border-theme-border bg-theme-bg-secondary shadow-xl text-sm"
      :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
      role="menu"
      :aria-label="`Actions for ${attachment.filename}`"
      data-testid="attachment-menu"
      @keydown.escape.prevent.stop="$emit('close')">
      <div class="px-3 py-1.5 text-xs text-theme-text-muted truncate max-w-[280px]">
        {{ attachment.filename }} · {{ formatBytes(attachment.size) }}
      </div>
      <button type="button" role="menuitem" :class="item" @click="act('open')">
        <PhArrowSquareOut class="w-4 h-4" /> Open
      </button>
      <button type="button" role="menuitem" :class="item" @click="act('download')">
        <PhDownloadSimple class="w-4 h-4" /> Download
      </button>
      <template v-if="isOwn">
        <div class="my-1 border-t border-theme-border" />
        <button
          type="button"
          role="menuitem"
          :class="item"
          data-testid="attachment-protect"
          @click="act('protect')">
          <template v-if="attachment.protected">
            <PhLockOpen class="w-4 h-4" /> Allow auto-removal
          </template>
          <template v-else> <PhLock class="w-4 h-4" /> Protect from auto-removal </template>
        </button>
        <button type="button" role="menuitem" :class="item" @click="act('storage')">
          <PhHardDrives class="w-4 h-4" /> Manage my storage
        </button>
      </template>
      <template v-if="isOwn || canManage">
        <div class="my-1 border-t border-theme-border" />
        <button
          type="button"
          role="menuitem"
          :class="[item, '!text-red-400']"
          data-testid="attachment-delete"
          @click="onDelete">
          <PhTrash class="w-4 h-4" />
          {{ confirming ? "Click again to delete the file" : "Delete file" }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onMounted, reactive, ref, useTemplateRef } from "vue"
import {
  PhArrowSquareOut,
  PhDownloadSimple,
  PhHardDrives,
  PhLock,
  PhLockOpen,
  PhTrash,
} from "@phosphor-icons/vue"
import { formatBytes } from "@/utils/formatBytes"
import type { TextAttachment } from "@/types/textChat"

export type AttachmentAction = "open" | "download" | "protect" | "storage" | "delete"

const props = defineProps<{
  attachment: TextAttachment
  x: number
  y: number
  isOwn: boolean
  canManage: boolean
}>()
const emit = defineEmits<{ close: []; action: [action: AttachmentAction] }>()

const item =
  "w-full flex items-center gap-2 px-3 py-1.5 text-left text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"

const menu = useTemplateRef<HTMLDivElement>("menu")
const pos = reactive({ x: props.x, y: props.y })
const confirming = ref(false)

onMounted(async () => {
  await nextTick()
  const el = menu.value
  if (!el) return
  // Keep the menu on screen.
  const r = el.getBoundingClientRect()
  pos.x = Math.max(8, Math.min(props.x, window.innerWidth - r.width - 8))
  pos.y = Math.max(8, Math.min(props.y, window.innerHeight - r.height - 8))
  el.querySelector<HTMLButtonElement>("button")?.focus()
})

function act(action: AttachmentAction) {
  emit("action", action)
  emit("close")
}

function onDelete() {
  if (!confirming.value) {
    confirming.value = true
    return
  }
  act("delete")
}
</script>
