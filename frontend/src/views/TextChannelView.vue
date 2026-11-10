<template>
  <section
    class="flex-1 flex flex-col min-h-0 min-w-0 bg-theme-bg-primary"
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
      <h1
        class="font-semibold text-theme-text-primary truncate min-w-0"
        data-testid="text-channel-title">
        <EmojiText :text="channel.name" pausable />
      </h1>
      <span
        v-if="!textChatStore.available"
        class="text-xs px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-200 flex-shrink-0">
        Chat unavailable
      </span>

      <div class="ml-auto flex items-center gap-1 flex-shrink-0">
        <ChannelNotifyMenu :room-id="channel.id" />
        <button
          type="button"
          :class="[headerBtn, textChatStore.sidePanel === 'pins' ? headerBtnActive : '']"
          title="Pinned messages"
          aria-label="Pinned messages"
          :aria-pressed="textChatStore.sidePanel === 'pins'"
          data-testid="pins-button"
          @click="textChatStore.toggleSidePanel('pins')">
          <PhPushPin class="w-5 h-5" />
        </button>
        <SearchBox
          v-if="!appStore.isMobile || textChatStore.sidePanel === 'search'"
          ref="searchBox"
          class="ml-1"
          @open="textChatStore.sidePanel = 'search'"
          @close="onSearchClosed" />
        <button
          v-else
          type="button"
          :class="headerBtn"
          title="Search"
          aria-label="Search"
          @click="openSearch">
          <PhMagnifyingGlass class="w-5 h-5" />
        </button>
        <button
          v-if="appStore.isMobile"
          type="button"
          :class="headerBtn"
          title="Members"
          aria-label="Members"
          @click="appStore.toggleMobileUserSidebar()">
          <PhUsers class="w-5 h-5" />
        </button>
      </div>
    </header>

    <div class="flex-1 flex min-h-0">
      <div
        v-show="!(appStore.isMobile && textChatStore.sidePanel)"
        class="flex-1 flex flex-col min-h-0 min-w-0">
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
        <TypingIndicator :room-id="channel.id" />
      </div>

      <PinsPanel
        v-if="textChatStore.sidePanel === 'pins'"
        :pins="textChatStore.pins[channel.id] ?? []"
        :loading="textChatStore.pinsLoading"
        :can-manage="canManage"
        @close="textChatStore.closeSidePanel()"
        @jump="jumpFromPanel(channel.id, $event)"
        @unpin="(id) => textChatStore.setPinned(id, false)" />
      <SearchPanel
        v-else-if="textChatStore.sidePanel === 'search'"
        @close="textChatStore.closeSidePanel()"
        @jump="(m) => jumpFromPanel(m.room_id, m.id)" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue"
import {
  PhArrowLeft,
  PhHash,
  PhMagnifyingGlass,
  PhPushPin,
  PhUsers,
  PhX,
} from "@phosphor-icons/vue"
import EmojiText from "@/components/common/EmojiText.vue"
import MessageList from "@/components/textchat/MessageList.vue"
import MessageComposer from "@/components/textchat/MessageComposer.vue"
import ChannelNotifyMenu from "@/components/textchat/ChannelNotifyMenu.vue"
import PinsPanel from "@/components/textchat/PinsPanel.vue"
import SearchBox from "@/components/textchat/SearchBox.vue"
import SearchPanel from "@/components/textchat/SearchPanel.vue"
import TypingIndicator from "@/components/textchat/TypingIndicator.vue"
import { useAppStore, usePermissionsStore, useTextChatStore, useUserStore } from "@/stores"
import { Permission } from "@/types/permissions"
import type { Room } from "@/types"

const props = defineProps<{ channel: Room }>()

const headerBtn =
  "w-8 h-8 flex items-center justify-center rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover transition-colors"
const headerBtnActive = "text-theme-text-primary bg-theme-bg-hover"

const textChatStore = useTextChatStore()
const permissionsStore = usePermissionsStore()
const userStore = useUserStore()
const appStore = useAppStore()
const composer = useTemplateRef<InstanceType<typeof MessageComposer>>("composer")
const searchBox = useTemplateRef<InstanceType<typeof SearchBox>>("searchBox")

const view = computed(() => textChatStore.views[props.channel.id] ?? null)

// UX hints only; the backend checks every send/delete/pin.
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
  // Inner handlers (edit box, picker, reply bar, search) prevent first.
  if (event.defaultPrevented) return
  textChatStore.markChannelRead(props.channel.id)
}

function backToList() {
  textChatStore.closeChannel()
  appStore.showRoomsView()
}

async function openSearch() {
  textChatStore.sidePanel = "search"
  await nextTick()
  searchBox.value?.focus()
}

function onSearchClosed() {
  if (textChatStore.sidePanel === "search") textChatStore.closeSidePanel()
}

function jumpFromPanel(roomId: string, messageId: string) {
  if (appStore.isMobile) textChatStore.closeSidePanel()
  void textChatStore.openChannelAt(roomId, messageId)
}

// Ctrl/Cmd+F focuses the search box while a text channel is open.
function onGlobalKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f") {
    event.preventDefault()
    void openSearch()
  }
}

onMounted(() => {
  composer.value?.focus()
  window.addEventListener("keydown", onGlobalKeydown)
})
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown))
watch(
  () => props.channel.id,
  () => composer.value?.focus(),
)
</script>
