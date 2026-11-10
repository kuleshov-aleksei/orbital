import { defineStore } from "pinia"
import { computed, ref, watch } from "vue"
import { apiService } from "@/services/api"
import { wsService } from "@/services/websocket"
import { useRoomStore } from "./room"
import { useUserStore } from "./user"
import type {
  TextErrorEvent,
  TextHistoryPage,
  TextMessage,
  TextMessageDeletedEvent,
  TextMessageNewEvent,
  TextMessageUpdatedEvent,
  TextReadStateEvent,
} from "@/types/textChat"

/** Messages kept in memory per channel; the far end is trimmed beyond this. */
export const MAX_MESSAGES_IN_MEMORY = 300
const PAGE_SIZE = 50
const READ_DEBOUNCE_MS = 1000
const SEND_TIMEOUT_MS = 15000

/** An optimistic message: shown dimmed until the server echoes its nonce. */
export interface PendingTextMessage {
  nonce: string
  room_id: string
  content: string
  reply_to_id: string | null
  reply_ping: boolean
  created_at_ts: number
  status: "sending" | "failed"
  error?: string
}

/** Where the message list should scroll after a load or jump. */
export type ScrollRequest =
  { kind: "bottom" } | { kind: "message"; id: string; highlight: boolean } | { kind: "divider" }

export interface ChannelView {
  messages: TextMessage[]
  /** Parent previews for replies; a missing parent means it was deleted. */
  replied: Record<string, TextMessage>
  hasMoreBefore: boolean
  hasMoreAfter: boolean
  loading: boolean
  loadingOlder: boolean
  loadingNewer: boolean
  error: string | null
  /** last_read_seq when the channel was opened ("New messages" divider). */
  dividerSeq: number | null
  highlightId: string | null
  scrollRequest: ScrollRequest | null
  /** Set by the list: the user is scrolled to the newest message. */
  atBottom: boolean
}

interface ReadState {
  lastReadSeq: number
  newestSeq: number
}

function newView(): ChannelView {
  return {
    messages: [],
    replied: {},
    hasMoreBefore: false,
    hasMoreAfter: false,
    loading: false,
    loadingOlder: false,
    loadingNewer: false,
    error: null,
    dividerSeq: null,
    highlightId: null,
    scrollRequest: null,
    atBottom: true,
  }
}

