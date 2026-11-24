import { defineStore } from "pinia"
import { computed, ref, watch } from "vue"
import { apiService, isNetworkError } from "@/services/api"
import { wsService } from "@/services/websocket"
import {
  cacheDelete,
  cacheGet,
  cacheGetAll,
  cachePut,
  cachePutDebounced,
  offlineCacheUser,
} from "@/services/offlineCache"
import { addRecentReaction } from "@/services/emoji"
import { useRoomStore } from "./room"
import { useUserStore } from "./user"
import { useTextNotifyStore } from "./textNotify"
import type {
  TextAttachment,
  TextErrorEvent,
  TextGIF,
  TextHistoryPage,
  TextMessage,
  TextMessageDeletedEvent,
  TextMessageNewEvent,
  TextMessageUpdatedEvent,
  TextPollInput,
  TextReadStateEvent,
  TextTypingEvent,
  TextUnreadResponse,
} from "@/types/textChat"

/** Messages kept in memory per channel; the far end is trimmed beyond this. */
export const MAX_MESSAGES_IN_MEMORY = 300
const PAGE_SIZE = 50
const READ_DEBOUNCE_MS = 1000
const SEND_TIMEOUT_MS = 15000
/** Newest messages per channel kept in the offline cache. */
const CACHED_MESSAGES = PAGE_SIZE
/**
 * Gap between queued messages sent after a reconnect: the server allows five
 * messages per five seconds per channel.
 */
const OUTBOX_SEND_GAP_MS = 1100
/** Client throttle for text_typing (the server allows one per 3 s). */
const TYPING_SEND_MS = 3000
/** How long "X is typing" shows without a new event. */
const TYPING_SHOW_MS = 6000

/** A client-rendered line such as "X pinned a message" (not stored). */
export interface TextSystemLine {
  key: string
  kind: "pin"
  room_id: string
  user_id: string
  message_id: string
  ts: number
}

/** An optimistic message: shown dimmed until the server echoes its nonce. */
export interface PendingTextMessage {
  nonce: string
  room_id: string
  content: string
  reply_to_id: string | null
  reply_ping: boolean
  /** Pending upload ids and their display copies (shown while sending). */
  upload_ids: string[]
  /** The uploads sent as spoilers (missing on outbox entries from before). */
  spoiler_ids?: string[]
  attachments: TextAttachment[]
  /** A third-party GIF sent with this message (docs/specs/CHAT_SYSTEM.md §7.17). */
  gif?: TextGIF
  /** A poll created with this message (docs/specs/CHAT_SYSTEM.md §7.18). */
  poll?: TextPollInput
  created_at_ts: number
  /** queued: written offline (or the link dropped), sent on reconnect. */
  status: "queued" | "sending" | "failed"
  error?: string
  /** The sender's time zone when they hit Send (slash commands only). */
  tz?: string
  /** The server refused a slash command (bad arguments): resending gives the
   * same answer, so the next send in the channel clears it. */
  rejected?: boolean
}

/** Offline copy of a channel's newest messages (services/offlineCache.ts). */
interface CachedChannel {
  room_id: string
  messages: TextMessage[]
  replied: Record<string, TextMessage>
  saved_at: number
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
  /** Showing the offline snapshot until the server answers. */
  fromCache: boolean
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
    fromCache: false,
  }
}

