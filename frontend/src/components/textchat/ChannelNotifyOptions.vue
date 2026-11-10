<template>
  <div
    class="w-64 rounded-lg border border-theme-border bg-theme-bg-secondary shadow-lg py-1 text-sm"
    role="menu"
    data-testid="channel-notify-menu"
    @keydown.escape.stop="$emit('done')">
    <div
      v-if="muteLabel"
      class="px-3 py-2 text-xs text-theme-text-muted border-b border-theme-border">
      {{ muteLabel }}
    </div>
    <button
      v-if="mode === 'muted'"
      type="button"
      role="menuitem"
      :class="itemClass"
      data-testid="notify-unmute"
      @click="choose('all')">
      <PhBell class="w-4 h-4" />
      Unmute channel
    </button>
    <button
      v-else
      type="button"
      role="menuitem"
      :class="itemClass"
      data-testid="notify-mute"
      @click="openMute">
      <PhBellSlash class="w-4 h-4" />
      Mute channel…
    </button>
    <button
      type="button"
      role="menuitemradio"
      :aria-checked="mode === 'all'"
      :class="itemClass"
      data-testid="notify-all"
      @click="choose('all')">
      <PhCheck v-if="mode === 'all'" class="w-4 h-4 text-theme-accent" />
      <span v-else class="w-4" />
      Notify me about mentions
    </button>
    <button
      type="button"
      role="menuitemradio"
      :aria-checked="mode === 'no_mentions'"
      :class="itemClass"
      data-testid="notify-no-mentions"
      @click="choose('no_mentions')">
      <PhCheck v-if="mode === 'no_mentions'" class="w-4 h-4 text-theme-accent" />
      <span v-else class="w-4" />
      Disable mentions
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { PhBell, PhBellSlash, PhCheck } from "@phosphor-icons/vue"
import { describeMute, useTextNotifyStore } from "@/stores/textNotify"
import { useTextChatStore } from "@/stores"
import type { TextNotifyMode } from "@/types/textChat"

const props = defineProps<{ roomId: string }>()
const emit = defineEmits<{ done: [] }>()

const itemClass =
  "w-full flex items-center gap-2 px-3 py-1.5 text-left text-theme-text-secondary hover:bg-theme-bg-hover hover:text-theme-text-primary"

const notifyStore = useTextNotifyStore()
const textChatStore = useTextChatStore()
const mode = computed(() => notifyStore.modeOf(props.roomId))
const muteLabel = computed(() => describeMute(notifyStore.settingOf(props.roomId)))

async function choose(next: TextNotifyMode) {
  emit("done")
  try {
    await notifyStore.setMode(props.roomId, next)
  } catch {
    textChatStore.lastError = "Failed to change notification settings."
  }
}

function openMute() {
  emit("done")
  // The modal lives at the app root: this menu may sit in a popover.
  notifyStore.openMuteModal(props.roomId)
}
</script>
