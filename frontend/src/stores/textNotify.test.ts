import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"

const api = vi.hoisted(() => ({
  setTextNotify: vi.fn(),
  getTextUnread: vi.fn(),
}))
vi.mock("@/services/api", () => ({ apiService: api }))
const sounds = vi.hoisted(() => ({ playMention: vi.fn() }))
vi.mock("@/services/sounds", () => sounds)
const electron = vi.hoisted(() => ({ flashWindow: vi.fn() }))
vi.mock("@/services/electron", () => electron)
const ws = vi.hoisted(() => ({ sendGlobalMessage: vi.fn() }))
vi.mock("@/services/websocket", () => ({ wsService: ws }))

import { describeMute, useTextNotifyStore } from "./textNotify"
import { useTextChatStore } from "./textChat"
import { useAppSettingsStore } from "./appSettings"
import type { TextUnreadChannel } from "@/types/textChat"

function channel(roomId: string, over: Partial<TextUnreadChannel> = {}): TextUnreadChannel {
  return {
    room_id: roomId,
    last_read_seq: 0,
    newest_seq: 0,
    mention_count: 0,
    notify_mode: "all",
    muted_until: null,
    ...over,
  }
}

describe("text notify store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    useTextNotifyStore().reset()
    vi.useRealTimers()
  })

  it("applies modes and mention counts from the unread summary", () => {
    const store = useTextNotifyStore()
    store.applyUnread([
      channel("a", { mention_count: 3 }),
      channel("b", { notify_mode: "no_mentions", mention_count: 2 }),
      channel("c", { notify_mode: "muted" }),
    ])
    expect(store.mentionCount("a")).toBe(3)
    expect(store.mentionCount("b")).toBe(0) // badges only in "all"
    expect(store.isMuted("c")).toBe(true)
    expect(store.modeOf("x")).toBe("all")
  })

  it("expires a timed mute locally", () => {
    const store = useTextNotifyStore()
    store.applyUnread([channel("a", { notify_mode: "muted", muted_until: Date.now() + 1000 })])
    expect(store.isMuted("a")).toBe(true)
    vi.advanceTimersByTime(1001)
    expect(store.isMuted("a")).toBe(false)
    // Already expired on arrival reads as "all".
    store.applyUnread([channel("b", { notify_mode: "muted", muted_until: Date.now() - 1 })])
    expect(store.isMuted("b")).toBe(false)
  })

  it("counts live mentions, plays the sound and clears on read", () => {
    const store = useTextNotifyStore()
    const chat = useTextChatStore()
    chat.readState["a"] = { lastReadSeq: 10, newestSeq: 30 }
    store.onMention({ room_id: "a", message_id: "20", sender_id: "bob" })
    store.onMention({ room_id: "a", message_id: "30", sender_id: "bob" })
    store.onMention({ room_id: "a", message_id: "30", sender_id: "bob" }) // duplicate
    expect(store.mentionCount("a")).toBe(2)
    expect(sounds.playMention).toHaveBeenCalledTimes(3)
    expect(electron.flashWindow).toHaveBeenCalled()

    chat.markRead("a", 20)
    expect(store.mentionCount("a")).toBe(1)
    chat.markRead("a", 30)
    expect(store.mentionCount("a")).toBe(0)
  })

  it("skips the taskbar flash when disabled", () => {
    useAppSettingsStore().setMentionTaskbarFlash(false)
    useTextNotifyStore().onMention({ room_id: "a", message_id: "5", sender_id: "bob" })
    expect(sounds.playMention).toHaveBeenCalled()
    expect(electron.flashWindow).not.toHaveBeenCalled()
  })

  it("ignores mentions in muted channels", () => {
    const store = useTextNotifyStore()
    store.applyUnread([channel("a", { notify_mode: "muted" })])
    store.onMention({ room_id: "a", message_id: "5", sender_id: "bob" })
    expect(sounds.playMention).not.toHaveBeenCalled()
    expect(useTextChatStore().isUnread("a")).toBe(false)
  })

  it("rolls back when the server rejects a change", async () => {
    const store = useTextNotifyStore()
    api.setTextNotify.mockRejectedValueOnce(new Error("nope"))
    await expect(store.setMode("a", "no_mentions")).rejects.toThrow()
    expect(store.modeOf("a")).toBe("all")
    api.setTextNotify.mockResolvedValueOnce({ mode: "muted", muted_until: null })
    await store.setMode("a", "muted", "forever")
    expect(api.setTextNotify).toHaveBeenLastCalledWith("a", "muted", "forever")
    expect(store.isMuted("a")).toBe(true)
    expect(describeMute(store.settingOf("a"))).toBe("Muted forever")
  })
})
