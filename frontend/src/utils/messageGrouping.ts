/**
 * Timeline layout for text channels (docs/specs/CHAT_SYSTEM.md §7.7):
 * day separators, the "New messages" divider and compact grouping.
 */

/** Consecutive messages by one author within this window are grouped. */
export const GROUP_WINDOW_MS = 7 * 60 * 1000

export interface GroupableMessage {
  id: string
  seq: number
  sender_id: string
  created_at_ts: number
  reply_to_id: string | null
}

export type TimelineItem<M extends GroupableMessage> =
  | { kind: "day"; key: string; ts: number }
  | { kind: "new"; key: string }
  | { kind: "message"; key: string; message: M; compact: boolean }

export function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

/**
 * A message is compact (no avatar, name or timestamp) when it follows a
 * message by the same author, less than 7 minutes later, on the same local
 * day, and is not a reply.
 */
export function isCompact(prev: GroupableMessage | undefined, cur: GroupableMessage): boolean {
  if (!prev || cur.reply_to_id) return false
  if (prev.sender_id !== cur.sender_id) return false
  const gap = cur.created_at_ts - prev.created_at_ts
  if (gap < 0 || gap >= GROUP_WINDOW_MS) return false
  return isSameLocalDay(prev.created_at_ts, cur.created_at_ts)
}

/**
 * Builds the rendered timeline from messages sorted oldest first.
 * `lastReadSeq` places the "New messages" divider above the first message
 * newer than it (null = no divider). The divider also breaks a group.
 */
export function buildTimeline<M extends GroupableMessage>(
  messages: M[],
  lastReadSeq: number | null = null,
): TimelineItem<M>[] {
  const items: TimelineItem<M>[] = []
  let prev: M | undefined
  let dividerPlaced = lastReadSeq === null
  for (const message of messages) {
    let breakGroup = false
    if (!prev || !isSameLocalDay(prev.created_at_ts, message.created_at_ts)) {
      items.push({ kind: "day", key: `day-${message.id}`, ts: message.created_at_ts })
      breakGroup = true
    }
    if (!dividerPlaced && lastReadSeq !== null && message.seq > lastReadSeq && prev) {
      items.push({ kind: "new", key: "new-messages" })
      dividerPlaced = true
      breakGroup = true
    } else if (!dividerPlaced && lastReadSeq !== null && message.seq > lastReadSeq) {
      // The first loaded message is already unread: nothing above to divide.
      dividerPlaced = true
    }
    items.push({
      kind: "message",
      key: message.id,
      message,
      compact: !breakGroup && isCompact(prev, message),
    })
    prev = message
  }
  return items
}

/** "Today at 21:04", "Yesterday at 09:10" or a full date and time. */
export function formatMessageTime(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  if (isSameLocalDay(ts, now)) return `Today at ${time}`
  if (isSameLocalDay(ts, now - 24 * 60 * 60 * 1000)) return `Yesterday at ${time}`
  return `${d.toLocaleDateString()} ${time}`
}

/** Short time for the gutter of compact messages. */
export function formatShortTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

/** Full timestamp for tooltips. */
export function formatFullTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })
}

/** Day separator label. */
export function formatDay(ts: number, now = Date.now()): string {
  if (isSameLocalDay(ts, now)) return "Today"
  if (isSameLocalDay(ts, now - 24 * 60 * 60 * 1000)) return "Yesterday"
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}
