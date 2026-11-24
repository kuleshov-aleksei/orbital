<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex bg-theme-backdrop"
      :class="isMobile ? 'items-end' : 'items-center justify-center p-4'"
      data-testid="poll-voters-modal"
      @click.self="$emit('close')"
      @keydown.escape.stop="$emit('close')">
      <div
        ref="panel"
        class="voters-panel flex flex-col w-full bg-theme-bg-secondary shadow-2xl"
        :class="
          isMobile
            ? 'max-h-[80dvh] rounded-t-2xl border-t border-theme-border'
            : 'max-w-md max-h-[80vh] rounded-xl'
        "
        role="dialog"
        aria-modal="true"
        aria-labelledby="poll-voters-title"
        tabindex="-1">
        <div
          v-if="isMobile"
          class="mx-auto mt-2 h-1 w-10 rounded-full bg-theme-border"
          aria-hidden="true" />
        <header class="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-theme-border">
          <div class="flex-1 min-w-0">
            <h2 id="poll-voters-title" class="text-base font-semibold text-theme-text-primary">
              Votes
            </h2>
            <EmojiText
              :text="poll.question"
              class="block text-sm text-theme-text-secondary truncate" />
          </div>
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover"
            aria-label="Close"
            @click="$emit('close')">
            <PhX class="w-5 h-5" />
          </button>
        </header>

        <!-- Option tabs -->
        <div
          class="flex gap-1.5 overflow-x-auto px-4 py-2.5 border-b border-theme-border"
          role="tablist">
          <button
            v-for="opt in poll.options"
            :key="opt.id"
            type="button"
            role="tab"
            :aria-selected="active === opt.id"
            class="flex-shrink-0 max-w-[12rem] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors"
            :class="
              active === opt.id
                ? 'bg-theme-accent border-theme-accent text-theme-text-on-accent'
                : 'border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'
            "
            data-testid="poll-voters-tab"
            @click="active = opt.id">
            <EmojiText :text="opt.text" class="truncate" />
            <span class="tabular-nums opacity-80">{{ opt.count ?? 0 }}</span>
          </button>
        </div>

        <ul class="flex-1 overflow-y-auto py-2" data-testid="poll-voters-list">
          <li
            v-for="uid in activeVoters"
            :key="uid"
            class="flex items-center gap-3 px-5 py-1.5"
            data-testid="poll-voter">
            <UserAvatar :user-id="uid" :size="32" :show-status="false" />
            <span
              class="text-sm font-medium text-theme-text-primary truncate"
              :style="permissionsStore.nameStyleOf(uid)"
              >{{ usersStore.displayName(uid) }}</span
            >
          </li>
          <li
            v-if="!activeVoters.length"
            class="px-5 py-6 text-center text-sm text-theme-text-muted">
            Nobody picked this answer.
          </li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue"
import { PhX } from "@phosphor-icons/vue"
import EmojiText from "@/components/common/EmojiText.vue"
import UserAvatar from "@/components/UserAvatar.vue"
import { pushBackHandler } from "@/services/backButton"
import { useAppStore, usePermissionsStore, useUsersStore } from "@/stores"
import type { TextPoll } from "@/types/textChat"

const props = defineProps<{ poll: TextPoll }>()
const emit = defineEmits<{ close: [] }>()

const appStore = useAppStore()
const usersStore = useUsersStore()
const permissionsStore = usePermissionsStore()
const isMobile = computed(() => appStore.isMobile)

// Start on the most picked answer.
const active = ref(
  [...props.poll.options].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0]?.id ?? "",
)
const activeVoters = computed(
  () => props.poll.options.find((o) => o.id === active.value)?.user_ids ?? [],
)

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
.voters-panel {
  padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
}
.voters-panel:focus-visible {
  outline: none;
}
</style>
