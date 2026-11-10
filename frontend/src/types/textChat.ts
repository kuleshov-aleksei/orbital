// Text channel types. Shapes come FROM the backend, so fields are snake_case
// (see AGENTS.md). Spec: docs/specs/CHAT_SYSTEM.md.

export interface TextReaction {
  emoji: string
  user_ids: string[]
}

export interface TextMessage {
  id: string
  seq: number
  room_id: string
  sender_id: string
  content: string
  created_at_ts: number
  edited_at_ts: number | null
  reply_to_id: string | null
  mention_user_ids: string[]
  mention_role_ids: string[]
  reactions: TextReaction[]
  pinned: boolean
  pinned_at_ts: number | null
  pinned_by: string | null
  attachments: Record<string, unknown>[]
}

export interface TextHistoryPage {
  messages: TextMessage[]
  /** Parents of replies in the page; a missing id means the parent was deleted. */
  replied: Record<string, TextMessage>
  has_more_before: boolean
  has_more_after: boolean
}

export interface TextContextPage extends TextHistoryPage {
  room_id: string
  message_id: string
}

export interface TextHistoryCursor {
  beforeSeq?: number
  afterSeq?: number
  aroundSeq?: number
  limit?: number
}

export type TextNotifyMode = "all" | "no_mentions" | "muted"
export type TextMuteDuration = "1h" | "4h" | "1d" | "1w" | "forever"

/** muted_until is unix ms; null with mode "muted" means forever. */
export interface TextNotifySetting {
  mode: TextNotifyMode
  muted_until: number | null
}

export interface TextUnreadChannel {
  room_id: string
  last_read_seq: number
  newest_seq: number
  mention_count: number
  notify_mode: TextNotifyMode
  muted_until: number | null
}

export interface TextPinsResponse {
  messages: TextMessage[]
}

export interface TextSearchHit {
  message: TextMessage
  /** content_search with U+0001/U+0002 around matches; empty without free text. */
  snippet: string
}

export interface TextSearchResponse {
  hits: TextSearchHit[]
  /** An estimate. */
  total: number
  hints: string[]
  took_ms: number
}

export type TextSearchSort = "relevance" | "newest"

export interface TextUnreadResponse {
  channels: TextUnreadChannel[]
  available: boolean
}

// WebSocket events (server -> client)
export interface TextMessageNewEvent {
  room_id: string
  message: TextMessage
  replied?: Record<string, TextMessage>
  nonce?: string
}

export interface TextMessageUpdatedEvent {
  room_id: string
  id: string
  message: TextMessage
}

export interface TextMessageDeletedEvent {
  room_id: string
  id: string
}

export interface TextReadStateEvent {
  room_id: string
  last_read_seq: number
}

export interface TextMentionEvent {
  room_id: string
  message_id: string
  sender_id: string
}

export interface TextNotifySettingsEvent extends TextNotifySetting {
  room_id: string
}

export interface TextTypingEvent {
  room_id: string
  user_id: string
}

export type TextErrorCode =
  "chat_unavailable" | "rate_limited" | "invalid" | "not_found" | "forbidden" | "write_failed"

export interface TextErrorEvent {
  code: TextErrorCode
  message: string
  nonce?: string
  message_id?: string
}
