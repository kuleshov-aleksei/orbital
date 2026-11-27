<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex bg-theme-backdrop"
      :class="isMobile ? 'items-end' : 'items-center justify-center p-4'"
      data-testid="reactions-modal"
      @contextmenu.prevent
      @click.self="$emit('close')"
      @keydown.escape.stop="$emit('close')">
      <div
        ref="panel"
        class="reactions-panel flex flex-col w-full bg-theme-bg-secondary shadow-2xl select-none"
        :class="
          isMobile
            ? 'max-h-[80dvh] rounded-t-2xl border-t border-theme-border'
            : 'max-w-md max-h-[80vh] rounded-xl'
        "
        role="dialog"
        aria-modal="true"
        aria-labelledby="reactions-title"
        tabindex="-1">
        <div
          v-if="isMobile"
          class="mx-auto mt-2 h-1 w-10 rounded-full bg-theme-border"
          aria-hidden="true" />
        <header class="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-theme-border">
          <div class="flex-1 min-w-0">
            <h2 id="reactions-title" class="text-base font-semibold text-theme-text-primary">
              Reactions
            </h2>
            <span
              v-if="activeName"
              class="block text-sm text-theme-text-secondary truncate"
              data-testid="reactions-emoji-name"
              >{{ activeName }}</span
            >
          </div>
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover"
            aria-label="Close"
            @click="$emit('close')">
            <PhX class="w-5 h-5" />
          </button>
        </header>

        <!-- One tab per emoji -->
        <div
          class="flex gap-1.5 overflow-x-auto px-4 py-2.5 border-b border-theme-border"
          role="tablist">
          <button
            v-for="r in reactions"
            :key="r.emoji"
            type="button"
            role="tab"
            :aria-selected="active?.emoji === r.emoji"
            :aria-label="`${emojiName(r.emoji)}, ${r.user_ids.length}`"
            class="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors"
            :class="
              active?.emoji === r.emoji
                ? 'bg-theme-accent border-theme-accent text-theme-text-on-accent'
                : 'border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'
            "
            data-testid="reactions-tab"
            @click="activeEmoji = r.emoji">
            <EmojiGlyph :emoji-ref="r.emoji" :size="18" />
            <span class="tabular-nums opacity-80">{{ r.user_ids.length }}</span>
          </button>
        </div>

        <ul class="flex-1 overflow-y-auto py-2" data-testid="reactions-list">
          <li
            v-for="uid in activeUsers"
            :key="uid"
            class="flex items-center gap-3 px-5 py-1.5"
            data-testid="reactions-user">
            <UserAvatar :user-id="uid" :size="32" :show-status="false" />
            <span
              class="text-sm font-medium text-theme-text-primary truncate"
              :style="permissionsStore.nameStyleOf(uid)"
              >{{ uid === myUserId ? "You" : usersStore.displayName(uid) }}</span
            >
          </li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue"
import { PhX } from "@phosphor-icons/vue"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import UserAvatar from "@/components/UserAvatar.vue"
import { pushBackHandler } from "@/services/backButton"
import { emojiShortcode, resolveEmoji } from "@/services/emoji"
import { useAppStore, usePermissionsStore, useUsersStore } from "@/stores"
import { orderReactors } from "@/utils/reactions"
import type { TextReaction } from "@/types/textChat"

const props = defineProps<{
  /** Live reactions of the message; the parent closes the sheet when empty. */
  reactions: TextReaction[]
  initialEmoji: string
  myUserId: string
}>()
const emit = defineEmits<{ close: [] }>()

const appStore = useAppStore()
const usersStore = useUsersStore()
const permissionsStore = usePermissionsStore()
const isMobile = computed(() => appStore.isMobile)

const activeEmoji = ref(props.initialEmoji)
// Falls back to the first reaction once the selected emoji is removed.
const active = computed(
  () => props.reactions.find((r) => r.emoji === activeEmoji.value) ?? props.reactions[0] ?? null,
)
const activeUsers = computed(() =>
  active.value ? orderReactors(active.value.user_ids, props.myUserId) : [],
)

function emojiName(ref: string): string {
  const emoji = resolveEmoji(ref)
  return emoji ? `:${emojiShortcode(emoji.name)}:` : ref
}
const activeName = computed(() => (active.value ? emojiName(active.value.emoji) : ""))

const panel = useTemplateRef<HTMLDivElement>("panel")
let stopBack: (() => void) | null = null
onMounted(async () => {
  stopBack = pushBackHandler(() => emit("close"))
  await nextTick()
  panel.value?.focus()
})
onBeforeUnmount(() => stopBack?.())
</script>

<style scoped>
/* The sheet opens under the finger that is still pressing: without these,
   Android's own (later) long press selects the text under it. Nothing in the
   sheet needs copying. */
.reactions-panel {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
}
.reactions-panel:focus-visible {
  outline: none;
}
</style>
