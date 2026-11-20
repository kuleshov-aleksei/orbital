import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"

const api = vi.hoisted(() => ({
  getTextMessages: vi.fn(),
  getTextUnread: vi.fn(),
  setTextNotify: vi.fn(),
}))
vi.mock("@/services/api", () => ({ apiService: api }))
vi.mock("@/services/sounds", () => ({ playMention: vi.fn() }))
vi.mock("@/services/platform", () => ({ notifyAttention: vi.fn() }))
const ws = vi.hoisted(() => ({
  sendGlobalMessage: vi.fn(),
  isGlobalConnected: vi.fn(() => true),
}))
vi.mock("@/services/websocket", () => ({ wsService: ws }))

import { useTextChatStore } from "./textChat"
import type { TextHistoryPage, TextMessage, TextUnreadResponse } from "@/types/textChat"

const ROOM = "20261110145113MiTbtB"
const SENDER = "qkUrdzLDoqslx8EEy2cM7Q=="

function message(seq: number): TextMessage {
  return {
    id: `m${seq}`,
    seq,
    room_id: ROOM,
    sender_id: SENDER,
    content: `message ${seq}`,
    created_at_ts: 1_700_000_000_000 + seq,
    edited_at_ts: null,
    reply_to_id: null,
    mention_user_ids: [],
    mention_role_ids: [],
    reactions: [],
    pinned: false,
    pinned_at_ts: null,
    pinned_by: null,
    attachments: [],
  }
}

function page(seqs: number[], over: Partial<TextHistoryPage> = {}): TextHistoryPage {
  return {
    messages: seqs.map(message),
    replied: {},
    has_more_before: false,
    has_more_after: false,
    ...over,
  }
}

function unread(lastRead: number, newest: number): TextUnreadResponse {
  return {
    available: true,
    channels: [
      {
        room_id: ROOM,
        last_read_seq: lastRead,
        newest_seq: newest,
        mention_count: 0,
        notify_mode: "all",
        muted_until: null,
      },
    ],
  }
}