function makeNonce(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function describeLoadError(error: unknown): string {
  const status = (error as { status?: number }).status
  if (status === 503) return "Chat is temporarily unavailable."
  if (status === 404) return "This channel is no longer available."
  return "Failed to load messages."
}

export const useTextChatStore = defineStore("textChat", () => {
  const roomStore = useRoomStore()
  const userStore = useUserStore()

  const activeChannelId = ref<string | null>(null)
  const views = ref<Record<string, ChannelView>>({})
  const readState = ref<Record<string, ReadState>>({})
  const pending = ref<PendingTextMessage[]>([])
  const available = ref(true)
  const replyTarget = ref<TextMessage | null>(null)
  const editingId = ref<string | null>(null)
  const lastError = ref<string | null>(null)

  const activeChannel = computed(
    () => roomStore.rooms.find((r) => r.id === activeChannelId.value && r.type === "text") ?? null,
  )
  const activeView = computed(() =>
    activeChannelId.value ? (views.value[activeChannelId.value] ?? null) : null,
  )
  const activePending = computed(() =>
    pending.value.filter((p) => p.room_id === activeChannelId.value),
  )

  function viewFor(roomId: string): ChannelView {
    if (!views.value[roomId]) views.value[roomId] = newView()
    return views.value[roomId]
  }

  // --- Unread state -------------------------------------------------------

  function isUnread(roomId: string): boolean {
    const s = readState.value[roomId]
    return !!s && s.newestSeq > s.lastReadSeq
  }

  async function loadUnread() {
    try {
      const resp = await apiService.getTextUnread()
      available.value = resp.available
      const next: Record<string, ReadState> = {}
      for (const ch of resp.channels) {
        const known = readState.value[ch.room_id]
        next[ch.room_id] = {
          lastReadSeq: Math.max(ch.last_read_seq, known?.lastReadSeq ?? 0),
          newestSeq: Math.max(ch.newest_seq, known?.newestSeq ?? 0),
        }
      }
      readState.value = next
    } catch (error) {
      // 404 when text channels are disabled on the server: nothing to track.
      console.warn("[TextChat] Failed to load unread state:", error)
    }
  }

  const readTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** Advance the local read position and report it (debounced). */
  function markRead(roomId: string, seq: number) {
    const s = readState.value[roomId] ?? { lastReadSeq: 0, newestSeq: seq }
    if (seq <= s.lastReadSeq) return
    readState.value[roomId] = { ...s, lastReadSeq: seq, newestSeq: Math.max(s.newestSeq, seq) }
    const existing = readTimers.get(roomId)
    if (existing) clearTimeout(existing)
    readTimers.set(
      roomId,
      setTimeout(() => {
        readTimers.delete(roomId)
        const current = readState.value[roomId]?.lastReadSeq ?? seq
        wsService.sendGlobalMessage("text_channel_read", { room_id: roomId, seq: current })
      }, READ_DEBOUNCE_MS),
    )
  }

  /** Mark everything in a channel read (Esc, "Mark as read"). */
  function markChannelRead(roomId: string) {
    const s = readState.value[roomId]
    if (s && s.newestSeq > s.lastReadSeq) markRead(roomId, s.newestSeq)
    const view = views.value[roomId]
    if (view) view.dividerSeq = null
  }

  // --- Loading ------------------------------------------------------------

  function applyPage(view: ChannelView, page: TextHistoryPage) {
    view.messages = page.messages
    view.replied = { ...page.replied }
    view.hasMoreBefore = page.has_more_before
    view.hasMoreAfter = page.has_more_after
  }

  async function loadLatest(roomId: string, scroll: ScrollRequest | null = { kind: "bottom" }) {
    const view = viewFor(roomId)
    view.loading = true
    view.error = null
    try {
      const page = await apiService.getTextMessages(roomId, { limit: PAGE_SIZE })
      applyPage(view, page)
      view.scrollRequest = scroll
    } catch (error) {
      view.error = describeLoadError(error)
    } finally {
      view.loading = false
    }
  }

  async function loadAround(roomId: string, seq: number, scroll: ScrollRequest) {
    const view = viewFor(roomId)
    view.loading = true
    view.error = null
    try {
      const page = await apiService.getTextMessages(roomId, { aroundSeq: seq, limit: PAGE_SIZE })
      applyPage(view, page)
      view.scrollRequest = scroll
    } catch (error) {
      view.error = describeLoadError(error)
    } finally {
      view.loading = false
    }
  }

  /** Opens a text channel at the last read position (F8). */
  async function openChannel(roomId: string) {
    if (activeChannelId.value !== roomId) {
      replyTarget.value = null
      editingId.value = null
    }
    activeChannelId.value = roomId
    const s = readState.value[roomId]
    const hasUnread = !!s && s.lastReadSeq > 0 && s.newestSeq > s.lastReadSeq
    const view = viewFor(roomId)
    view.dividerSeq = hasUnread ? s.lastReadSeq : null

    // A loaded view showing the newest messages is kept live by events.
    if (view.messages.length > 0 && !view.hasMoreAfter && !view.error) {
      view.scrollRequest = hasUnread ? { kind: "divider" } : { kind: "bottom" }
      return
    }
    if (hasUnread) {
      await loadAround(roomId, s.lastReadSeq, { kind: "divider" })
    } else {
      await loadLatest(roomId)
    }
  }

  function closeChannel() {
    activeChannelId.value = null
    replyTarget.value = null
    editingId.value = null
  }

  async function loadOlder(roomId: string) {
    const view = views.value[roomId]
    if (
      !view ||
      view.loadingOlder ||
      view.loading ||
      !view.hasMoreBefore ||
      !view.messages.length
    ) {
      return
    }
    view.loadingOlder = true
    try {
      const page = await apiService.getTextMessages(roomId, {
        beforeSeq: view.messages[0].seq,
        limit: PAGE_SIZE,
      })
      const known = new Set(view.messages.map((m) => m.id))
      view.messages = [...page.messages.filter((m) => !known.has(m.id)), ...view.messages]
      Object.assign(view.replied, page.replied)
      view.hasMoreBefore = page.has_more_before
      if (view.messages.length > MAX_MESSAGES_IN_MEMORY) {
        view.messages = view.messages.slice(0, MAX_MESSAGES_IN_MEMORY)
        view.hasMoreAfter = true
      }
    } catch (error) {
      console.warn("[TextChat] Failed to load older messages:", error)
    } finally {
      view.loadingOlder = false
    }
  }

  async function loadNewer(roomId: string) {
    const view = views.value[roomId]
    if (!view || view.loadingNewer || view.loading || !view.hasMoreAfter || !view.messages.length) {
      return
    }
    view.loadingNewer = true
    try {
      const page = await apiService.getTextMessages(roomId, {
        afterSeq: view.messages[view.messages.length - 1].seq,
        limit: PAGE_SIZE,
      })
      const known = new Set(view.messages.map((m) => m.id))
      view.messages = [...view.messages, ...page.messages.filter((m) => !known.has(m.id))]
      Object.assign(view.replied, page.replied)
      view.hasMoreAfter = page.has_more_after
      trimOldest(view)
    } catch (error) {
      console.warn("[TextChat] Failed to load newer messages:", error)
    } finally {
      view.loadingNewer = false
    }
  }

  function trimOldest(view: ChannelView) {
    if (view.messages.length > MAX_MESSAGES_IN_MEMORY) {
      view.messages = view.messages.slice(view.messages.length - MAX_MESSAGES_IN_MEMORY)
      view.hasMoreBefore = true
    }
  }

  async function jumpToPresent(roomId: string) {
    const view = viewFor(roomId)
    view.dividerSeq = null
    if (!view.hasMoreAfter && view.messages.length) {
      view.scrollRequest = { kind: "bottom" }
      return
    }
    await loadLatest(roomId)
  }

  /** Scrolls to a message, loading its surroundings when needed (reply jump). */
  async function jumpToMessage(roomId: string, messageId: string) {
    const view = viewFor(roomId)
    if (view.messages.some((m) => m.id === messageId)) {
      view.highlightId = messageId
      view.scrollRequest = { kind: "message", id: messageId, highlight: true }
      return
    }
    view.loading = true
    try {
      const page = await apiService.getTextMessageContext(messageId)
      view.dividerSeq = null
      applyPage(view, page)
      view.highlightId = messageId
      view.scrollRequest = { kind: "message", id: messageId, highlight: true }
    } catch (error) {
      const status = (error as { status?: number }).status
      lastError.value =
        status === 404 ? "That message was deleted." : "Failed to jump to the message."
    } finally {
      view.loading = false
    }
  }

  // --- Writes -------------------------------------------------------------

  const sendTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function transmit(p: PendingTextMessage) {
    wsService.sendGlobalMessage("text_message_send", {
      room_id: p.room_id,
      content: p.content,
      nonce: p.nonce,
      ...(p.reply_to_id ? { reply_to_id: p.reply_to_id, reply_ping: p.reply_ping } : {}),
    })
    const timer = setTimeout(() => {
      sendTimers.delete(p.nonce)
      markFailed(p.nonce, "Not delivered. The connection may be down.")
    }, SEND_TIMEOUT_MS)
    sendTimers.set(p.nonce, timer)
  }

  function sendMessage(roomId: string, content: string) {
    const text = content.trim()
    if (!text) return
    const reply = replyTarget.value?.room_id === roomId ? replyTarget.value : null
    const p: PendingTextMessage = {
      nonce: makeNonce(),
      room_id: roomId,
      content: text,
      reply_to_id: reply?.id ?? null,
      reply_ping: replyPing.value,
      created_at_ts: Date.now(),
      status: "sending",
    }
    pending.value.push(p)
    replyTarget.value = null
    // Sending always shows the newest messages.
    const view = viewFor(roomId)
    if (view.hasMoreAfter) void loadLatest(roomId)
    else view.scrollRequest = { kind: "bottom" }
    transmit(p)
  }

  function clearSendTimer(nonce: string) {
    const timer = sendTimers.get(nonce)
    if (timer) {
      clearTimeout(timer)
      sendTimers.delete(nonce)
    }
  }

  function markFailed(nonce: string, error: string) {
    clearSendTimer(nonce)
    const p = pending.value.find((x) => x.nonce === nonce)
    if (p) {
      p.status = "failed"
      p.error = error
    }
  }

  function retrySend(nonce: string) {
    const p = pending.value.find((x) => x.nonce === nonce)
    if (!p) return
    p.status = "sending"
    p.error = undefined
    transmit(p)
  }

  function discardPending(nonce: string) {
    clearSendTimer(nonce)
    pending.value = pending.value.filter((x) => x.nonce !== nonce)
  }

  function editMessage(messageId: string, content: string) {
    wsService.sendGlobalMessage("text_message_edit", { message_id: messageId, content })
    editingId.value = null
  }

  function deleteMessage(messageId: string) {
    wsService.sendGlobalMessage("text_message_delete", { message_id: messageId })
  }

  const replyPing = ref(true)

  function startReply(message: TextMessage) {
    editingId.value = null
    replyTarget.value = message
    replyPing.value = true
  }

  function cancelReply() {
    replyTarget.value = null
  }

  function startEdit(messageId: string) {
    editingId.value = messageId
  }

  function cancelEdit() {
    editingId.value = null
  }

  // --- Events -------------------------------------------------------------

  function forEachView(fn: (view: ChannelView) => void) {
    for (const view of Object.values(views.value)) fn(view)
  }

  function onMessageNew(data: TextMessageNewEvent) {
    const msg = data.message
    if (data.nonce) {
      clearSendTimer(data.nonce)
      pending.value = pending.value.filter((p) => p.nonce !== data.nonce)
    }
    const s = readState.value[msg.room_id] ?? { lastReadSeq: 0, newestSeq: 0 }
    readState.value[msg.room_id] = { ...s, newestSeq: Math.max(s.newestSeq, msg.seq) }
    if (msg.sender_id === userStore.userId) {
      // Your own message means you have read the channel up to it.
      markRead(msg.room_id, msg.seq)
    }

    const view = views.value[msg.room_id]
    // Only append when the view shows the newest messages; otherwise the
    // message is fetched when the user scrolls down or jumps to present.
    if (!view || view.hasMoreAfter || view.loading) return
    if (view.messages.some((m) => m.id === msg.id)) return
    view.messages.push(msg)
    if (data.replied) Object.assign(view.replied, data.replied)
    if (view.atBottom) trimOldest(view)
  }

  function onMessageUpdated(data: TextMessageUpdatedEvent) {
    forEachView((view) => {
      const i = view.messages.findIndex((m) => m.id === data.id)
      if (i !== -1) view.messages[i] = data.message
      if (view.replied[data.id]) view.replied[data.id] = data.message
    })
  }

  function onMessageDeleted(data: TextMessageDeletedEvent) {
    forEachView((view) => {
      view.messages = view.messages.filter((m) => m.id !== data.id)
      delete view.replied[data.id]
      if (view.highlightId === data.id) view.highlightId = null
    })
    if (replyTarget.value?.id === data.id) replyTarget.value = null
    if (editingId.value === data.id) editingId.value = null
  }

  function onReadState(data: TextReadStateEvent) {
    const s = readState.value[data.room_id] ?? { lastReadSeq: 0, newestSeq: data.last_read_seq }
    if (data.last_read_seq > s.lastReadSeq) {
      readState.value[data.room_id] = { ...s, lastReadSeq: data.last_read_seq }
    }
  }

  function onError(data: TextErrorEvent) {
    if (data.nonce) {
      markFailed(data.nonce, data.message)
      return
    }
    lastError.value = data.message
    if (data.code === "chat_unavailable") available.value = false
  }

  function clearError() {
    lastError.value = null
  }

  /** After a reconnect: refresh badges and the open channel's newest page. */
  async function resync() {
    await loadUnread()
    const roomId = activeChannelId.value
    if (roomId) {
      const view = views.value[roomId]
      if (view && !view.hasMoreAfter)
        await loadLatest(roomId, view.atBottom ? { kind: "bottom" } : null)
    }
    // Views of other channels may have missed events: drop them.
    for (const id of Object.keys(views.value)) {
      if (id !== roomId) delete views.value[id]
    }
  }

  // Channels that disappear (deleted, permission lost) are closed.
  watch(
    () => roomStore.rooms.map((r) => r.id).join(","),
    () => {
      const ids = new Set(roomStore.rooms.filter((r) => r.type === "text").map((r) => r.id))
      for (const id of Object.keys(views.value)) {
        if (!ids.has(id)) delete views.value[id]
      }
      for (const id of Object.keys(readState.value)) {
        if (!ids.has(id)) delete readState.value[id]
      }
      if (activeChannelId.value && !ids.has(activeChannelId.value) && roomStore.rooms.length) {
        closeChannel()
      }
    },
  )

  // Called by MessageList, which owns the scroll position.
  function setAtBottom(roomId: string, atBottom: boolean) {
    const view = views.value[roomId]
    if (view && view.atBottom !== atBottom) view.atBottom = atBottom
  }

  function consumeScrollRequest(roomId: string) {
    const view = views.value[roomId]
    if (view) view.scrollRequest = null
  }

  function clearHighlight(roomId: string, messageId: string) {
    const view = views.value[roomId]
    if (view?.highlightId === messageId) view.highlightId = null
  }

  function reset() {
    closeChannel()
    views.value = {}
    readState.value = {}
    for (const t of sendTimers.values()) clearTimeout(t)
    sendTimers.clear()
    pending.value = []
  }

  return {
    activeChannelId,
    activeChannel,
    activeView,
    activePending,
    views,
    readState,
    pending,
    available,
    replyTarget,
    replyPing,
    editingId,
    lastError,
    isUnread,
    loadUnread,
    markRead,
    markChannelRead,
    openChannel,
    closeChannel,
    loadOlder,
    loadNewer,
    jumpToPresent,
    jumpToMessage,
    sendMessage,
    retrySend,
    discardPending,
    editMessage,
    deleteMessage,
    startReply,
    cancelReply,
    startEdit,
    cancelEdit,
    onMessageNew,
    onMessageUpdated,
    onMessageDeleted,
    onReadState,
    onError,
    clearError,
    resync,
    setAtBottom,
    consumeScrollRequest,
    clearHighlight,
    reset,
  }
})
