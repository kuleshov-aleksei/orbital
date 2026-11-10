<template>
  <aside
    class="w-full md:w-96 flex-shrink-0 flex flex-col min-h-0 border-l border-theme-border bg-theme-bg-secondary"
    aria-label="Search results"
    data-testid="search-panel">
    <header
      class="flex items-center gap-2 px-4 h-12 flex-shrink-0 border-b border-theme-border text-sm">
      <span class="font-semibold text-theme-text-primary flex-1 truncate" aria-live="polite">
        <template v-if="search.loading">Searching…</template>
        <template v-else-if="search.shownQuery">
          {{ search.total >= 1000 ? "1000+" : `≈${search.total}` }}
          {{ search.total === 1 ? "result" : "results" }}
        </template>
        <template v-else>Search</template>
      </span>
      <div
        class="flex rounded-md bg-theme-bg-tertiary p-0.5 text-xs"
        role="group"
        aria-label="Sort">
        <button
          v-for="opt in SORTS"
          :key="opt.value"
          type="button"
          class="px-2 py-0.5 rounded"
          :class="
            search.sort === opt.value
              ? 'bg-theme-bg-hover text-theme-text-primary'
              : 'text-theme-text-muted hover:text-theme-text-primary'
          "
          :aria-pressed="search.sort === opt.value"
          @click="search.setSort(opt.value)">
          {{ opt.label }}
        </button>
      </div>
      <button
        type="button"
        class="w-7 h-7 flex items-center justify-center rounded hover:bg-theme-bg-hover text-theme-text-muted"
        aria-label="Close search"
        @click="$emit('close')">
        <PhX class="w-4 h-4" />
      </button>
    </header>

    <div class="flex-1 overflow-y-auto p-3 space-y-2" @scroll.passive="onScroll">
      <p
        v-for="hint in search.hints"
        :key="hint"
        class="text-xs px-3 py-2 rounded-md bg-amber-900/30 text-amber-200">
        {{ hint }}
      </p>
      <p v-if="search.error" class="text-sm text-red-400 text-center py-4">{{ search.error }}</p>
      <div v-else-if="search.loading && !search.hits.length" class="flex justify-center py-6">
        <PhSpinner class="w-5 h-5 animate-spin text-theme-text-muted" />
      </div>
      <div
        v-else-if="!search.shownQuery"
        class="text-sm text-theme-text-muted space-y-1.5 px-1 py-2">
        <p class="font-semibold text-theme-text-secondary">Search filters</p>
        <p><code class="text-theme-text-primary">from:</code> a member</p>
        <p><code class="text-theme-text-primary">in:</code> a channel</p>
        <p><code class="text-theme-text-primary">mentions:</code> a member</p>
        <p>
          <code class="text-theme-text-primary">during:</code> /
          <code class="text-theme-text-primary">before:</code> /
          <code class="text-theme-text-primary">after:</code> 2026-11-10, 2026-11, today, yesterday
        </p>
        <p><code class="text-theme-text-primary">pinned:true</code></p>
        <p>Use "quotes" for an exact phrase.</p>
      </div>
      <p
        v-else-if="!search.hits.length && !search.hints.length"
        class="text-sm text-theme-text-muted text-center py-6">
        No messages found.
      </p>

      <button
        v-for="hit in search.hits"
        :key="hit.message.id"
        type="button"
        class="w-full text-left rounded-lg border border-theme-border bg-theme-bg-primary p-3 hover:border-theme-accent/60 transition-colors"
        data-testid="search-hit"
        @click="$emit('jump', hit.message)">
        <div class="flex items-center gap-1.5 text-[11px] text-theme-text-muted mb-1">
          <PhHash class="w-3 h-3" />
          <EmojiText :text="channelName(hit.message.room_id)" class="truncate" />
        </div>
        <div class="flex items-center gap-2 mb-1">
          <UserAvatar :user-id="hit.message.sender_id" :size="20" :show-status="false" />
          <span
            class="text-sm font-semibold truncate"
            :style="permissionsStore.nameStyleOf(hit.message.sender_id)"
            >{{ nameOf(hit.message.sender_id) }}</span
          >
          <span
            class="text-[11px] text-theme-text-muted"
            :title="formatFullTime(hit.message.created_at_ts)"
            >{{ formatMessageTime(hit.message.created_at_ts) }}</span
          >
        </div>
        <div class="text-sm max-h-32 overflow-hidden">
          <MessageContent v-if="hit.snippet" :content="hit.snippet" highlight />
          <MessageContent v-else :content="hit.message.content" />
        </div>
      </button>

      <div v-if="search.loadingMore" class="flex justify-center py-3">
        <PhSpinner class="w-5 h-5 animate-spin text-theme-text-muted" />
      </div>
      <button
        v-else-if="search.hits.length && search.hits.length < search.total"
        type="button"
        class="w-full py-2 text-sm text-theme-accent hover:underline"
        @click="search.loadMore()">
        Load more
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { PhHash, PhSpinner, PhX } from "@phosphor-icons/vue"
import EmojiText from "@/components/common/EmojiText.vue"
import UserAvatar from "@/components/UserAvatar.vue"
import MessageContent from "./MessageContent.vue"
import { usePermissionsStore, useRoomStore, useTextSearchStore, useUsersStore } from "@/stores"
import { formatFullTime, formatMessageTime } from "@/utils/messageGrouping"
import type { TextMessage, TextSearchSort } from "@/types/textChat"

defineEmits<{ close: []; jump: [message: TextMessage] }>()

const SORTS: { value: TextSearchSort; label: string }[] = [
  { value: "relevance", label: "Relevant" },
  { value: "newest", label: "Newest" },
]

const search = useTextSearchStore()
const usersStore = useUsersStore()
const roomStore = useRoomStore()
const permissionsStore = usePermissionsStore()

function nameOf(userId: string): string {
  return usersStore.allUsers.find((u) => u.id === userId)?.nickname ?? "Unknown user"
}

function channelName(roomId: string): string {
  return roomStore.rooms.find((r) => r.id === roomId)?.name ?? "unknown"
}

function onScroll(event: Event) {
  const el = event.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) search.loadMore()
}
</script>
