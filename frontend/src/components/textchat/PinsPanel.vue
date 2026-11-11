<template>
  <aside
    class="w-full md:w-96 flex-shrink-0 flex flex-col min-h-0 border-l border-theme-border bg-theme-bg-secondary"
    aria-label="Pinned messages"
    data-testid="pins-panel">
    <header class="flex items-center gap-2 px-4 h-12 flex-shrink-0 border-b border-theme-border">
      <PhPushPin class="w-4 h-4 text-theme-text-muted" />
      <h2 class="font-semibold text-sm text-theme-text-primary flex-1">Pinned messages</h2>
      <button
        type="button"
        class="w-7 h-7 flex items-center justify-center rounded hover:bg-theme-bg-hover text-theme-text-muted"
        aria-label="Close pinned messages"
        @click="$emit('close')">
        <PhX class="w-4 h-4" />
      </button>
    </header>
    <div class="flex-1 overflow-y-auto p-3 space-y-2">
      <div v-if="loading && !pins.length" class="flex justify-center py-6">
        <PhSpinner class="w-5 h-5 animate-spin text-theme-text-muted" />
      </div>
      <p v-else-if="!pins.length" class="text-sm text-theme-text-muted text-center py-6">
        No pinned messages yet.
      </p>
      <div
        v-for="m in pins"
        :key="m.id"
        class="group relative rounded-lg border border-theme-border bg-theme-bg-primary p-3 hover:border-theme-accent/60 transition-colors"
        data-testid="pinned-message">
        <div class="flex items-center gap-2 mb-1">
          <UserAvatar :user-id="m.sender_id" :size="20" :show-status="false" />
          <span
            class="text-sm font-semibold truncate"
            :style="permissionsStore.nameStyleOf(m.sender_id)"
            >{{ nameOf(m.sender_id) }}</span
          >
          <span
            class="text-[11px] text-theme-text-muted"
            :title="formatFullTime(m.created_at_ts)"
            >{{ formatMessageTime(m.created_at_ts) }}</span
          >
        </div>
        <div class="text-sm max-h-40 overflow-hidden">
          <MessageContent :content="m.content" :edited-at="m.edited_at_ts" />
        </div>
        <div class="flex gap-2 mt-2 text-xs">
          <button
            type="button"
            class="px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary"
            data-testid="pinned-jump"
            @click="$emit('jump', m.id)">
            Jump
          </button>
          <button
            v-if="canManage"
            type="button"
            class="px-2 py-1 rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-secondary"
            data-testid="pinned-unpin"
            @click="$emit('unpin', m.id)">
            Unpin
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { PhPushPin, PhSpinner, PhX } from "@phosphor-icons/vue"
import UserAvatar from "@/components/UserAvatar.vue"
import MessageContent from "./MessageContent.vue"
import { usePermissionsStore, useUsersStore } from "@/stores"
import { formatFullTime, formatMessageTime } from "@/utils/messageGrouping"
import type { TextMessage } from "@/types/textChat"

defineProps<{ pins: TextMessage[]; loading: boolean; canManage: boolean }>()
defineEmits<{ close: []; jump: [messageId: string]; unpin: [messageId: string] }>()

const usersStore = useUsersStore()
const permissionsStore = usePermissionsStore()

function nameOf(userId: string): string {
  return usersStore.displayName(userId)
}
</script>
