<template>
  <section
    class="flex-1 flex flex-col min-h-0 bg-theme-bg-primary"
    data-testid="text-channel-view"
    @keydown.escape="onEscape">
    <header
      class="flex items-center gap-3 px-4 h-14 flex-shrink-0 border-b border-theme-border bg-theme-bg-secondary">
      <button
        v-if="appStore.isMobile"
        type="button"
        class="text-theme-text-muted hover:text-theme-text-primary"
        title="Back to channel list"
        data-testid="back-to-rooms"
        @click="backToList">
        <PhArrowLeft class="w-5 h-5" />
      </button>
      <PhHash class="w-5 h-5 text-theme-text-muted flex-shrink-0" />
      <h1 class="font-semibold text-theme-text-primary truncate" data-testid="text-channel-title">
        <EmojiText :text="channel.name" pausable />
      </h1>
      <span
        v-if="!textChatStore.available"
        class="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-200">
        Chat unavailable
      </span>
      <button
        v-if="appStore.isMobile"
        type="button"
        class="text-theme-text-muted hover:text-theme-text-primary"
        :class="{ 'ml-auto': textChatStore.available }"
        title="Members"
        @click="appStore.toggleMobileUserSidebar()">
        <PhUsers class="w-5 h-5" />
      </button>
    </header>

    <MessageList
      v-if="view"
      :room-id="channel.id"
      :channel-name="channel.name"
      :view="view"
      :pending="textChatStore.activePending"
      :my-user-id="userStore.userId ?? ''"
      :can-manage="canManage"
      :can-send="canSend" />

    <div
      v-if="textChatStore.lastError"
      class="mx-4 mb-1 px-3 py-1.5 rounded-md bg-red-900/50 border border-red-800 text-xs text-red-200 flex items-center gap-2"
      role="alert">
      <span class="flex-1">{{ textChatStore.lastError }}</span>
      <button type="button" aria-label="Dismiss" @click="textChatStore.clearError()">
        <PhX class="w-3.5 h-3.5" />
      </button>
    </div>

    <MessageComposer
      ref="composer"
      :room-id="channel.id"
      :channel-name="channel.name"
      :can-send="canSend"
      :my-user-id="userStore.userId ?? ''"
      @edit-last="editLast"
      @escape="textChatStore.markChannelRead(channel.id)" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from "vue"
import { PhArrowLeft, PhHash, PhUsers, PhX } from "@phosphor-icons/vue"
import EmojiText from "@/components/common/EmojiText.vue"
import MessageList from "@/components/textchat/MessageList.vue"
import MessageComposer from "@/components/textchat/MessageComposer.vue"
import { useAppStore, usePermissionsStore, useTextChatStore, useUserStore } from "@/stores"
import { Permission } from "@/types/permissions"
import type { Room } from "@/types"

const props = defineProps<{ channel: Room }>()

const textChatStore = useTextChatStore()
const permissionsStore = usePermissionsStore()
const userStore = useUserStore()
const appStore = useAppStore()
const composer = useTemplateRef<InstanceType<typeof MessageComposer>>("composer")

const view = computed(() => textChatStore.views[props.channel.id] ?? null)

// UX hints only; the backend checks every send/delete.
const canSend = computed(() =>
  permissionsStore.can(Permission.SendMessages, { roomId: props.channel.id }),
)
const canManage = computed(() =>
  permissionsStore.can(Permission.ManageMessages, { roomId: props.channel.id }),
)

function editLast() {
  const mine = view.value?.messages.filter((m) => m.sender_id === userStore.userId)
  const last = mine?.[mine.length - 1]
  if (last) textChatStore.startEdit(last.id)
}

function onEscape(event: KeyboardEvent) {
  // Inner handlers (edit box, picker, reply bar) stop propagation first.
  if (event.defaultPrevented) return
  textChatStore.markChannelRead(props.channel.id)
}

function backToList() {
  textChatStore.closeChannel()
  appStore.showRoomsView()
}

onMounted(() => composer.value?.focus())
watch(
  () => props.channel.id,
  () => composer.value?.focus(),
)
</script>