function makeNonce(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function currentTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
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
  /** A picked third-party GIF waiting to be sent with the next message
   * (docs/specs/CHAT_SYSTEM.md §7.17). */
  const pendingGif = ref<TextGIF | null>(null)
  const editingId = ref<string | null>(null)
  const lastError = ref<string | null>(null)
  /** Pinned messages per channel, loaded when the pins panel opens. */
  const pins = ref<Record<string, TextMessage[]>>({})
  const pinsLoading = ref(false)
  /** Right-side panel of the channel view. */
  const sidePanel = ref<"pins" | "search" | null>(null)
  /** Docked emoji/GIF panel under the composer (mobile layout only). */
  const composerPanel = ref<"emoji" | "gif" | null>(null)
  const systemLines = ref<Record<string, TextSystemLine[]>>({})
  /** room -> user -> time the indicator expires. */
  const typing = ref<Record<string, Record<string, number>>>({})

  const activeChannel = computed(
    () => roomStore.rooms.find((r) => r.id === activeChannelId.value && r.type === "text") ?? null,
  )
  const activeView = computed(() =>
    activeChannelId.value ? (views.value[activeChannelId.value] ?? null) : null,
  )

  // Users who can see the open channel: the user sidebar and the "@"
  // autocomplete list only them. Loaded by UserSidebarWrapper, which also
  // refetches on permission changes.
  const viewers = ref<{ roomId: string; ids: Set<string> } | null>(null)
  /** Viewer ids of the open channel, or null until they arrive (show everyone). */
  const activeViewerIds = computed(() =>
    activeChannelId.value && viewers.value?.roomId === activeChannelId.value
      ? viewers.value.ids
      : null,
  )
  let viewersSeq = 0
  async function loadActiveViewers() {
    const id = activeChannel.value?.id ?? null
    const seq = ++viewersSeq
    if (!id) {
      viewers.value = null
      return
    }
    try {
      const res = await apiService.getRoomViewers(id)
      if (seq === viewersSeq) viewers.value = { roomId: id, ids: new Set(res.user_ids) }
    } catch (error) {
      console.error("Failed to load channel viewers:", error)
    }
  }
  const activePending = computed(() =>
    pending.value.filter((p) => p.room_id === activeChannelId.value),
  )

  function viewFor(roomId: string): ChannelView {
    if (!views.value[roomId]) views.value[roomId] = newView()
    return views.value[roomId]
  }

  // --- Unread state -------------------------------------------------------

  function isUnread(roomId: string): boolean {
    if (useTextNotifyStore().isMuted(roomId)) return false
    const s = readState.value[roomId]
    return !!s && s.newestSeq > s.lastReadSeq
  }

  /** Channels that got a live message while loadUnread was in flight. */
  let liveDuringUnread: Set<string> | null = null

  async function loadUnread() {
    const live = new Set<string>()
    liveDuringUnread = live
    try {
      let resp: TextUnreadResponse
      try {
        resp = await apiService.getTextUnread()
        void cachePut("kv", "unread", resp)
      } catch (error) {
        // Offline: last known badges, unless live state is already here.
        const cached = isNetworkError(error)
          ? await cacheGet<TextUnreadResponse>("kv", "unread")
          : undefined
        if (!cached || Object.keys(readState.value).length) throw error
        resp = cached
      }
      available.value = resp.available
      const next: Record<string, ReadState> = {}
      for (const ch of resp.channels) {
        const known = readState.value[ch.room_id]
        next[ch.room_id] = {
          // A local read may not have been reported yet (it is debounced).
          lastReadSeq: Math.max(ch.last_read_seq, known?.lastReadSeq ?? 0),
          // The server's newest message wins: it can be lower than ours after
          // a delete. Only a message newer than the response keeps our value.
          newestSeq: live.has(ch.room_id)
            ? Math.max(ch.newest_seq, known?.newestSeq ?? 0)
            : ch.newest_seq,
        }
      }
      readState.value = next
      useTextNotifyStore().applyUnread(resp.channels)
    } catch (error) {
      // 404 when text channels are disabled on the server: nothing to track.
      console.warn("[TextChat] Failed to load unread state:", error)
    } finally {
      if (liveDuringUnread === live) liveDuringUnread = null
    }
  }

  const readTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** Advance the local read position and report it (debounced). */
  function markRead(roomId: string, seq: number) {
    const s = readState.value[roomId] ?? { lastReadSeq: 0, newestSeq: seq }
    if (seq <= s.lastReadSeq) return
    readState.value[roomId] = { ...s, lastReadSeq: seq, newestSeq: Math.max(s.newestSeq, seq) }
    useTextNotifyStore().onRead(roomId, seq)
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
    view.fromCache = false
  }

  // --- Offline cache ------------------------------------------------------

  /** Saves the newest messages of a view that shows the live tail. */
  function persistView(roomId: string) {
    const view = views.value[roomId]
    if (!view || view.fromCache || view.hasMoreAfter || !view.messages.length) return
    cachePutDebounced("channels", roomId, (): CachedChannel | undefined => {
      const v = views.value[roomId]
      if (!v || v.fromCache || v.hasMoreAfter) return undefined
      const messages = v.messages.slice(-CACHED_MESSAGES)
      const replied: Record<string, TextMessage> = {}
      for (const m of messages) {
        if (m.reply_to_id && v.replied[m.reply_to_id]) {
          replied[m.reply_to_id] = v.replied[m.reply_to_id]
        }
      }
      return { room_id: roomId, messages, replied, saved_at: Date.now() }
    })
  }

  /** Fills an empty view from the offline cache; true when it did. */
  async function seedFromCache(roomId: string): Promise<boolean> {
    const cached = await cacheGet<CachedChannel>("channels", roomId)
    const view = views.value[roomId]
    if (!cached?.messages?.length || !view || view.messages.length) return false
    view.messages = cached.messages
    view.replied = { ...cached.replied }
    view.hasMoreBefore = true
    view.hasMoreAfter = false
    view.fromCache = true
    view.scrollRequest = { kind: "bottom" }
    return true
  }

  /** A failed load keeps a cached snapshot on screen instead of an error. */
  function loadFailed(view: ChannelView, error: unknown) {
    if (view.fromCache && view.messages.length && isNetworkError(error)) return
    view.error = describeLoadError(error)
  }

  /** Live messages that arrived while a channel's page was loading. */
  const missedWhileLoading = new Map<string, TextMessageNewEvent[]>()

  /** Appends a live message to a view that shows the newest messages. */
  function appendLive(view: ChannelView, data: TextMessageNewEvent) {
    const msg = data.message
    const last = view.messages[view.messages.length - 1]
    if (last && msg.seq <= last.seq) return
    if (view.messages.some((m) => m.id === msg.id)) return
    view.messages.push(msg)
    if (data.replied) Object.assign(view.replied, data.replied)
  }

  /**
   * Ends a page load. The page may have been read before a message that was
   * announced during the load, so those messages are appended now.
   */
  function finishLoading(roomId: string, view: ChannelView) {
    view.loading = false
    const missed = missedWhileLoading.get(roomId)
    missedWhileLoading.delete(roomId)
    if (missed && !view.hasMoreAfter) {
      for (const data of missed) appendLive(view, data)
    }
    persistView(roomId)
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
      loadFailed(view, error)
    } finally {
      finishLoading(roomId, view)
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
      loadFailed(view, error)
    } finally {
      finishLoading(roomId, view)
    }
  }

  /** Opens a text channel at the last read position (F8). */
  async function openChannel(roomId: string) {
    if (activeChannelId.value !== roomId) {
      replyTarget.value = null
      editingId.value = null
      composerPanel.value = null
    }
    activeChannelId.value = roomId
    const s = readState.value[roomId]
    const hasUnread = !!s && s.lastReadSeq > 0 && s.newestSeq > s.lastReadSeq
    const view = viewFor(roomId)
    view.dividerSeq = hasUnread ? s.lastReadSeq : null

    // A loaded view showing the newest messages is kept live by events.
    if (view.messages.length > 0 && !view.hasMoreAfter && !view.error && !view.fromCache) {
      view.scrollRequest = hasUnread ? { kind: "divider" } : { kind: "bottom" }
      return
    }
    // Show the offline snapshot right away; the load below replaces it.
    // Marked loading first so live messages arriving meanwhile are kept.
    if (!view.messages.length) {
      view.loading = true
      await seedFromCache(roomId)
    }
    if (hasUnread) {
      await loadAround(roomId, s.lastReadSeq, { kind: "divider" })
    } else {
      await loadLatest(roomId)
    }
  }

  /** Opens a channel scrolled to one message (search results, pins). */
  async function openChannelAt(roomId: string, messageId: string) {
    if (activeChannelId.value !== roomId) {
      replyTarget.value = null
      editingId.value = null
      composerPanel.value = null
    }
    activeChannelId.value = roomId
    await jumpToMessage(roomId, messageId)
  }

  function closeChannel() {
    activeChannelId.value = null
    replyTarget.value = null
    editingId.value = null
    sidePanel.value = null
    composerPanel.value = null
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
      persistView(roomId)
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
      finishLoading(roomId, view)
    }
  }

  // --- Writes -------------------------------------------------------------

  const sendTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** Sends now when the socket is up; otherwise leaves it in the outbox. */
  function transmitOrQueue(p: PendingTextMessage) {
    if (!wsService.isGlobalConnected()) {
      p.status = "queued"
      p.error = undefined
      return
    }
    p.status = "sending"
    p.error = undefined
    transmit(p)
  }

  function transmit(p: PendingTextMessage) {
    wsService.sendGlobalMessage("text_message_send", {
      room_id: p.room_id,
      content: p.content,
      nonce: p.nonce,
      ...(p.upload_ids.length ? { upload_ids: p.upload_ids } : {}),
      ...(p.spoiler_ids?.length ? { spoiler_ids: p.spoiler_ids } : {}),
      ...(p.gif ? { gif: p.gif } : {}),
      ...(p.poll ? { poll: p.poll } : {}),
      ...(p.reply_to_id ? { reply_to_id: p.reply_to_id, reply_ping: p.reply_ping } : {}),
      ...(p.tz ? { tz: p.tz } : {}),
    })
    const timer = setTimeout(() => {
      sendTimers.delete(p.nonce)
      // The link died under it: resend (same nonce) after the reconnect.
      if (!wsService.isGlobalConnected()) {
        const current = pending.value.find((x) => x.nonce === p.nonce)
        if (current) current.status = "queued"
        return
      }
      markFailed(p.nonce, "Not delivered. The connection may be down.")
    }, SEND_TIMEOUT_MS)
    sendTimers.set(p.nonce, timer)
  }

  function sendMessage(
    roomId: string,
    content: string,
    files: { ids: string[]; attachments: TextAttachment[]; spoilerIds?: string[] } = {
      ids: [],
      attachments: [],
    },
    gif: TextGIF | null = null,
  ) {
    const text = content.trim()
    if (!text && !files.ids.length && !gif) return
    const reply = replyTarget.value?.room_id === roomId ? replyTarget.value : null
    // A rejected command's usage error has been read once the user sends again.
    for (const old of pending.value.filter((x) => x.room_id === roomId && x.rejected)) {
      discardPending(old.nonce)
    }
    const p: PendingTextMessage = {
      nonce: makeNonce(),
      room_id: roomId,
      content: text,
      reply_to_id: reply?.id ?? null,
      reply_ping: replyPing.value,
      upload_ids: files.ids,
      ...(files.spoilerIds?.length ? { spoiler_ids: files.spoilerIds } : {}),
      attachments: files.attachments,
      ...(gif ? { gif } : {}),
      created_at_ts: Date.now(),
      status: "sending",
      // /remindme reads times in the zone the user is in right now.
      ...(text.startsWith("/") ? { tz: currentTimeZone() } : {}),
    }
    pending.value.push(p)
    replyTarget.value = null
    // Sending always shows the newest messages.
    const view = viewFor(roomId)
    if (view.hasMoreAfter) void loadLatest(roomId)
    else view.scrollRequest = { kind: "bottom" }
    // Kept on disk until the server confirms it, so an app kill or a dead
    // link never loses what the user wrote.
    void cachePut("outbox", p.nonce, p)
    transmitOrQueue(pending.value[pending.value.length - 1])
  }

  /** Socket dropped: unconfirmed sends go back to the outbox. */
  function onConnectionLost() {
    for (const p of pending.value) {
      if (p.status !== "sending") continue
      clearSendTimer(p.nonce)
      p.status = "queued"
    }
  }

  let outboxRestore: Promise<void> | null = null
  let outboxUser = ""

  /** Loads messages queued in an earlier session (once per account). */
  function restoreOutbox(): Promise<void> {
    const user = offlineCacheUser()
    if (outboxRestore && outboxUser === user) return outboxRestore
    outboxUser = user
    outboxRestore = (async () => {
      const saved = await cacheGetAll<PendingTextMessage>("outbox")
      const known = new Set(pending.value.map((p) => p.nonce))
      for (const p of saved.sort((a, b) => a.created_at_ts - b.created_at_ts)) {
        if (known.has(p.nonce)) continue
        pending.value.push({ ...p, status: p.status === "failed" ? "failed" : "queued" })
      }
    })()
    return outboxRestore
  }

  let flushing = false

  /** Sends queued messages, oldest first, after a reconnect. */
  async function flushOutbox() {
    if (flushing) return
    flushing = true
    try {
      await restoreOutbox()
      const queue = pending.value
        .filter((p) => p.status === "queued")
        .sort((a, b) => a.created_at_ts - b.created_at_ts)
      for (let i = 0; i < queue.length; i++) {
        if (!wsService.isGlobalConnected()) return
        const p = pending.value.find((x) => x.nonce === queue[i].nonce)
        if (!p || p.status !== "queued") continue
        p.status = "sending"
        transmit(p)
        if (i < queue.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, OUTBOX_SEND_GAP_MS))
        }
      }
    } finally {
      flushing = false
    }
  }

  function clearSendTimer(nonce: string) {
    const timer = sendTimers.get(nonce)
    if (timer) {
      clearTimeout(timer)
      sendTimers.delete(nonce)
    }
  }

  function markFailed(nonce: string, error: string, rejected = false) {
    clearSendTimer(nonce)
    const p = pending.value.find((x) => x.nonce === nonce)
    if (p) {
      p.status = "failed"
      p.error = error
      if (rejected) p.rejected = true
      void cachePut("outbox", p.nonce, p)
    }
  }

  function retrySend(nonce: string) {
    const p = pending.value.find((x) => x.nonce === nonce)
    if (!p) return
    p.rejected = undefined
    transmitOrQueue(p)
    void cachePut("outbox", p.nonce, p)
  }

  function discardPending(nonce: string) {
    clearSendTimer(nonce)
    pending.value = pending.value.filter((x) => x.nonce !== nonce)
    void cacheDelete("outbox", nonce)
  }

  /** Creates a poll. It goes through the outbox like any message, so a
   * poll made offline is sent on reconnect. */
  function sendPoll(roomId: string, poll: TextPollInput) {
    const reply = replyTarget.value?.room_id === roomId ? replyTarget.value : null
    for (const old of pending.value.filter((x) => x.room_id === roomId && x.rejected)) {
      discardPending(old.nonce)
    }
    const p: PendingTextMessage = {
      nonce: makeNonce(),
      room_id: roomId,
      content: "",
      reply_to_id: reply?.id ?? null,
      reply_ping: replyPing.value,
      upload_ids: [],
      attachments: [],
      poll,
      created_at_ts: Date.now(),
      status: "sending",
    }
    pending.value.push(p)
    replyTarget.value = null
    const view = viewFor(roomId)
    if (view.hasMoreAfter) void loadLatest(roomId)
    else view.scrollRequest = { kind: "bottom" }
    void cachePut("outbox", p.nonce, p)
    transmitOrQueue(pending.value[pending.value.length - 1])
  }

  /** Polls with a vote or close request in flight (spinner, no double taps). */
  const pollBusy = ref<Record<string, boolean>>({})

  /** Replaces your vote in a poll; no options retracts it. */
  function votePoll(messageId: string, optionIds: string[]) {
    pollBusy.value[messageId] = true
    wsService.sendGlobalMessage("text_poll_vote", { message_id: messageId, option_ids: optionIds })
  }

  /** Ends a poll early (author or ManageMessages). */
  function closePoll(messageId: string) {
    pollBusy.value[messageId] = true
    wsService.sendGlobalMessage("text_poll_close", { message_id: messageId })
  }

  function editMessage(messageId: string, content: string) {
    wsService.sendGlobalMessage("text_message_edit", { message_id: messageId, content })
    editingId.value = null
  }

  function deleteMessage(messageId: string) {
    wsService.sendGlobalMessage("text_message_delete", { message_id: messageId })
  }

  /** Removes a message's link previews (author or ManageMessages). */
  function suppressEmbeds(messageId: string) {
    wsService.sendGlobalMessage("text_message_suppress_embeds", { message_id: messageId })
  }

  function toggleReaction(messageId: string, emoji: string) {
    // Adding (not removing) a reaction moves it to the front of the quick reactions.
    let adding = true
    forEachView((view) => {
      const msg = view.messages.find((m) => m.id === messageId)
      const r = msg?.reactions.find((x) => x.emoji === emoji)
      if (r?.user_ids.includes(userStore.userId)) adding = false
    })
    if (adding) addRecentReaction(emoji)
    wsService.sendGlobalMessage("text_reaction_toggle", { message_id: messageId, emoji })
  }

  function setPinned(messageId: string, pinned: boolean) {
    wsService.sendGlobalMessage("text_pin", { message_id: messageId, pinned })
  }

  async function loadPins(roomId: string) {
    pinsLoading.value = true
    try {
      const resp = await apiService.getTextPins(roomId)
      pins.value[roomId] = resp.messages
    } catch (error) {
      console.warn("[TextChat] Failed to load pins:", error)
      lastError.value = "Failed to load pinned messages."
    } finally {
      pinsLoading.value = false
    }
  }

  function toggleSidePanel(panel: "pins" | "search") {
    sidePanel.value = sidePanel.value === panel ? null : panel
    const roomId = activeChannelId.value
    if (sidePanel.value === "pins" && roomId) void loadPins(roomId)
  }

  function closeSidePanel() {
    sidePanel.value = null
  }

  /** Opens the docked emoji/GIF panel, or closes it when that tab is open. */
  function toggleComposerPanel(panel: "emoji" | "gif") {
    composerPanel.value = composerPanel.value === panel ? null : panel
  }

  function openComposerPanel(panel: "emoji" | "gif") {
    composerPanel.value = panel
  }

  function closeComposerPanel() {
    composerPanel.value = null
  }

  const lastTypingSent = new Map<string, number>()

  /** Called on composer input; throttled. */
  function notifyTyping(roomId: string) {
    const now = Date.now()
    if (now - (lastTypingSent.get(roomId) ?? 0) < TYPING_SEND_MS) return
    lastTypingSent.set(roomId, now)
    wsService.sendGlobalMessage("text_typing", { room_id: roomId })
  }

  const typingNow = ref(Date.now())
  let typingTicker: ReturnType<typeof setInterval> | null = null

  function ensureTypingTicker() {
    if (typingTicker) return
    typingTicker = setInterval(() => {
      typingNow.value = Date.now()
      let any = false
      for (const [room, users] of Object.entries(typing.value)) {
        for (const [user, until] of Object.entries(users)) {
          if (until <= typingNow.value) delete typing.value[room][user]
          else any = true
        }
        if (!Object.keys(typing.value[room]).length) delete typing.value[room]
      }
      if (!any && typingTicker) {
        clearInterval(typingTicker)
        typingTicker = null
      }
    }, 1000)
  }

  function onTyping(data: TextTypingEvent) {
    if (data.user_id === userStore.userId) return
    typing.value[data.room_id] = {
      ...(typing.value[data.room_id] ?? {}),
      [data.user_id]: Date.now() + TYPING_SHOW_MS,
    }
    ensureTypingTicker()
  }

  function typingUsers(roomId: string): string[] {
    const users = typing.value[roomId]
    if (!users) return []
    return Object.entries(users)
      .filter(([, until]) => until > typingNow.value)
      .map(([id]) => id)
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

  /** Command messages that arrived live (not from history): their
   * animation (the /vrandom wheel) plays once. Not persisted. */
  const liveCommandIds = new Set<string>()

  /** True once for a command message that arrived live. */
  function consumeLiveCommand(id: string): boolean {
    return liveCommandIds.delete(id)
  }

  function onMessageNew(data: TextMessageNewEvent) {
    const msg = data.message
    if (msg.command) liveCommandIds.add(msg.id)
    if (data.nonce) {
      clearSendTimer(data.nonce)
      if (pending.value.some((p) => p.nonce === data.nonce)) {
        pending.value = pending.value.filter((p) => p.nonce !== data.nonce)
        void cacheDelete("outbox", data.nonce)
      }
    }
    const s = readState.value[msg.room_id] ?? { lastReadSeq: 0, newestSeq: 0 }
    readState.value[msg.room_id] = { ...s, newestSeq: Math.max(s.newestSeq, msg.seq) }
    liveDuringUnread?.add(msg.room_id)
    if (typing.value[msg.room_id]?.[msg.sender_id]) delete typing.value[msg.room_id][msg.sender_id]
    if (msg.sender_id === userStore.userId) {
      // Your own message means you have read the channel up to it.
      markRead(msg.room_id, msg.seq)
    }

    const view = views.value[msg.room_id]
    // Only append when the view shows the newest messages; otherwise the
    // message is fetched when the user scrolls down or jumps to present.
    if (!view) return
    if (view.loading) {
      // The page being loaded may or may not contain it: decide afterwards.
      const missed = missedWhileLoading.get(msg.room_id) ?? []
      missed.push(data)
      missedWhileLoading.set(msg.room_id, missed)
      return
    }
    if (view.hasMoreAfter) return
    appendLive(view, data)
    if (view.atBottom) trimOldest(view)
    persistView(msg.room_id)
  }

  function onMessageUpdated(data: TextMessageUpdatedEvent) {
    const msg = data.message
    delete pollBusy.value[data.id]
    forEachView((view) => {
      const i = view.messages.findIndex((m) => m.id === data.id)
      if (i !== -1) view.messages[i] = msg
      if (view.replied[data.id]) view.replied[data.id] = msg
    })
    persistView(msg.room_id)
    updatePins(msg)
  }

  function updatePins(msg: TextMessage) {
    const list = pins.value[msg.room_id]
    const wasPinned = list?.some((m) => m.id === msg.id) ?? false
    if (list) {
      const rest = list.filter((m) => m.id !== msg.id)
      pins.value[msg.room_id] = msg.pinned
        ? [msg, ...rest].sort((a, b) => (b.pinned_at_ts ?? 0) - (a.pinned_at_ts ?? 0))
        : rest
    }
    // "X pinned a message": only for fresh pins, once per pin.
    if (!msg.pinned || !msg.pinned_by || !msg.pinned_at_ts || wasPinned) return
    if (Date.now() - msg.pinned_at_ts > 60_000) return
    const key = `pin:${msg.id}:${msg.pinned_at_ts}`
    const lines = systemLines.value[msg.room_id] ?? []
    if (lines.some((l) => l.key === key)) return
    systemLines.value[msg.room_id] = [
      ...lines.slice(-19),
      {
        key,
        kind: "pin",
        room_id: msg.room_id,
        user_id: msg.pinned_by,
        message_id: msg.id,
        ts: msg.pinned_at_ts,
      },
    ]
  }

  function onMessageDeleted(data: TextMessageDeletedEvent) {
    forEachView((view) => {
      view.messages = view.messages.filter((m) => m.id !== data.id)
      delete view.replied[data.id]
      if (view.highlightId === data.id) view.highlightId = null
    })
    const list = pins.value[data.room_id]
    if (list) pins.value[data.room_id] = list.filter((m) => m.id !== data.id)
    if (replyTarget.value?.id === data.id) replyTarget.value = null
    if (editingId.value === data.id) editingId.value = null
    persistView(data.room_id)
    // A message deleted during a page load must not be appended afterwards.
    const missed = missedWhileLoading.get(data.room_id)
    if (missed) {
      missedWhileLoading.set(
        data.room_id,
        missed.filter((e) => e.message.id !== data.id),
      )
    }
    // Deleting the newest message lowers the channel's newest seq; without
    // this the channel stays unread with nothing left to read.
    const s = readState.value[data.room_id]
    if (s && data.newest_seq !== undefined && data.newest_seq < s.newestSeq) {
      readState.value[data.room_id] = { ...s, newestSeq: data.newest_seq }
    }
  }

  function onReadState(data: TextReadStateEvent) {
    const s = readState.value[data.room_id] ?? { lastReadSeq: 0, newestSeq: data.last_read_seq }
    if (data.last_read_seq > s.lastReadSeq) {
      readState.value[data.room_id] = { ...s, lastReadSeq: data.last_read_seq }
      useTextNotifyStore().onRead(data.room_id, data.last_read_seq)
    }
  }

  function onError(data: TextErrorEvent) {
    if (data.nonce) {
      const p = pending.value.find((x) => x.nonce === data.nonce)
      // A refused command or poll gets the same answer when resent.
      const refused = !!p && (p.content.startsWith("/") || !!p.poll)
      markFailed(data.nonce, data.message, data.code === "invalid" && refused)
      return
    }
    if (data.message_id) delete pollBusy.value[data.message_id]
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
        if (!ids.has(id)) {
          delete readState.value[id]
          delete pins.value[id]
          delete systemLines.value[id]
          useTextNotifyStore().forgetRoom(id)
        }
      }
      if (activeChannelId.value && !ids.has(activeChannelId.value) && roomStore.rooms.length) {
        closeChannel()
      }
      // Forget cached messages of channels that are really gone (the list
      // comes from the server, not from the offline snapshot).
      if (roomStore.roomsFromServer && roomStore.rooms.length) {
        void (async () => {
          for (const c of await cacheGetAll<CachedChannel>("channels")) {
            if (!ids.has(c.room_id)) void cacheDelete("channels", c.room_id)
          }
        })()
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
    outboxRestore = null
    pins.value = {}
    systemLines.value = {}
    typing.value = {}
    viewers.value = null
    viewersSeq++
    useTextNotifyStore().reset()
  }

  return {
    consumeLiveCommand,
    activeChannelId,
    activeChannel,
    activeView,
    activePending,
    activeViewerIds,
    loadActiveViewers,
    views,
    readState,
    pending,
    available,
    replyTarget,
    replyPing,
    pendingGif,
    editingId,
    lastError,
    pins,
    pinsLoading,
    sidePanel,
    systemLines,
    typing,
    composerPanel,
    toggleComposerPanel,
    openComposerPanel,
    closeComposerPanel,
    isUnread,
    loadUnread,
    markRead,
    markChannelRead,
    openChannel,
    openChannelAt,
    closeChannel,
    loadOlder,
    loadNewer,
    jumpToPresent,
    jumpToMessage,
    sendMessage,
    sendPoll,
    pollBusy,
    votePoll,
    closePoll,
    flushOutbox,
    restoreOutbox,
    onConnectionLost,
    retrySend,
    discardPending,
    editMessage,
    deleteMessage,
    suppressEmbeds,
    startReply,
    cancelReply,
    startEdit,
    cancelEdit,
    toggleReaction,
    setPinned,
    loadPins,
    toggleSidePanel,
    closeSidePanel,
    notifyTyping,
    typingUsers,
    onTyping,
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