/** A promise resolved by hand, to interleave events with a request. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe("text chat store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ws.isGlobalConnected.mockReturnValue(true)
  })

  it("keeps a live message that arrives while the page is loading", async () => {
    const store = useTextChatStore()
    const request = deferred<TextHistoryPage>()
    api.getTextMessages.mockReturnValue(request.promise)

    const loading = store.openChannel(ROOM)
    // The server read the page (seq 1-2) before seq 3 was stored.
    store.onMessageNew({ room_id: ROOM, message: message(3) })
    request.resolve(page([1, 2]))
    await loading

    expect(store.views[ROOM].messages.map((m) => m.seq)).toEqual([1, 2, 3])
  })

  it("does not duplicate a live message the loaded page already has", async () => {
    const store = useTextChatStore()
    const request = deferred<TextHistoryPage>()
    api.getTextMessages.mockReturnValue(request.promise)

    const loading = store.openChannel(ROOM)
    store.onMessageNew({ room_id: ROOM, message: message(3) })
    request.resolve(page([1, 2, 3]))
    await loading

    expect(store.views[ROOM].messages.map((m) => m.seq)).toEqual([1, 2, 3])
  })

  it("drops buffered messages when the loaded page is not the newest", async () => {
    const store = useTextChatStore()
    const request = deferred<TextHistoryPage>()
    api.getTextMessages.mockReturnValue(request.promise)

    // Unread messages: the channel opens around the last read position.
    api.getTextUnread.mockResolvedValue(unread(2, 89))
    await store.loadUnread()
    const loading = store.openChannel(ROOM)
    store.onMessageNew({ room_id: ROOM, message: message(90) })
    request.resolve(page([1, 2, 3], { has_more_after: true }))
    await loading

    expect(store.views[ROOM].messages.map((m) => m.seq)).toEqual([1, 2, 3])
  })

  it("does not append a message deleted during the load", async () => {
    const store = useTextChatStore()
    const request = deferred<TextHistoryPage>()
    api.getTextMessages.mockReturnValue(request.promise)

    const loading = store.openChannel(ROOM)
    store.onMessageNew({ room_id: ROOM, message: message(3) })
    store.onMessageDeleted({ room_id: ROOM, id: "m3", newest_seq: 2 })
    request.resolve(page([1, 2]))
    await loading

    expect(store.views[ROOM].messages.map((m) => m.seq)).toEqual([1, 2])
  })

  it("clears the unread state when the newest message is deleted", async () => {
    const store = useTextChatStore()
    api.getTextUnread.mockResolvedValue(unread(9, 9))
    await store.loadUnread()
    expect(store.isUnread(ROOM)).toBe(false)

    store.onMessageNew({ room_id: ROOM, message: message(10) })
    expect(store.isUnread(ROOM)).toBe(true)

    store.onMessageDeleted({ room_id: ROOM, id: "m10", newest_seq: 9 })
    expect(store.isUnread(ROOM)).toBe(false)
  })

  it("takes the server's newest seq on resync, unless a newer message is live", async () => {
    const store = useTextChatStore()
    api.getTextUnread.mockResolvedValue(unread(9, 10))
    await store.loadUnread()
    expect(store.isUnread(ROOM)).toBe(true)

    // Seq 10 was deleted while disconnected (the delete event was missed).
    api.getTextUnread.mockResolvedValue(unread(9, 9))
    await store.loadUnread()
    expect(store.isUnread(ROOM)).toBe(false)

    // A message announced during the request is newer than the response.
    const request = deferred<TextUnreadResponse>()
    api.getTextUnread.mockReturnValue(request.promise)
    const loading = store.loadUnread()
    store.onMessageNew({ room_id: ROOM, message: message(11) })
    request.resolve(unread(9, 9))
    await loading
    expect(store.isUnread(ROOM)).toBe(true)
  })

  describe("outbox", () => {
    const sends = () =>
      ws.sendGlobalMessage.mock.calls.filter(([type]) => type === "text_message_send")

    it("queues a message written offline and sends it after the reconnect", async () => {
      vi.useFakeTimers()
      try {
        const store = useTextChatStore()
        ws.isGlobalConnected.mockReturnValue(false)
        store.sendMessage(ROOM, "first")
        store.sendMessage(ROOM, "second")
        expect(store.pending.map((p) => p.status)).toEqual(["queued", "queued"])
        expect(sends()).toHaveLength(0)

        ws.isGlobalConnected.mockReturnValue(true)
        const flushing = store.flushOutbox()
        await vi.advanceTimersByTimeAsync(2000)
        await flushing

        const sent = sends().map(([, data]) => (data as { content: string }).content)
        expect(sent).toEqual(["first", "second"])
        expect(store.pending.every((p) => p.status === "sending")).toBe(true)

        // The echo with the nonce confirms the message.
        const nonce = store.pending[0].nonce
        store.onMessageNew({ room_id: ROOM, message: message(1), nonce })
        expect(store.pending.map((p) => p.content)).toEqual(["second"])
      } finally {
        vi.useRealTimers()
      }
    })

    it("puts an unconfirmed send back in the queue when the socket drops", () => {
      const store = useTextChatStore()
      store.sendMessage(ROOM, "hello")
      expect(store.pending[0].status).toBe("sending")

      store.onConnectionLost()
      expect(store.pending[0].status).toBe("queued")
    })

    it("keeps the same nonce when a queued message is resent", async () => {
      vi.useFakeTimers()
      try {
        const store = useTextChatStore()
        store.sendMessage(ROOM, "hello")
        const firstNonce = (sends()[0][1] as { nonce: string }).nonce
        store.onConnectionLost()

        const flushing = store.flushOutbox()
        await vi.advanceTimersByTimeAsync(2000)
        await flushing
        const resentNonce = (sends()[1][1] as { nonce: string }).nonce
        // The server dedupes by nonce, so a resend never duplicates.
        expect(resentNonce).toBe(firstNonce)
      } finally {
        vi.useRealTimers()
      }
    })

    it("sends a GIF reference with an otherwise empty message", () => {
      const gif = {
        provider: "klipy",
        id: "8041071659142944",
        url: "https://static.klipy.com/ii/e2e/aa/clip.mp4",
        preview_url: "https://static.klipy.com/ii/e2e/aa/poster.jpg",
        width: 498,
        height: 498,
        title: "Hello",
      } as const
      const store = useTextChatStore()
      store.sendMessage(ROOM, "", { ids: [], attachments: [] }, gif)

      expect(store.pending).toHaveLength(1)
      expect(store.pending[0].content).toBe("")
      expect((sends()[0][1] as { gif: unknown }).gif).toEqual(gif)
    })
  })

  describe("composer picker dock", () => {
    it("toggles the emoji and GIF tabs like a pair", () => {
      const store = useTextChatStore()
      expect(store.composerPanel).toBeNull()

      store.toggleComposerPanel("emoji")
      expect(store.composerPanel).toBe("emoji")

      // The other tab switches instead of closing the panel.
      store.toggleComposerPanel("gif")
      expect(store.composerPanel).toBe("gif")

      // The active tab closes it.
      store.toggleComposerPanel("gif")
      expect(store.composerPanel).toBeNull()
    })

    it("closes with the channel and through closeComposerPanel", () => {
      const store = useTextChatStore()
      store.openComposerPanel("emoji")
      store.closeChannel()
      expect(store.composerPanel).toBeNull()

      store.openComposerPanel("gif")
      store.closeComposerPanel()
      expect(store.composerPanel).toBeNull()
    })
  })
})
