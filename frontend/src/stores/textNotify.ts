import { defineStore } from "pinia"
import { ref } from "vue"
import { apiService } from "@/services/api"
import { playMention } from "@/services/sounds"
import { flashWindow } from "@/services/electron"
import { formatTime24 } from "@/utils/messageGrouping"
import { useAppSettingsStore } from "./appSettings"
import { useTextChatStore } from "./textChat"
import type {
  TextMentionEvent,
  TextMuteDuration,
  TextNotifyMode,
  TextNotifySetting,
  TextNotifySettingsEvent,
  TextUnreadChannel,
} from "@/types/textChat"

const ALL: TextNotifySetting = { mode: "all", muted_until: null }

/**
 * Per-channel notification settings and mention badges
 * (docs/specs/CHAT_SYSTEM.md §7.4, §7.14). The server decides who gets
 * pinged; this store only renders what it says.
 */
export const useTextNotifyStore = defineStore("textNotify", () => {
  const settings = ref<Record<string, TextNotifySetting>>({})
  /** Unread mentions from /api/chat/unread, valid until the read position moves. */
  const baseMentions = ref<Record<string, number>>({})
  /** Seqs of mentions received live since load. */
  const liveMentions = ref<Record<string, number[]>>({})
  /** Channel whose mute-duration modal is open (mounted at the app root). */
  const muteModalRoomId = ref<string | null>(null)

  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function settingOf(roomId: string): TextNotifySetting {
    return settings.value[roomId] ?? ALL
  }

  function modeOf(roomId: string): TextNotifyMode {
    return settingOf(roomId).mode
  }

  function isMuted(roomId: string): boolean {
    return modeOf(roomId) === "muted"
  }

  function mentionCount(roomId: string): number {
    if (modeOf(roomId) !== "all") return 0
    return (baseMentions.value[roomId] ?? 0) + (liveMentions.value[roomId]?.length ?? 0)
  }

  /** Stores a setting; a timed mute flips back to "all" locally when it ends. */
  function apply(roomId: string, s: TextNotifySetting) {
    const existing = expiryTimers.get(roomId)
    if (existing) clearTimeout(existing)
    expiryTimers.delete(roomId)
    if (s.mode === "muted" && s.muted_until !== null) {
      const left = s.muted_until - Date.now()
      if (left <= 0) {
        s = ALL
      } else {
        // setTimeout overflows past ~24.8 days; the server push covers longer mutes.
        expiryTimers.set(
          roomId,
          setTimeout(
            () => {
              expiryTimers.delete(roomId)
              if (settings.value[roomId]?.muted_until === s.muted_until)
                delete settings.value[roomId]
            },
            Math.min(left, 2 ** 31 - 1),
          ),
        )
      }
    }
    if (s.mode === "all") delete settings.value[roomId]
    else settings.value[roomId] = { mode: s.mode, muted_until: s.muted_until }
  }

  function applyUnread(channels: TextUnreadChannel[]) {
    const nextBase: Record<string, number> = {}
    for (const ch of channels) {
      apply(ch.room_id, { mode: ch.notify_mode ?? "all", muted_until: ch.muted_until ?? null })
      if (ch.mention_count > 0) nextBase[ch.room_id] = ch.mention_count
    }
    baseMentions.value = nextBase
    // Live mentions older than the fresh counts are included in them.
    liveMentions.value = {}
  }

  /** The read position moved: forget mentions at or before it. */
  function onRead(roomId: string, lastReadSeq: number) {
    // The loaded count says nothing about which mentions were read; reading
    // from the "New messages" divider normally covers them, so drop it. The
    // next /api/chat/unread recounts.
    delete baseMentions.value[roomId]
    const live = liveMentions.value[roomId]
    if (live) {
      const left = live.filter((seq) => seq > lastReadSeq)
      if (left.length) liveMentions.value[roomId] = left
      else delete liveMentions.value[roomId]
    }
  }

  function onMention(data: TextMentionEvent) {
    if (modeOf(data.room_id) !== "all") return // the server already filters; stay safe
    const textChat = useTextChatStore()
    const seq = Number(data.message_id)
    const focused = typeof document !== "undefined" && !!document.hasFocus?.()
    const viewing = focused && textChat.activeChannelId === data.room_id
    const read = textChat.readState[data.room_id]?.lastReadSeq ?? 0
    if (!(viewing && textChat.views[data.room_id]?.atBottom) && seq > read) {
      const list = liveMentions.value[data.room_id] ?? []
      if (!list.includes(seq)) liveMentions.value[data.room_id] = [...list, seq]
    }
    if (!viewing) {
      const app = useAppSettingsStore()
      if (app.mentionSound) playMention(app.mentionSoundVolume)
      if (app.mentionTaskbarFlash) flashWindow()
    }
  }

  function onSettings(data: TextNotifySettingsEvent) {
    apply(data.room_id, { mode: data.mode, muted_until: data.muted_until })
  }

  /** Changes a channel's mode; the server echoes it to every session. */
  async function setMode(roomId: string, mode: TextNotifyMode, duration?: TextMuteDuration) {
    const previous = settingOf(roomId)
    try {
      const s = await apiService.setTextNotify(roomId, mode, duration)
      apply(roomId, s)
    } catch (error) {
      apply(roomId, previous)
      console.warn("[TextChat] Failed to change notification settings:", error)
      throw error
    }
  }

  function openMuteModal(roomId: string) {
    muteModalRoomId.value = roomId
  }

  function closeMuteModal() {
    muteModalRoomId.value = null
  }

  function forgetRoom(roomId: string) {
    delete settings.value[roomId]
    delete baseMentions.value[roomId]
    delete liveMentions.value[roomId]
  }

  function reset() {
    for (const t of expiryTimers.values()) clearTimeout(t)
    expiryTimers.clear()
    settings.value = {}
    baseMentions.value = {}
    liveMentions.value = {}
    muteModalRoomId.value = null
  }

  return {
    settings,
    muteModalRoomId,
    settingOf,
    modeOf,
    isMuted,
    mentionCount,
    applyUnread,
    onRead,
    onMention,
    onSettings,
    setMode,
    openMuteModal,
    closeMuteModal,
    forgetRoom,
    reset,
  }
})

/** "Muted until 21:04 Tue" / "Muted forever". */
export function describeMute(s: TextNotifySetting): string {
  if (s.mode !== "muted") return ""
  if (s.muted_until === null) return "Muted forever"
  const d = new Date(s.muted_until)
  const time = formatTime24(s.muted_until)
  const sameDay = new Date().toDateString() === d.toDateString()
  return sameDay
    ? `Muted until ${time}`
    : `Muted until ${time} ${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}`
}
