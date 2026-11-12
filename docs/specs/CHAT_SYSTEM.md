# Chat System Spec: Text Channels

Status: **Phases 1–2 implemented** (2026-11-10); phases 3–4 pending. See §13 for what shipped.
Date: 2026-11-10
Prototype: `experiments/chat-search/` (its README covers how to run it and the raw numbers)
Related: `docs/specs/MEILI_RELEASE_BACKUP.md` (backups as a deploy step, a separate piece of work)

## 1. Summary

Add a new **text channel** room type (`type: "text"`). It gives persistent, searchable, Discord/Mattermost-style chat with:
- replies, mentions and pings;
- reactions, pins, and basic formatting;
- unicode and custom emoji;
- soft delete and moderation;
- read position tracking;
- attachments with a per-user storage quota (phase 3).

Storage:
- **Messages live only in Meilisearch.** History, context, search, reactions, pins and soft-delete state are all fields of the message document.
- **SQLite holds only non-message state:** channel metadata (the existing `rooms` table), per-user read position, and **attachment bookkeeping** (`chat_attachments`: owner, size, protection, lifecycle; the source of truth for quotas). The message document carries only a display copy of each attachment in `attachments[]`.
- **Attachment files live in S3** (Garage): a dev container locally, an external instance in production (§7.12).

The existing **in-call chat stays as it is** (ephemeral, in memory, `ChatService`).

## 2. Scope

| # | Requirement | Phase |
|---|---|---|
| F1 | New text-only channels | 1 |
| F2 | Send, edit, delete own messages (soft delete, hidden from other users) | 1 |
| F3 | Reply to messages; jump to the replied message | 1 |
| F4 | Mention users and roles; mentioned users get a ping notification with a new sound effect | 2 |
| F5 | Unicode and custom emojis in messages | 1 |
| F6 | Basic formatting: **bold**, *italic*, ~~strikethrough~~, \|\|spoiler\|\| | 1 |
| F7 | Scrollable history (infinite scroll in both directions) | 1 |
| F8 | Opening a channel puts you at your last read message | 1 |
| F9 | Emoji reactions | 2 |
| F10 | Pin messages to a channel | 2 |
| F11 | New permission **Manage Messages**: delete other users' messages, pin and unpin | 1 |
| F15 | Per-channel notification settings: everything (default) / mentions off / muted, where muting asks for a duration | 2 |
| F12 | Fuzzy text search with `in:` `from:` `during:` `after:` `before:` filters | 2 |
| F13 | Attachments: audio (mp3, wav, ogg), images (png, webp, gif, jpeg), video (mp4), stored in a new S3 bucket; new permission **Attach Files** (on by default, denied to guests) | 3 |
| F16 | Per-user attachment quota (5 GB): uploads over it auto-remove the uploader's oldest unprotected files; the uploader can protect files and manage them on a storage page | 3 |
| F14 | Search by attachment contents: pipeline and index fields now, ML later | 4 (architecture now) |

Non-functional
- **N1** Search is fast and responsive: results feel instant while typing (see the budgets in §12).
- **N2** The UI is easy to understand. Use Discord and Mattermost as the reference.
- **N3** Message grouping: consecutive messages from one author are grouped, showing the avatar, nickname and timestamp only once.

Out of scope: voice messages, video "circles", DMs and threads, edit history, an admin audit UI for deleted messages, `@everyone` / `@here` mentions, a seeded "Moderator" role, and Meilisearch backups (separate spec).

## 3. Current state

| Piece | Where | Notes |
|---|---|---|
| Room model | `backend/internal/models/models.go` `Room` (`type`, `category`, `permissions_synced`) | `type` defaults to `"voice"` (`handlers/roomhandler.go`). Add `"text"`. |
| In-call chat | `service/chat.go`, `websocket/hub.go` (`handleSendMessage`, `chat_history`) | Unchanged, except a bug fix: the 2000 limit is counted with `len` (bytes); switch to runes |
| RBAC | `permissions/permissions.go`, `handlers/permissions.go`, `hub.go` `canInRoom`, `PermissionService` | Highest bit in use is `UseSoundboard = 1 << 18`, so the next free one is `1 << 19` |
| Custom emoji | `service/emojiservice.go` (local disk under `dataDir/emojis`, `/api/emojis/{id}/image`), frontend `EmojiGlyph`, `EmojiText`, `EmojiTextInput`, `services/emoji/inlineText.ts` | Reuse the token format `<:shortcode:id>` |
| Markdown | `frontend/src/utils/markdown.ts` (`marked` + `DOMPurify`) | Full markdown. Text channels get a restricted renderer (§7.6). |
| Sounds | `frontend/src/services/sounds.ts` (sprite `/assets/sounds/sprite/default/*`) | Add a `mention` sound |
| S3 | Releases only (Garage, public bucket, `aws` CLI scripts, `docs/notes/MIGRATION_TO_S3.md`) | **No S3 client in the Go backend yet.** Phase 3 adds `aws-sdk-go-v2` (§7.12). Dev Garage: `make garage-up`. |
| Image processing | `h2non/bimg` (libvips), used by `emojivips.go` | Reuse for thumbnails and EXIF stripping |

## 4. Decision record

Decisions (2026-11-10):
- Meilisearch over SQLite FTS5.
- Messages live only in Meilisearch.
- Text channels are a new room type; in-call chat stays ephemeral.
- Edits are in phase 1.
- Search filters by user id. Nicknames are resolved to ids at query time using **current names only**; a message's user id never changes.
- No retention limit.
- Soft delete.
- Snapshots are backed up on every release (separate spec).
- Pinning requires `ManageMessages`.
- Attachments get their own `AttachFiles` permission: granted to `@everyone`, denied to Guest.
- No "Moderator" role is seeded; admins create roles with `ManageMessages` themselves.
- Any role can be mentioned; there is no `@everyone` / `@here`.
- Per-channel notification settings with timed mute (§7.14).

Benchmark: 1M synthetic messages (6 users, 5 rooms, 1 year, mixed Russian and English, 5% typos), `make bench`, **Meilisearch v1.56.2**:

| | SQLite FTS5 (custom typo logic) | Meilisearch v1.56.2 |
|---|---|---|
| Disk at 1M messages | 236 MiB | 819 MiB |
| RAM | ~50 MiB | ~790 MiB (container) |
| Search p50 / p95 / max | 2.9 / 81 / 94 ms | 1.7 / 5.5 / 13 ms |
| Very common term / Cyrillic prefix | 19–81 / 90 ms | 2.8–4.3 / 4.8 ms |
| Typo queries | 2.4–7.2 ms | 1.0–1.7 ms |
| Browse with filters (= a history page) | 0.2–0.6 ms | 2.3–2.5 ms |
| Recall, exact / with typo | 100% / 100% | 100% / 100% |

The production prototype writes only to Meilisearch. The dual writes in `experiments/chat-search` exist only for the comparison.

## 5. Data model

### 5.1 Meilisearch index `text_messages` (primary key `id`)

```jsonc
{
  "id": "1762770000000003",          // decimal string of seq
  "seq": 1762770000000003,           // unix_ms*1000 + counter; unique, monotonic (§6.1)
  "room_id": "…",
  "sender_id": "…",                  // immutable user id; no names stored
  "content": "raw text with tokens", // ≤ 2000 runes, see token grammar §7.5–7.6
  "content_search": "…",             // derived: emoji tokens → :shortcode:, mention tokens removed
  "created_at_ts": 1762770000000,
  "edited_at_ts": null,
  "reply_to_id": null,               // id of parent message
  "mention_user_ids": ["…"],         // parsed from content (incl. reply-ping to parent author)
  "mention_role_ids": ["…"],
  "reactions": [{ "emoji": "👍", "user_ids": ["…"] }, { "emoji": "custom:abc", "user_ids": ["…"] }],
  "pinned": false, "pinned_at_ts": null, "pinned_by": null,
  "is_deleted": false, "deleted_at_ts": null, "deleted_by": null,
  // phase 3/4 (attachments), present but empty until then:
  "attachments": [],                 // see §7.12: {id, kind, mime, size, filename, width, height,
                                     //   duration_ms, has_thumb, peaks, protected, removed?}
  "attachment_kinds": [],            // ["image","video","audio"] for has: filters
  "attachment_names": [],            // original filenames (searchable)
  "attachment_text": "",             // OCR text of the images (searchable, filled by §7.13)
  "_vectors": { "image": null }      // phase 4: CLIP embeddings of the images, or null (§7.13)
}
```

Settings (bootstrapped by the backend at startup; start from `OpenMeili` in the prototype):
- `searchableAttributes: ["content_search", "attachment_names", "attachment_text"]` (the order sets ranking priority)
- `filterableAttributes: ["room_id", "sender_id", "created_at_ts", "seq", "is_deleted", "pinned", "reply_to_id", "mention_user_ids", "mention_role_ids", "attachment_kinds"]`
- `sortableAttributes: ["seq", "created_at_ts", "pinned_at_ts"]`
- `displayedAttributes`: everything except `content_search`
- `typoTolerance.minWordSizeForTypos: {oneTypo: 4, twoTypos: 8}`
- `pagination.maxTotalHits: 1000`
- Evaluate `localizedAttributes` (`rus`, `eng`).
- **Every user-facing read filters on `is_deleted = false`.** We use a boolean rather than `deleted_at_ts IS NULL` so the filter stays trivial.

### 5.2 SQLite (new migrations in `backend/internal/storage/migrations.go`)
```sql
-- read position per user per text channel (F8, unread badges)
CREATE TABLE text_read_state (
  user_id       TEXT NOT NULL,
  room_id       TEXT NOT NULL,
  last_read_seq INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, room_id)
);
-- per-user per-channel notification setting (F15); no row = 'all'
CREATE TABLE text_notify_settings (
  user_id     TEXT NOT NULL,
  room_id     TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('all','no_mentions','muted')),
  muted_until INTEGER,             -- unix ms; NULL with mode='muted' = forever
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, room_id)
);
-- phase 3: every attachment, from upload to purge (§7.12). Source of truth for
-- ownership, quota usage and protection; the message doc holds a display copy.
CREATE TABLE chat_attachments (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL, uploader_id TEXT NOT NULL,
  message_id   TEXT,               -- NULL while pending
  kind TEXT NOT NULL, mime TEXT NOT NULL, ext TEXT NOT NULL, filename TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,   -- original
  stored_bytes INTEGER NOT NULL,   -- original + thumb: what the quota counts
  width INTEGER, height INTEGER, duration_ms INTEGER,
  has_thumb    INTEGER NOT NULL DEFAULT 0,
  peaks        TEXT,               -- audio only: JSON [0..255] x <=200, client-computed
  status       TEXT NOT NULL CHECK (status IN ('pending','attached','removed')),
  protected    INTEGER NOT NULL DEFAULT 0,
  removed_reason TEXT,             -- quota | owner | moderator | message_deleted | channel_deleted | pending_expired
  created_at INTEGER NOT NULL, attached_at INTEGER, removed_at INTEGER,
  purged_at    INTEGER             -- S3 objects deleted; removed + NULL = janitor work left
);
CREATE INDEX idx_chat_att_owner   ON chat_attachments(uploader_id, status, protected, created_at);
CREATE INDEX idx_chat_att_message ON chat_attachments(message_id);
CREATE INDEX idx_chat_att_purge   ON chat_attachments(status, purged_at);
-- phase 4: content extraction queue
CREATE TABLE attachment_jobs (
  attachment_id TEXT NOT NULL, message_id TEXT NOT NULL, extractor TEXT NOT NULL,
  status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  updated_at INTEGER NOT NULL, PRIMARY KEY (attachment_id, extractor)
);
```
`rooms.type` accepts `'text'`. Read state and notification settings should be cleaned up when a channel or user is deleted (a `FOREIGN KEY ... ON DELETE CASCADE`, if the schema uses FKs).

## 6. Architecture

```
 WS  text_message_send / edit / delete / react / pin ─┐
 REST attachments upload (phase 3) ───────────────────┤
                                                      ▼
                         Hub → chatstore.Service
                           1. RBAC (§9), validation, token parsing (mentions, emoji)
                           2. per-message mutation lock (edits/reactions/pins/deletes)
                           3. Meilisearch write (POST/PUT /documents) → await 202
                           4. update pending overlay
                           5. BroadcastRoomScoped event; mention pings to targets
                                                      │
                         Meilisearch  ◀───────────────┘
                           ▲  TaskWatcher: confirms tasks, clears overlay, reverts on failure
 REST history / around / context / pins / search ──▶ chatstore (Meili + overlay)
 WS   text_channel_read ─────────────────────────────▶ text_read_state (SQLite)
```

New package `backend/internal/service/chatstore/`: the Meilisearch client (port `experiments/chat-search/internal/store/meili.go`), the seq generator, the overlay and `TaskWatcher`, the mutation lock, token parsing, and the search query parser. Text channel WS types use the `text_*` prefix so they never mix with the in-call `send_message` / `new_message`.

### 6.1 Ordering key `seq`
`seq = max(now_ms*1000, last+1)`, generated under a mutex. It stays under 2^53, so JSON and JS handle it safely. At startup, `last` is loaded from the newest document (`sort: seq:desc, limit 1`). Every cursor uses `seq`, because Meilisearch filters cannot express tuple cursors. Display time uses `created_at_ts`.

### 6.2 Writes
- **Create.** `POST /documents` returns 202 once the task is enqueued and persisted.
  - Only after the 202 do we broadcast `text_message_new`.
  - If the write fails, the sender gets `chat_unavailable`, no broadcast happens, and the client keeps the draft for a retry.
  - Meilisearch auto-batches consecutive additions.
- **Mutations** (edit, react, pin, soft delete) are read-modify-writes of top-level fields:
  1. Take the lock for that message id (a sharded mutex map; the backend is the single writer).
  2. Read the current state: the overlay's pending version if there is one, otherwise `GET /documents/{id}`.
  3. Apply the change.
  4. `PUT /documents` with **only the changed top-level fields**. Partial merge means an edit and a reaction never clobber each other.
  5. Update the overlay, release the lock, broadcast.
  - Meilisearch processes tasks in enqueue order, so the last write wins consistently.
- **Pending overlay.** An in-memory map of accepted but unconfirmed adds and mutations, keyed by room and by message id. Reads merge it in (de-duplicated by id, patches applied), so a refetch never shows stale data.
  - The `TaskWatcher` polls tasks about every 100 ms while the overlay is non-empty.
  - On a failed task it logs, reverts with a broadcast (`text_message_deleted` for a lost add, a corrected `text_message_updated` for a lost mutation), and notifies the author.
  - Losing the overlay in a crash is harmless, because anything acknowledged is already in Meilisearch's queue.
- **Channel deletion.** Delete by filter (`POST /documents/delete`, `room_id = X`), mark the channel's attachments `removed` (reason `channel_deleted`, which frees the uploaders' quota; the janitor deletes the S3 prefix, phase 3), and delete the read state.
- **Durability test.** `kill -9` Meilisearch right after a 202; the write must still be present after restart.

### 6.3 Reads
- **History.**
  - `POST /search` with `q: ""`, `filter: room_id = X AND is_deleted = false AND <cursor>`, `sort: seq:desc|asc`, `limit 50`.
  - Cursor modes: `before_seq` (scroll up), `after_seq` (scroll down after a jump), `around_seq` (one search each way), and `before_ts` (jump to a date).
  - Offset is always 0, so `maxTotalHits` never applies.
- **Reply previews.** For each page, collect the `reply_to_id`s, fetch them in one `POST /documents/fetch` (`{"ids": [...]}`; results come back unordered and missing ids are silently skipped), and return them as `replied` alongside the page. A parent with `is_deleted` (or that is missing) is rendered as "Original message was deleted".
- **Channel summary cache** (in memory): `newest_seq` per text channel. It is loaded at startup with one `/multi-search` call and updated on every create. Unread badges are derived from it.
- **Unavailability.** If Meilisearch doesn't answer within about 2 s, respond `503 chat_unavailable`. The UI shows the channel as unavailable; voice keeps working.

### 6.4 Schema evolution
- **Index settings changes:** Meilisearch reindexes its own stored documents, so the backend only needs to apply the settings at startup and wait for the task.
- **Document shape changes** (e.g. recomputing `content_search`): a migration job pages through documents by `seq`, transforms them, and re-`PUT`s them. The shape version lives in a small `chat_meta` index.
- **Risky changes:** build a new index, then `POST /swap-indexes`.

## 7. Features

### 7.1 Text channels (F1)
- Created by users with `ManageRooms`, in any category, with name, emoji name and permission inheritance exactly like voice rooms.
- **Backend:** `type: "text"` rooms reject WS join, LiveKit token requests and in-call features (boombox, soundboard, stats). Enforce this server-side, not only in the UI.
- **Sidebar:** a `#` icon. Unread channels show in bold with a dot; channels with mentions show a red count badge (§7.9).

### 7.2 Send, edit, delete (F2, F11)
- **Content:** 1–2000 runes (`utf8.RuneCountInString`); trimmed; not empty unless there are attachments.
- **Edit:** author only. It updates `content`, `content_search`, mentions and `edited_at_ts`. The UI shows "(edited)" with a tooltip giving the time. Mentions **added** by an edit do not ping. There is no edit history.
- **Soft delete:** by the author, or by anyone with `ManageMessages` on that channel.
  - Sets `is_deleted`, `deleted_at_ts`, `deleted_by`, and unpins the message.
  - **Deleted messages are hidden from everyone** (including the author) in history, search, pins and reply previews. The data stays in the index for a possible future moderation or audit view.
  - **Attachments are not kept:** they are removed with reason `message_deleted` and purged from S3, which frees the uploader's quota (§7.12.4).
  - Broadcasts `text_message_deleted {room_id, id, newest_seq}`. Clients remove the message; replies to it show "Original message was deleted". `newest_seq` is the channel's newest seq after the delete, so deleting the newest message clears the unread badge it caused.
- **UX:**
  - Hover toolbar: react, reply, edit (own), more → pin, copy text, copy link, delete.
  - ↑ in an empty composer edits your last message; Esc cancels.
  - Deletes ask for confirmation, which Shift+click skips (as in Discord).

### 7.3 Replies and jump (F3)
- `reply_to_id` points to the parent message, which must be in the same channel and not deleted.
- **Reply ping:** the composer has a "@ mention" toggle, on by default. It adds the parent's author to `mention_user_ids`.
- The rendered reply shows a one-line quote above the message (avatar, name, a truncated plain-text preview). Clicking it jumps to the parent:
  - If the parent is loaded, scroll to it and flash-highlight it.
  - Otherwise load an `around_seq` window, replacing the list, with a "Jump to present" button.

### 7.4 Mentions and pings (F4)
- **Tokens in content:** `<@user_id>` and `<@&role_id>`. This follows the existing `<:shortcode:id>` emoji token style.
- **Composer:** typing `@` opens an autocomplete of channel-visible users (current names) and **all roles** (every role is mentionable). There is no `@everyone` / `@here`. The system roles `everyone` and `guest` are not offered, and their tokens are dropped server-side. The input shows `@Name`, while the model holds tokens (same approach as `EmojiTextInput`).
- **Rendering:** a highlighted pill showing the user's **current** name (or the role name and color). Messages that mention you get a highlighted background.
- **Server:**
  - parses the tokens;
  - drops ids that don't exist and users who can't view the channel;
  - caps a message at 20 mentions.
- **Pings:**
  - On create only, never on edit.
  - Each targeted user (directly, through a role, or as the replied-to author) who can view the channel gets a WS `text_mention {room_id, message_id, sender_id}` on all their sessions. You never ping yourself.
  - **Notification settings are applied on the server** (§7.14): no `text_mention` goes to users whose setting for the channel is `no_mentions`, or `muted` and not expired. Every device behaves the same.
  - A role mention fans out to the role's current members who can view the channel. That is cheap at our scale.
- **Client:**
  - plays the new `mention` sound unless the channel is open and the window has focus;
  - bumps the channel's mention badge;
  - in Electron, flashes the taskbar.
  - Sound volume and an on/off toggle live in notification settings.
- **Mention counts on load** (skipped for channels whose setting is `no_mentions`, or `muted` and not expired): one `/multi-search` with, per channel, `filter: room_id = X AND is_deleted = false AND seq > last_read AND (mention_user_ids = me OR mention_role_ids IN [my roles])` and `limit: 0`, reading `estimatedTotalHits`.

### 7.5 Emojis (F5)
- Unicode emoji, plus custom emoji as `<:shortcode:id>` (existing format, `inlineText.ts`).
- The composer uses the existing `EmojiPicker` plus `:short` autocomplete.
- Rendering goes through the message renderer (§7.6), which uses `EmojiGlyph` for custom emoji.
- A message that consists only of emoji (≤ 27) renders them larger, as Discord does.
- `content_search` turns custom tokens into `:shortcode:` so you can search for them.

### 7.6 Formatting (F6)
- **Supported:** `**bold**`, `*italic*` / `_italic_`, `~~strike~~`, `||spoiler||`, autolinked URLs, and line breaks. A backslash escapes a marker. Nesting is allowed (`**bold *italic***`).
- **Not supported:** headings, lists, tables, images, code blocks and quotes. These render as literal text for now; inline code is a possible later addition.
- **New renderer** `frontend/src/utils/messageMarkup.ts`. It must not use full `marked`.
  - A small tokenizer handles formatting, emoji tokens, mention tokens and links. It produces a token tree, which a Vue component renders (`MessageContent.vue`), so there is **no `v-html`** for message bodies.
  - Spoilers render blurred and are revealed on click.
- **Search:** `content_search` keeps the markers. The Meilisearch tokenizer ignores the punctuation, so matching is not affected, and the frontend runs search snippets through the same renderer.
  - Snippets render formatting, and spoiler text inside a snippet stays blurred.
  - A cropped snippet can leave a marker unbalanced. The tokenizer then treats an unclosed `||` as a spoiler running to the end and ignores other unclosed markers.

### 7.7 History scrolling and grouping (F7, N3)
- **Plain DOM list (not virtualized)** with bidirectional loading. Pages are 50 messages; at most 300 are kept in memory and the far end is trimmed, which keeps rendering cheap without the scroll-anchoring problems of a virtual scroller with variable row heights. Anchoring is manual: the first visible message keeps its position across prepends and trims (`MessageList.vue` `withAnchor`).
- The scroll position stays anchored when older messages are prepended.
- **"Jump to present"** appears when the user is more than one page away from the newest message.
- **Day separators** show between days.
- **Grouping rule:** a message is *compact* (no avatar, name or timestamp; time shown on hover in the gutter) when all of these hold:
  - same `sender_id` as the previous visible message;
  - less than 7 minutes after it;
  - same local day;
  - not a reply.
  Any other message starts a new group with avatar, name and full timestamp.
- **Visible timestamps:** relative for today and yesterday ("Today at 21:04"), otherwise the date and time. The tooltip shows the full timestamp.

### 7.8 Reactions (F9)
- `reactions` is an array of `{emoji, user_ids}` in first-reaction order. There are at most 20 distinct emoji per message. `emoji` is either a unicode string or `custom:<id>`.
- **Toggle:** WS `text_reaction_toggle {message_id, emoji}`. The server does a read-modify-write under the message lock and broadcasts `text_message_updated` with `{id, reactions}`.
- **UI:**
  - chips under the message showing a count, highlighted if you reacted;
  - clicking a chip toggles your reaction;
  - hovering shows who reacted (current names);
  - "+" opens the emoji picker.
- Reactions are not searchable.

### 7.9 Read state and opening at the last read message (F8)
- **Advancing read state:** the client sends `text_channel_read {room_id, seq}`, debounced (~1 s), when the newest visible message advances and the window has focus.
  - The server stores `max(last_read_seq, seq)` in `text_read_state`.
  - It sends `text_read_state` to the user's other sessions, so state syncs across devices.
- **Opening a channel:**
  - Fetch `around_seq = last_read_seq`.
  - Show a "New messages" divider above the first unread message and scroll so the divider sits near the top.
  - With no unread messages, open at the bottom.
  - The first open of a channel defaults to the bottom.
- **Unread badges:** a channel is unread when `newest_seq > last_read_seq`, using the channel summary cache. Mention badges come from §7.4. Both are adjusted by the notification setting (§7.14).
- **Marking read:** "Mark as read" on the channel context menu, and Esc while viewing a channel, mark it read up to `newest_seq`.

### 7.10 Pins (F10)
- **Who can pin:** pin and unpin require **`ManageMessages`** in the channel. Users without it see pins (pins panel, pin marker) but not the pin action.
- **Limit:** 50 pins per channel. Pinning number 51 is rejected with an error.
- **Fields:** `pinned`, `pinned_at_ts`, `pinned_by`.
- **Pins panel:** opened from the pin icon in the channel header. It lists `pinned = true AND is_deleted = false`, sorted `pinned_at_ts:desc`; clicking an item jumps to the message.
- **Pinning also:** posts an inline system line "X pinned a message" in the channel. This is a client-rendered event, not a stored message.

### 7.11 Search (F12, N1)

**Query syntax** (parsed on the backend in `chatstore/query.go`, so every client behaves the same):

| Token | Meaning |
|---|---|
| `from:<user>` / `from:@user` / `from:"Name With Spaces"` | Author. The **current** display name or username is resolved to user ids: exact case-insensitive match first, otherwise prefix. Repeat the token to OR several authors. |
| `in:<channel>` / `in:#channel` | Text channel by plain name (emoji tokens stripped, as `emojiTextToPlain` does). Only channels the user can view. Can be repeated. |
| `during:<date>` | A whole day (`2026-11-10`), month (`2026-11`), `today`, or `yesterday` |
| `after:<date>` / `before:<date>` | Exclusive bounds, as in Discord. They combine with each other and with `during:`. |
| `has:photo\|video\|audio\|file` | Attachment kind (`image`/`picture` and `sound`/`voice` are aliases; `file`/`attachment` means any). Repeated tokens must all match (`has:image has:audio`). Filters `attachment_kinds`; removed files no longer match. Other values (`link`) return no results plus a hint. |
| `mentions:@user`, `pinned:true` | Optional extras (cheap; the filters already exist) |
| anything else | Free text, fuzzy (typo-tolerant, last word treated as a prefix) |

- **Time zone:** dates are interpreted in the user's IANA time zone, sent as `tz=Europe/Moscow`.
- **Errors:** unknown keys are treated as text. An unresolvable `from:` or `in:` returns zero results with a `hints` entry ("no user named …").
- **Text query:** passed raw with `matchingStrategy: "all"`, plus the `typoTolerance` settings from §5.1. Quoted phrases (`"exact phrase"`) are passed through as Meilisearch phrase search.
- **Forced filter:** `room_id IN [viewable text channels] AND is_deleted = false` is **always** added. User-supplied `in:` values are intersected with that set.
- **Sort:** relevance when there is free text, newest when there are only filters. The user can switch with a toggle.
- **Response:** hits with a `snippet` (control-character highlight tags turned into mark spans, then run through the message renderer) and `total` (an estimate, shown as "≈"). Paging uses "Load more".

**UI** (Discord-like):
- A search box in the channel header. Typing a key (`from:`, `in:`, …) shows value suggestions (users, channels, a date picker); accepted tokens become chips.
- Search runs as you type, debounced by 200 ms.
- Results appear in a right-side panel. Each shows channel, author, time, and the snippet with highlights.
- Clicking a result jumps to the message in context (`around_seq`, with a highlight).
- `Ctrl/Cmd+F` focuses the search box.

### 7.12 Attachments (F13): phase 3

#### 7.12.1 Storage backend
- **Bucket:** a private bucket `orbital-chat-media` on Garage S3. It is never public, and no CORS is needed (media elements and `<img>` follow redirects without it, and audio waveforms come from stored peaks, §7.12.2).
  - Object keys: `rooms/{room_id}/{attachment_id}/original.{ext}`, plus the derived `thumb.webp` (images, and the first frame of a GIF). A `poster.webp` for video is reserved for later, if server-side probing is ever added.
- **Environments:**
  - Development: `make garage-up` starts `dxflrs/garage:v2.5.0` from `docker-compose.dev.yml` in single-node mode. On first start it creates the layout, a fixed dev key and the bucket (`garage/garage-dev.toml`). The backend's development defaults match it, following the Meilisearch precedent.
  - Production: an external Garage instance. It needs the bucket and a read/write key, and its public endpoint must be HTTPS.
- **Client:** `aws-sdk-go-v2` (`aws`, `credentials`, `service/s3`), wrapped behind a small `MediaStore` interface (`Put`, `Delete`, `DeleteMany`, `PresignGet`) so tests can use a fake.
  - Garage settings: `UsePathStyle = true`, region `garage`, `RequestChecksumCalculation` / `ResponseChecksumValidation = WhenRequired`.
  - Two endpoints:
    - `CHAT_MEDIA_S3_ENDPOINT` is how the backend reaches Garage; it may be internal.
    - `CHAT_MEDIA_S3_PUBLIC_ENDPOINT` is the host signed into presigned URLs. It must be reachable by browsers and Electron, and defaults to the internal endpoint.
    - Presigning is offline, using a second client configured with the public endpoint.
- **Disabled mode:** without S3 config, attachments are off. The client config exposes `attachments_enabled: false`, and the composer hides the attachment button.

#### 7.12.2 Upload flow
1. `POST /api/rooms/{id}/attachments` (multipart, one file per request, with a progress bar on the client).
2. RBAC: `SendMessages` **and** `AttachFiles` on the channel. Without `AttachFiles`, the composer hides the attachment button, and paste or drop of files is rejected with a hint. Rate limit: `RATE_LIMIT_CHAT_UPLOAD_PER_HOUR` per user.
3. The file part is spooled to a temp file. Size limits (configurable) are enforced while reading: images 20 MB, audio 25 MB, video 100 MB.
4. Content sniffing on magic bytes against an allowlist (png, webp, gif, jpeg, mp3, wav, ogg, mp4). The extension and the client-sent MIME type are not trusted.
5. Per kind:
   - **Images:** strip EXIF and render a thumbnail with bimg/libvips (as `emojivips.go` does). Record width and height.
   - **Audio:** stored as-is, with no transcoding and no server-side probing. A waveform is precomputed on the client:
     - Before uploading, the client decodes the picked file locally (`file.arrayBuffer()`, then `AudioContext.decodeAudioData`). It downsamples to **200 peaks** (the max of `|sample|` per bucket, mono, normalized, quantized to 0–255) and takes `duration_ms` from the decoded buffer.
     - Both are sent as multipart fields next to the file (`peaks` as a JSON int array). If decoding fails (unsupported codec, out of memory), the file is uploaded without them.
     - The server drops `peaks` unless it has at most 200 integers in 0–255, and clamps `duration_ms` to 1 ms–6 h. The values are for display only.
   - **Video:** no server-side probing (no ffprobe).
     - The client reads `duration_ms`, `width` and `height` from a local media element and sends them with the upload. The server clamps and sanity-checks them. They are used to reserve a correctly sized box so the layout doesn't jump.
     - There is no server-generated poster in v1; `<video preload="metadata">` shows the first frame.
     - Known limitation: an `.mp4` with a codec the browser can't play (e.g. HEVC) is accepted, and the player falls back to a download link. Server-side probing (ffprobe in the backend image) could later add trusted metadata, codec checks and posters.
6. **Reserve quota** (§7.12.3) under a per-user mutex. This may evict old files. Then insert the `chat_attachments` row with `status 'pending'`.
7. PUT the original (and thumb) to S3. If that fails, delete the row; the reservation is released.
8. Return `{upload_id, kind, meta, evicted: [{id, filename, stored_bytes}], usage}`. `usage` has the same shape as `GET /api/me/attachments/usage`.

- **Send:** `text_message_send {…, upload_ids: [≤10]}` (requires `AttachFiles` when `upload_ids` is non-empty). The server:
  - validates that the uploads belong to the sender, are in the same room and are still pending;
  - embeds the metadata into `attachments[]` (`{id, kind, mime, size, filename, width, height, duration_ms, has_thumb, peaks, protected}`);
  - sets `attachment_kinds` and `attachment_names`;
  - marks the rows `attached` (`message_id`, `attached_at`).
- **Pending GC:** pending rows older than 24 h are removed (reason `pending_expired`) and purged like any other removal (§7.12.4).

#### 7.12.3 Quota and auto-removal
- **Quota:** each user gets `CHAT_MEDIA_QUOTA_MB` (default **5120**, i.e. 5 GB). It is enforced on the backend only.
- **Usage:** `SUM(stored_bytes)` over the user's `pending` and `attached` rows, so thumbnails count too.
- **Reservation** for a new upload of `need = stored_bytes`. It runs under a per-user mutex, so concurrent uploads can't both pass:
  1. If `need > quota`, reject with `413 file_exceeds_quota`.
  2. If `need > quota − protected_bytes − pending_bytes`, reject with `413 quota_protected_full` ("Your protected files fill your storage — unprotect or delete some files").
  3. Otherwise, evict the user's `attached`, unprotected rows, **oldest `created_at` first**, until `used + need ≤ quota`. This happens in the same transaction that inserts the new pending row.
- **What is never evicted:**
  - Pending rows: they are files sitting in a composer right now.
  - Protected rows.
  - Other users' files. Only a user's own uploads can evict that user's files.
- **Effect:** evicted rows become `removed` with reason `quota`, which frees the quota immediately. S3 deletes and document updates follow asynchronously (§7.12.4), so a slow or failing S3 never blocks the upload.
- **Quota changes:** lowering `CHAT_MEDIA_QUOTA_MB` takes effect on the user's next upload. If protected files alone exceed the new quota, uploads are rejected until the user frees space.
- **Client feedback:**
  - After an upload that evicted files, a toast says "Removed 2 oldest files (340 MB) to make room · Manage storage".
  - Once usage is ≥ 90 %, the composer shows a warning chip.

#### 7.12.4 Removal and purge
Every removal reason goes through one path:
1. Mark the row `removed` with `removed_reason` and `removed_at`.
2. If the attachment was attached to a message, update the message document through the §6.2 mutation path:
   - set `attachments[i].removed = <reason>`;
   - drop the attachment from `attachment_kinds`, `attachment_names` and `attachment_text`;
   - broadcast `text_message_updated`.
   Messages that are themselves deleted skip this step.
3. **Janitor:** a background loop, shared with the pending GC, deletes the S3 objects of rows with `status = 'removed' AND purged_at IS NULL`, then sets `purged_at`. Failures are retried on the next pass.

Removed rows stay as small tombstones (for the message tombstone and audits) and are pruned 90 days after `purged_at`.

Removal reasons:

| Reason | Trigger |
|---|---|
| `quota` | Auto-removal during an upload by the same user (§7.12.3) |
| `owner` | The uploader deletes the file (context menu or storage page) |
| `moderator` | A user with `ManageMessages` on the channel deletes the file |
| `message_deleted` | The message is deleted, by its author or a moderator. Files are **purged** and the space is freed (they are not kept with the soft-deleted message). |
| `channel_deleted` | The channel is deleted |
| `pending_expired` | An upload was never sent within 24 h |

- **Single-file delete:** `DELETE /api/attachments/{id}`. Allowed for the uploader, or for a user with `ManageMessages` on the room. The message stays and shows a tombstone in place of the file.

#### 7.12.5 Protection
- A protected file is never auto-removed. It still counts toward the uploader's quota.
- `PATCH /api/attachments/{id} {protected: bool}`:
  - **uploader only**: others get `403`, or `404` without `ViewRoom`;
  - only for `attached` rows.
  - The value is mirrored to `attachments[i].protected` through a document mutation plus `text_message_updated`, so everyone sees a small lock badge.
- Protection is set from the attachment context menu (§7.12.7) or from the storage page (§7.12.8).

#### 7.12.6 Delivery
- `POST /api/attachments/urls {items: [{id, variant}]}` (≤100 items) returns `{urls: {"<id>:<variant>": {url, expires_at}}, gone: [ids]}`. The API authenticates with a Bearer header that `<img>`/`<video>`/`<audio>` cannot send, so clients fetch presigned URLs in batches (one request per rendered page) and cache them until shortly before `expires_at` (15 min TTL). An element whose URL fails is refetched once.
- Per file:
  - `removed` (or unknown) → listed in `gone`; clients render the tombstone;
  - the **uploader** can always fetch their own files, even after losing `ViewRoom`, because the storage page lists them;
  - anyone else needs `ViewRoom` on the channel and an `attached` file (deleted messages purge their files, so no message lookup is needed).
- Variants: `original`, `thumb` (falls back to the original without a thumbnail), and `download`, which presigns with `ResponseContentDisposition: attachment; filename*=UTF-8''<filename>`.
- `PATCH`/`DELETE /api/attachments/{id}` return `410 Gone` for removed files and `404` for files the caller cannot see.
- In Electron, opening or downloading a presigned URL goes to the system browser (the main window sends every external `window.open`/navigation there).

#### 7.12.7 Rendering
- **Layouts per kind:**
  - images in a grid; a click opens a lightbox. GIFs honor the existing reduce-motion setting;
  - `<video preload="metadata">` (first frame, no server poster), in a box sized from `width`/`height`;
  - audio in a compact wavesurfer player (already a dependency):
    - `WaveSurfer.create({ container, media: audioEl, peaks: [peaks.map(p => p / 255)], duration: duration_ms / 1000, barWidth: 2, … })`, where `audioEl` is `<audio preload="none">` with the presigned `original` URL;
    - with `media`, `peaks` and `duration` given, wavesurfer draws the stored waveform **without fetching or decoding the audio**. Playback streams through the media element, so history shows waveforms instantly and no audio bytes load until play;
    - without peaks, it shows a plain seek bar, and the duration appears from the metadata once loaded;
  - a filename and size row for each.
- **Attachment context menu:** opened by right-click, a `⋯` button on hover, or long-press on mobile.
  - Everyone: Open, Download.
  - The uploader:
    - "Protect from auto-removal" / "Allow auto-removal";
    - Delete file;
    - Manage my storage.
  - `ManageMessages`: Delete file.
- **Tombstone:** a removed file renders as a compact row: "📎 filename — removed (storage limit | by uploader | by moderator)".

#### 7.12.8 Storage page (`/files`)
- **Page:** a standalone route `/files` (`views/MyFilesView.vue`, for signed-in non-guests), built like `/admin`. It always opens in a **new tab** (`window.open("/files", "_blank")`), so an ongoing call in the main tab is never touched.
  - Entry points:
    - "My files" in Account settings, next to the Admin Panel button;
    - "Manage my storage" in the attachment context menu;
    - the eviction toast.
  - Electron: the main window's `setWindowOpenHandler` opens app URLs (`#/files`) as a child app window with the same preload and session; external URLs still go to the system browser.
- "Jump to message" is relayed over a `BroadcastChannel` to an open app tab (`services/attachments/jumps.ts`); without one, a new app tab opens with `?open_message=<room>:<message>`.
- **Header:**
  - a usage bar ("3.2 GB of 5 GB") with protected and pending segments;
  - one line explaining that the oldest unprotected files are removed automatically when storage is full.
- **Toolbar:**
  - kind filter: All / Images / Video / Audio;
  - channel filter;
  - sort: Oldest (default, which is the removal order), Newest, Largest;
  - filename search;
  - a "Protected only" toggle.
- **Rows:**
  - thumbnail or kind icon, filename, size, channel, upload date;
  - badges: 🔒 protected, and "removed next" on the oldest unprotected files that together add up to about 10 % of the quota (the tooltip says so);
  - actions:
    - jump to message: opens the `around_seq` deep link, in the opener tab when one exists. Disabled without `ViewRoom`;
    - download;
    - protect toggle;
    - delete, with a confirmation.
- **Bulk:** multi-select for delete, protect and unprotect.
- **Freshness:** there is no live socket. The page refetches when opened, when its tab regains focus, and after each action.
- **API:**
  - `GET /api/me/attachments?kind=&room_id=&sort=oldest|newest|largest&q=&cursor=&limit=50` returns `{items, next_cursor}`: only the caller's own `pending` and `attached` rows, each with its room name.
  - `GET /api/me/attachments/usage` returns `{quota_bytes, used_bytes, protected_bytes, pending_bytes, count}`.
  - `POST /api/me/attachments/bulk {ids: [≤100], action: "delete"|"protect"|"unprotect"}`. Each id is checked as in the single-item endpoints, and the response reports per-id results.

### 7.13 Search by attachment contents (F14)
Images only (phase 4). Audio/video transcripts are not planned yet; an OpenAI-compatible Whisper server (e.g. speaches) could be a second `Extractor` later.

- **ML service: an existing Immich ML** (`ghcr.io/immich-app/immich-machine-learning`), called over HTTP (`backend/internal/service/immichml`). We write no ML code and manage no models: Immich downloads and caches them itself. Decided on 2026-11-12. The alternatives were PaddleX serving for OCR plus Infinity for embeddings, Tika/Tesseract, and hosted embedding APIs.
  - Models: OCR `ESLAV__PP-OCRv5_mobile` (East Slavic recognition: ru/be/uk + en; Immich lists it as "PP-OCRv5_mobile (Russian, Belarusian, Ukrainian and English)"). Plain `PP-OCRv5_mobile` reads Cyrillic as Latin look-alikes ("ИТОГО" → "MTOTO"). Other prefixes in `immich_ml/models/constants.py`: `EN__`, `LATIN__`, `CH__`, …. CLIP `XLM-Roberta-Large-Vit-B-16Plus` (multilingual text encoder, so Russian queries work).
  - API (Immich-internal, no versioned docs; `immichml/client_test.go` pins it): `GET /ping`; `POST /predict` as multipart `entries` (JSON) + `image` or `text`. OCR and CLIP visual go in one request; CLIP embeddings come back as a JSON array **inside a string**.
  - Its errors: transport, timeout and 5xx (a model still downloading) mean "unavailable" and pause the worker without using attempts; 4xx counts as a failed attempt.
  - Pin the Immich tag (dev: `docker-compose.dev.yml`) and run the `immichml` integration test before an upgrade.
- **Index fields** (§5.1): `attachment_text` (OCR lines of the message's live images, joined in file order), `attachment_names`, `attachment_kinds`, and `_vectors.image`: one CLIP vector per image, through the `userProvided` embedder `image`.
- **Jobs** live in SQLite `chat_attachment_jobs`, one row per image attachment: status (pending/done/failed), attempts and backoff, the result text and vector, and a `signature` naming the models.
  - The worker (single goroutine in `chatmedia`, extract.go) queues every attached image without a row, at startup, after each attach and every 30 s. So images sent before the feature was enabled are backfilled.
  - It processes newest files first. It reads the original from S3 and sends a JPEG of at most 1440 px per side (the 640 px thumbnail is too small for OCR).
  - Retries back off exponentially (1 min … 6 h); after 6 failed attempts a job is `failed`.
  - A model change gives a new signature, which re-queues every done or failed job at startup.
- **Writing results:** after each job and after any file removal, the message's content is rebuilt from the done jobs of its *live* files and written with the §6.2 mutation path (`SetAttachmentContent`). Removing one of three images therefore drops exactly its text and vector. These fields are search-only and never broadcast.
- **Embedder:** created lazily with the size of the first vector.
  - A `userProvided` embedder rejects every document without `_vectors.image`, including text-only ones. So every new document is written with `_vectors: {image: null}`, and existing documents get the same opt-out (batches of 1000) before the embedder is created.
  - A model with another size removes and re-creates the embedder.
  - Clearing uses a plain `null`: `{embeddings: null, regenerate: false}` keeps the old vectors.
- **Query side:** keyword search is unchanged and already matches `attachment_text`.
  - With CLIP enabled, a relevance-ordered search with text embeds the query (2 s timeout) and runs a federated `/multi-search`: the keyword query, plus a pure vector query (`semanticRatio: 1`) restricted to `attachment_kinds = image` with `rankingScoreThreshold: CHAT_ML_SEMANTIC_THRESHOLD`.
  - Federation merges by score and lists a message found by both queries once. The threshold matters: every image has *some* similarity to any text. Meilisearch scores cosine c as about (1+c)/2, and CLIP text/image matches are c ≈ 0.2–0.35.
  - Newest-first and filter-only searches never embed.
  - Any failure (Immich down, timeout, wrong size, Meilisearch rejecting the vector query) falls back to keyword-only.
- **Inspecting results ("What search sees"):** the attachment menu of an image opens a modal (`AttachmentContentModal.vue`) when `/api/config` reports `attachments.content_search`.
  - `GET /api/attachments/{id}/content` (anyone who can see the file) returns the job state (`status`, `attempts`, `next_attempt_at`, `last_error`), the models of the stored result and whether they are current, the OCR `text`, and the embedding (`vector: {dims, values}`). The modal polls it while the job waits.
  - With `?q=<phrase>` (≤200 characters) it also embeds the phrase like a search query and returns `match {cosine, score, threshold, matches}`, where `score = (1+cosine)/2` is compared with `CHAT_ML_SEMANTIC_THRESHOLD`. Use it to tune the threshold.
  - `POST /api/attachments/{id}/content/retry` (uploader or `ManageMessages`, `202`) queues the image again with fresh attempts; the old result stays until the new one is stored.
  - The worker logs each run (`Extraction: N file(s) to process`), each result (`Extracted <file> in 1.2s: N characters of text, 640-dimension vector`) and each failure.

### 7.14 Notification settings per channel (F15)
- **Modes** (per user, per text channel; default `all` when there is no row):

  | Mode | Unread dot / bold | Mention badge | Mention ping (sound, taskbar flash) | Channel in sidebar |
  |---|---|---|---|---|
  | `all` (default) | yes | yes | yes | normal |
  | `no_mentions` | yes | no | no (mentions still highlighted in the message) | normal, with a "bell off" icon |
  | `muted` | no | no | no | dimmed, with a "muted" icon |

- **Muting asks for a duration** in a modal: **1 hour, 4 hours, 1 day, 1 week, Forever**.
  - The modal is a small radio list with a confirm button. Mount it at the app root and open it through store state: the channel context menu is a popover, see AGENTS.md "Modals opened from popovers".
  - The server stores `muted_until = now + duration`, or `NULL` for forever.
  - Expiry is lazy: every read treats an expired `muted_until` as `all`. A small server timer also pushes `text_notify_settings` to the user's sessions when a mute ends, so the sidebar updates without a reload.
- **Where to change it:**
  - channel context menu: "Mute channel ▸" (opens the modal), "Disable mentions", "Notify me about everything";
  - a bell icon in the channel header with the same options;
  - the current state is shown as "Muted until 21:04 Tue" / "Muted forever" and offers "Unmute".
- **Enforced on the server:**
  - `text_mention` is not sent for `no_mentions` or for active `muted`;
  - `/api/chat/unread` returns `notify_mode` and `muted_until` per channel and skips mention counts where they don't apply.
  - The client only renders what the server says.
- Changes sync to all of the user's sessions via WS `text_notify_settings {room_id, mode, muted_until}`.
- Opening a muted channel works normally: read state still advances and history is unaffected.
- The global sound setting (§7.4, mention sound on/off and volume) stays a separate, app-wide switch on top of this.

## 8. API

JSON is snake_case (see AGENTS.md). Types go in `frontend/src/types/index.ts`; API calls go in `frontend/src/services/api.ts`.

REST
| Endpoint | Purpose |
|---|---|
| `GET /api/rooms/{id}/messages?before_seq=\|after_seq=\|around_seq=\|before_ts=&limit=` | History page with `messages`, `replied` (parent previews), `has_more_before`, `has_more_after` |
| `GET /api/messages/{id}/context?n=25` | Window around a message (search jump, reply jump) |
| `GET /api/rooms/{id}/pins` | Pinned messages |
| `GET /api/rooms/{id}/viewers` | `user_ids` of everyone with `ViewRoom` (404 unless the caller has it). The user list shows only them while the channel is open and refetches on `permissions_updated`. |
| `GET /api/chat/search?q=&tz=&sort=&limit=&offset=` | Search; `q` contains the inline filters (§7.11). Returns `hits`, `total`, `hints`, `took_ms`. |
| `GET /api/chat/unread` | Per channel: `last_read_seq`, `newest_seq`, `mention_count`, `notify_mode`, `muted_until` (for the sidebar on load) |
| `PUT /api/rooms/{id}/notify` `{mode, mute_duration: "1h"\|"4h"\|"1d"\|"1w"\|"forever"}` | Change the notification setting (`mute_duration` only with `mode: "muted"`); requires `ViewRoom` |
| `POST /api/rooms/{id}/attachments` (phase 3) | Upload (multipart; audio adds `peaks`, `duration_ms`; video adds `width`, `height`, `duration_ms`). Returns `upload_id`, `meta`, `evicted`, `usage`. 413 `file_exceeds_quota` / `quota_protected_full`. |
| `POST /api/attachments/urls` `{items: [{id, variant}]}` (phase 3) | Batched presigned URLs (`original`, `thumb`, `download`); removed or invisible files in `gone` |
| `PATCH /api/attachments/{id}` `{protected}` (phase 3) | Protect / unprotect; uploader only |
| `DELETE /api/attachments/{id}` (phase 3) | Remove one file; uploader or `ManageMessages` |
| `GET /api/attachments/{id}/content[?q=]` (phase 4) | OCR text, embedding and job state of an image; with `q`, how the phrase scores (§7.13) |
| `POST /api/attachments/{id}/content/retry` (phase 4) | Re-run extraction of an image; uploader or `ManageMessages` |
| `GET /api/me/attachments?kind=&room_id=&sort=&q=&cursor=&limit=` (phase 3) | Caller's own files for the storage page |
| `GET /api/me/attachments/usage` (phase 3) | `quota_bytes`, `used_bytes`, `protected_bytes`, `pending_bytes`, `count` |
| `POST /api/me/attachments/bulk` `{ids, action}` (phase 3) | Bulk delete / protect / unprotect of own files (≤100) |

WebSocket. Client → server:
- `text_message_send {room_id, content, reply_to_id?, reply_ping?, upload_ids?, nonce}`. The `nonce` lets the client match its optimistic message to the ack.
- `text_message_edit {message_id, content}`
- `text_message_delete {message_id}`
- `text_reaction_toggle {message_id, emoji}`
- `text_pin {message_id, pinned}`
- `text_channel_read {room_id, seq}`
- `text_typing {room_id}` (optional; typing indicator; throttled to 1 every 3 s)

Server → client:
- `text_message_new {room_id, message, replied?, nonce?}` (`replied` carries the parent preview of a reply)
- `text_message_updated {room_id, id, message}` (the full public message, simpler for clients than a field diff)
- `text_message_deleted {room_id, id, newest_seq}`
- `text_mention {room_id, message_id, sender_id}`
- `text_read_state {room_id, last_read_seq}`
- `text_notify_settings {room_id, mode, muted_until}` (to the user's own sessions; also sent when a mute expires)
- `text_typing {room_id, user_id}`
- errors: `text_error {code, message, nonce?, message_id?}` with `code` one of `chat_unavailable`, `rate_limited`, `invalid`, `not_found`, `forbidden`, `write_failed` (a reverted write); plus the existing `permission_denied` reply for missing permissions.

Room events go to **global sockets only** (`/ws`, not the per-call `/ws/{room}`), re-checking `ViewRoom` per event, so a user in a call does not get every event twice (`websocket/textchat.go` `broadcastText`). Mentions, read state and notification settings go to the target user's sessions only. Add a send rate limit of about 5 messages per 5 s per user and channel.

## 9. RBAC (backend-enforced)

| Action | Permission |
|---|---|
| See the channel, read history, context, pins, search hits, receive events | `ViewRoom` |
| Send, reply, react | `SendMessages` |
| Pin / unpin | **`ManageMessages`** |
| Edit | author only |
| Delete own | author |
| Delete others' | **`ManageMessages`** (new) |
| Upload attachments, send messages with attachments (phase 3) | `SendMessages` + **`AttachFiles`** (new) |
| Protect / unprotect a file (phase 3) | uploader only |
| Delete a single file (phase 3) | uploader, or **`ManageMessages`** |
| List and manage own files on the storage page (phase 3) | signed-in non-guest; own files only, even in channels no longer visible |
| Change own notification setting | `ViewRoom` |
| Create, rename or delete text channels | `ManageRooms` (existing) |

**New permission `ManageMessages = 1 << 19`.** It is **room-scoped** (it can be granted or denied per category or channel, like `KickMembers`), not role-only. Checklist (AGENTS.md):
1. `backend/internal/permissions/permissions.go`: add the bit, include it in `All` and `Names` (`manage_messages`), and add it to `DefaultAdmin`.
2. `backend/internal/storage/migrations.go`: a migration that ORs the bit into the admin role (`UPDATE roles SET permissions = permissions | X WHERE id = 'admin'`).
3. `frontend/src/types/permissions.ts`: the bit, plus a `PERMISSION_INFO` entry ("Manage Messages: delete other members' messages"). It is not in `ROLE_ONLY_PERMISSIONS`.
4. No "Moderator" role is seeded. Admins create one and grant the bit through the existing roles editor.

**New permission `AttachFiles = 1 << 20`.** It is room-scoped (overwritable), **on by default, denied to Guest**. Checklist:
1. `permissions.go`: add the bit, include it in `All` and `Names` (`attach_files`), add it to `DefaultEveryone` and to `DefaultGuestDeny`.
2. `migrations.go`: a migration that follows the existing grant pattern (`UPDATE roles SET permissions = permissions | X WHERE id = 'everyone'; UPDATE roles SET deny_permissions = deny_permissions | X WHERE id = 'guest';`), since changing the `Default*` sets only affects fresh databases.
3. `frontend/src/types/permissions.ts`: add the bit and a `PERMISSION_INFO` entry ("Attach Files: upload images, audio and video"). It is not role-only.
4. It can be added in phase 1 together with `ManageMessages`, so both migrations land at once, even though uploads ship in phase 3.

Search and history permissions are checked per request, so changes apply immediately and no documents are touched. `Hub.OnPermissionsChanged` must stop event delivery for channels that become hidden and push updated unread and channel lists.

Denied-path tests:
- search never returns hidden channels, even when they are named with `in:`;
- history, context and pins return 403/404 for hidden channels;
- send and react without `SendMessages` are rejected; pin/unpin without `ManageMessages` is rejected;
- uploads, and sends with `upload_ids`, without `AttachFiles` are rejected (including for Guests by default);
- protecting someone else's file is rejected; deleting someone else's file needs `ManageMessages`;
- `/api/me/attachments` never lists another user's files; a removed file returns 410 to everyone;
- `<@&everyone>` / `<@&guest>` tokens are dropped and ping nobody;
- no `text_mention` for users with `no_mentions` or an active mute; the mute expires correctly at `muted_until`;
- editing someone else's message is rejected;
- deleting someone else's message without `ManageMessages` is rejected; with it, the delete succeeds;
- deleted messages never appear in history, search, pins or reply previews;
- mentions of users who can't view the channel are dropped, and they get no ping;
- `type: "text"` rooms reject join and LiveKit token requests.

## 10. UX guidelines (N2)

- Discord-style layout:
  - text channels in the sidebar under their category, marked with `#`;
  - the header holds the channel name, pin and search icons, and the search box;
  - the composer sits at the bottom with "Replying to X ✕", an attachment button, and emoji picker and `@`/`:` autocomplete.
- Mattermost-style touches: a clear "New messages" divider, "Jump to present", and the search results panel on the side.
- Follow the existing themes and tokens (`frontend/src/style.css`, `.impeccable.md`). The UI is dark only.
- Shortcuts:
  - Enter sends; Shift+Enter adds a newline.
  - ↑ edits your last message; Esc cancels a reply or edit, or marks the channel read.
  - Ctrl/Cmd+F searches.
- Optimistic sending: the message shows immediately, dimmed, until `text_message_new` with the matching `nonce` arrives. On error it gets a red "retry" marker.
- Accessibility: keyboard reachable hover actions, a toggleable reduced motion for GIFs and animated emoji (already exists), and spoilers revealed by Enter as well as by click.
- Mobile: reuse the existing mobile patterns. Hover actions become a long-press menu.

## 11. Configuration, deployment, backups

| Var | Default | Notes |
|---|---|---|
| `MEILI_URL` | `http://meilisearch:7700` | If empty, text channels are disabled and the UI hides the type |
| `MEILI_API_KEY` | none | Scoped key (`documents.*`, `search`, `tasks.get`, `indexes.*`, `settings.*`), not the master key |
| `MEILI_INDEX` | `text_messages` | |
| `CHAT_MEDIA_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY/REGION` | dev: `http://localhost:3900`, `orbital-chat-media`, the dev key from `docker-compose.dev.yml`, `garage`; prod: none | Phase 3. If unset outside development, attachments are disabled. |
| `CHAT_MEDIA_S3_PUBLIC_ENDPOINT` | `CHAT_MEDIA_S3_ENDPOINT` | Phase 3. Host signed into presigned URLs; must be browser-reachable (HTTPS in production). |
| `CHAT_MEDIA_MAX_IMAGE_MB/AUDIO_MB/VIDEO_MB` | 20/25/100 | Phase 3 |
| `CHAT_MEDIA_QUOTA_MB` | 5120 | Phase 3. Per-user attachment storage (§7.12.3) |
| `RATE_LIMIT_CHAT_UPLOAD_PER_HOUR` | 120 | Phase 3. Per-user upload rate |
| `CHAT_ML_URL` | none | Phase 4. Immich ML base URL (port 3003). Unset = no search by image contents. Needs attachments. Dev: `make ml-up`, then `http://localhost:3003` |
| `CHAT_ML_OCR_ENABLED` / `CHAT_ML_CLIP_ENABLED` | true / true | Phase 4. Turn OCR or image embeddings off separately |
| `CHAT_ML_OCR_MODEL` | `ESLAV__PP-OCRv5_mobile` | Phase 4. Language-prefixed name, see §7.13 |
| `CHAT_ML_CLIP_MODEL` | `XLM-Roberta-Large-Vit-B-16Plus` | Phase 4. Must be multilingual; a change re-indexes every image |
| `CHAT_ML_SEMANTIC_THRESHOLD` | 0.6 | Phase 4. Minimum ranking score (0..1) of images found by meaning only |
| `CHAT_ML_TIMEOUT_SECONDS` | 120 | Phase 4. Per request (the first one may wait for a model download) |

Immich ML (phase 4): production reuses the existing Immich instance's machine-learning container. It usually listens only on Immich's internal compose network, so either attach the backend to that network or publish port 3003 on a private interface; never expose it publicly. Asking it for a CLIP model other than the one Immich uses loads that model next to Immich's own (RAM). Immich unloads idle models after `MACHINE_LEARNING_MODEL_TTL`.

Garage S3 (phase 3): development uses the `garage` service in `docker-compose.dev.yml` (`make garage-up`; single-node mode creates the dev key and bucket). Production uses an **external** Garage instance: create the `orbital-chat-media` bucket and a read/write key there, and pass the `CHAT_MEDIA_*` variables to the backend in `docker/docker-compose.deploy.yml`. No bucket CORS and no website access are needed.

Compose service `meilisearch` (in `docker/docker-compose.deploy.yml` and `docker-compose.dev.yml`):
- Pin the image (`getmeili/meilisearch:v1.56.2`).
- Environment: `MEILI_ENV=production`, `MEILI_MASTER_KEY` from `.env`, `MEILI_NO_ANALYTICS=true`, a capped `MEILI_MAX_INDEXING_MEMORY`, and `MEILI_SCHEDULE_SNAPSHOT=86400`.
- Internal network only, with no published port.
- Volume `./data/meilisearch:/meili_data`. **This volume holds primary data.**
- Upgrades: snapshot and dump first (see the backup spec), then start once with `MEILI_UPGRADE_DB=true`. Dumpless upgrades are not atomic.
- Per-release backups are specified in `docs/specs/MEILI_RELEASE_BACKUP.md`.

Document every env var in `docs/CONFIGURATION.md`.

## 12. Performance budgets (N1)

| Operation | Budget (server, p95, ≤ 1M messages) | Prototype measurement |
|---|---|---|
| Search (text and filters) | < 50 ms | 5.5 ms |
| History page (50) incl. reply previews | < 30 ms | ~2.5 ms per page search |
| Send → `text_message_new` broadcast | < 50 ms | ~2 ms enqueue |
| Visible in search after send | < 1 s | ~0.3 s |
| Unread summary on load (all channels) | < 100 ms | one `/multi-search` |

On the client, search shows results within about 300 ms of the last keystroke (200 ms debounce plus the request). History scrolling stays smooth at 60 fps because the list is virtualized.

Measure these in an integration test, or with an extended `experiments/chat-search` bench. Use the engine's `processingTimeMs` as well as wall-clock time (see the keep-alive gotcha in §15).

## 13. Implementation phases

**Phase 1: core text channels** — implemented. Notes:
- Backend: `internal/service/chatstore/` (Meilisearch engine, `MemoryEngine` for tests, seq, overlay + task watcher in `Service.Flush`, mutation locks), `repository/textreadstate.go`, `websocket/textchat.go`, `handlers/textchathandler.go`, guards in `roomhandler.go` / `livekithandler.go` / `hub.go` `handleJoinRoom`. Text and voice rooms cannot be converted into each other.
- Frontend: `stores/textChat.ts`, `views/TextChannelView.vue`, `components/textchat/*`, `utils/messageMarkup.ts`, `utils/messageGrouping.ts`. A text channel opens next to a running call; the call view stays mounted but hidden (unmounting it disconnects LiveKit).
- Reply ping is stored in `mention_user_ids` already; delivering pings is phase 2.
- `text_notify_settings` is not created yet (phase 2 migration).
- Tests: `chatstore/service_test.go` (seq, overlay, revert, concurrency), `chatstore/meili_integration_test.go` (build tag `integration`, `make test-integration`; not in PR CI), `websocket/textchat_test.go`, `handlers/textchathandler_test.go`, frontend `messageMarkup.test.ts`, `messageGrouping.test.ts`. The `kill -9` durability check was run manually against the dev container.

Original plan:
- Infra:
  - Meilisearch compose service and config, startup settings bootstrap, health exposed in the backend health check;
  - the daily snapshot env var.
- Backend:
  - room type `text` with the backend guards;
  - `chatstore`: client, `seq`, overlay, TaskWatcher, mutation lock;
  - send, edit, soft delete, reply;
  - history (before, after, around, date) with reply previews and the context endpoint;
  - read state and the unread summary;
  - `ManageMessages` and `AttachFiles` bits and migrations (following the checklists);
  - custom and unicode emoji tokens;
  - rate limit.
- Frontend:
  - create a text channel, with the sidebar `#` icon and unread state;
  - channel view: virtualized bidirectional list, grouping, day separators, "New messages" divider, jump to present;
  - composer with emoji picker and autocomplete, reply bar, edit, delete;
  - `messageMarkup.ts` and `MessageContent.vue` (formatting and spoilers);
  - optimistic send.
- Tests: §9 denied paths, seq monotonicity, overlay merge, edit vs reaction concurrency, `kill -9` durability, and grouping rule unit tests.

**Phase 2: mentions, reactions, pins, search** — implemented, including the typing indicator. Notes:
- Backend:
  - `chatstore`: `mentions.go` (`ParseMentions`, `MentionResolver`, cap 20, the reply ping survives edits), `reactions.go` (`ToggleReaction`, `SetPinned`, `Pins`), `query.go` (`ParseQuery`, `TimeBounds`), `search.go` (`Search`, `MentionCounts`), `notify.go` (`NotifyStore`, lazy expiry).
  - `repository/textnotify.go` with migration 43 (`text_notify_settings`).
  - `websocket/textchat_*.go`, one file per role (`textchat.go` holds the wiring and shared helpers): `textchat_messages.go` (send/edit/delete/read), `textchat_mentions.go` (mention fan-out, `mentionTargets`), `textchat_reactions.go` (`text_reaction_toggle`), `textchat_pins.go` (`text_pin`), `textchat_typing.go` (`text_typing`), `textchat_notify.go` (`StartMuteExpiry`, a 10 s ticker that deletes expired mutes and pushes `text_notify_settings`).
  - `handlers/textchat*.go`, also one file per role: `textchathandler.go` (type, deps, shared helpers), `textchatmessages.go` (history, context, pins), `textchatunread.go`, `textchatnotify.go`, `textchatsearch.go`.
- **Mention token ids are padded URL-safe base64** (`…Wg==`), so the token charset is `[A-Za-z0-9_=+/-]` (`chatstore.mentionIDChars`, frontend `MENTION_ID`). Unit tests with short ids did not catch this; the live check did.
- `has:` returned no results plus a hint until phase 3.
- Pin system lines are client-rendered: the client derives them from `text_message_updated` when `pinned_at_ts` is fresh (< 60 s).
- Mention badges: the client counts live `text_mention` events exactly. The count loaded from `/api/chat/unread` is dropped as soon as the read position moves, and the next unread fetch recounts.
- The mention sound is synthesized with Web Audio (`playMention` in `services/sounds.ts`), so it needs no asset and is independent of the sound pack. The toggle and volume are under Settings → Sounds. Electron flashes the taskbar through the new `flash-window` IPC (older desktop builds ignore it); it can be turned off under Settings → Application → "Flash taskbar on mentions".
- Frontend:
  - stores `textNotify.ts` and `textSearch.ts`;
  - `components/textchat/*`: ReactionBar, ComposerSuggestions (`@` and `:` autocomplete), ChannelNotifyMenu/Options, MuteChannelModal (mounted in `App.vue`), PinsPanel, SearchBox, SearchPanel, TypingIndicator;
  - `utils/mentionText.ts` (the textarea shows `@Name`, the model holds tokens);
  - `applyHighlights` in `utils/messageMarkup.ts`.
- Live check: `make e2e-textchat` (`scripts/e2e-textchat.sh` + `.mjs`; throwaway backend, database and index).
- Tests:
  - tests sit next to the file they cover (`chatstore/{mentions,reactions,query,search,notify}_test.go`, `websocket/textchat_*_test.go`, `handlers/textchat*_test.go`): the §9 denied paths for search, pins, react, pin, system roles, hidden-channel mentions, mute suppression and expiry;
  - the integration test covers search (prefix, typo, filters), pins and mention counts against real Meilisearch;
  - frontend: `mentionText.test.ts`, `textNotify.test.ts`, plus highlight and system-line cases.

**Phase 3: attachments**
- Dependency, installed by the developer (agents can't install packages): `go get github.com/aws/aws-sdk-go-v2/aws github.com/aws/aws-sdk-go-v2/credentials github.com/aws/aws-sdk-go-v2/service/s3`.
  - Installed 2026-11-11; the S3 client is `service/chatmedia/s3store.go`.
- Dev Garage (`make garage-up`, done); `CHAT_MEDIA_*` config with dev defaults; deploy compose passthrough.
- `MediaStore` (S3) wrapper, `chat_attachments` migration, upload endpoint, sniffing, thumbnails, client-side audio peaks, presigned delivery.
- Quota reservation and auto-removal, protection, single-file and bulk delete, the removal/purge path with the janitor and pending GC, purge on message and channel delete.
- Rendering (image grid, lightbox, video, wavesurfer audio player from stored peaks, tombstones), the attachment context menu, the eviction toast and quota warning chip.
- Storage page `/files` (new tab) and the `/api/me/attachments*` endpoints.
- Tests (fake `MediaStore`): eviction order; protected and pending rows are never evicted; `file_exceeds_quota` and `quota_protected_full`; concurrent reservations by one user; message and channel delete purge and free quota; the janitor retries failed S3 deletes; uploader-only protect; moderator delete; `/api/me/attachments` isolation; 410 on removed files; the uploader can fetch a file without `ViewRoom`. Integration (`integration` tag, Garage): PUT, presign and delete.
- `has:` filters (`ParsedQuery.HasFilter`, `SearchRequest.HasKinds`/`HasAttachment`; `has:` autocomplete in `SearchBox.vue`).
- ~~The extraction queue and worker with no extractors yet.~~ Not built in phase 3; it shipped with phase 4.

**Phase 4: content search (ML)**
- Image OCR and CLIP embeddings from an existing Immich ML (§7.13), the `chat_attachment_jobs` queue and worker, the `userProvided` embedder, and the federated keyword + vector search. Transcripts are not planned yet.

## 14. Open questions

None at the moment. Resolved on 2026-11-10:
- pinning requires `ManageMessages`;
- `AttachFiles` is a new permission, on by default and denied to Guest;
- no Moderator role is seeded;
- every role is mentionable and there is no `@everyone` / `@here`;
- no ffprobe: video and audio metadata comes from the client, for display only;
- per-channel notification settings with timed mute.

Resolved on 2026-11-11 (phase 3):
- S3 client: `aws-sdk-go-v2`;
- 5 GB per-user quota; uploads over it auto-remove the uploader's oldest unprotected files;
- only the uploader can protect a file;
- deleting a message purges its files and frees the quota;
- the storage page is a standalone `/files` page opened in a new tab;
- audio waveforms are computed by the client at upload and stored as 200 peaks.

## 15. Lessons from the prototype (gotchas)

- **HTTP keep-alive stall.** With Go's default keep-alive on loopback, some responses took a flat ~40 ms while `processingTimeMs` was 0–1. The prototype uses `DisableKeepAlives: true`. Re-measure on the docker network before copying that workaround.
- **Writes are asynchronous tasks.** Some failures (e.g. deleting an index that doesn't exist) show up only as a **failed task**, never as an HTTP error. Always check the task status.
- **Totals are estimates.** Search paging stops at `maxTotalHits`. History avoids this with seq cursors.
- **Typo tolerance is per index.** Phrase quoting is the only way to get exact matching.
- **Highlighting:** highlight tags must be control characters, converted only after escaping or rendering.
- **`userProvided` embedders need `_vectors` on every document.** Otherwise the settings task (and every later document write) fails with `vector_embedding_error: no vectors provided`. Opt out with `_vectors.<name>: null`, which is a plain null; `{embeddings: null}` does not clear.
- **No tuple cursors.** That is why `seq` exists. The prototype's timestamp-only history cursor can skip messages that share a millisecond. Don't copy it.

## 16. References

- Prototype: `experiments/chat-search/`. Server in `cmd/server`, Meilisearch client in `internal/store/meili.go`, generator in `cmd/populate`, bench in `cmd/bench`, reference UI for search, context and history in `web/`.
- Existing code to reuse:
  - `service/emojiservice.go`, `emojivips.go`;
  - `frontend/src/services/emoji/inlineText.ts`, `components/common/EmojiText.vue`, `EmojiTextInput.vue`;
  - `services/sounds.ts`;
  - `utils/markdown.ts` (as a reference only);
  - permission helpers in `handlers/permissions.go` and `hub.go`.
- Meilisearch docs:
  - documents: add/update (`PUT` partial merge), fetch with filter, delete by batch and by filter;
  - indexes and queries: tasks, swap indexes, `/multi-search`;
  - operations: snapshots, dumps, `MEILI_UPGRADE_DB`;
  - search tuning: typo tolerance, `matchingStrategy`, highlighting and cropping;
  - vectors: `userProvided` embedders, hybrid search.


**§7.1 Text channels**, replacing the current "Sidebar" bullet:

```markdown
- **Sidebar icon** (replaces the plain `#`):
  - **Globe** — *public* channel: no permission overwrites apply to it, neither on the
    channel itself nor inherited from its category while `permissions_synced` is true.
    Everyone with the server-wide defaults sees and uses it.
  - **Padlock** — any permission overwrite applies (any subject, any bit, allow or deny,
    own or inherited via sync).
  - The icon is computed by the backend and sent as `access: "public" | "restricted"` on
    the room object (`GET /api/rooms`, `room_created`, `room_updated`). It is recomputed on
    overwrite or sync changes and pushed through the existing `permissions_updated` refresh.
    The client does not work it out from overwrites, which users without `ManageRoles`
    can't read.
  - Tooltip: "Public channel" / "Restricted channel: custom permissions".
- Unread channels show bold with a dot; channels with mentions show a red count badge (§7.9).
```

**§2 Scope**, a new row:

```markdown
| F16 | Channel access icon: globe for public text channels, padlock when any permission overwrite applies | 1 |
```

**§9 denied-path tests**, an extra bullet:

```markdown
- `access` is `restricted` when any overwrite (own or category-inherited while synced) exists, `public` otherwise, and updates live after overwrite or sync changes
```

**§13 Phase 1, Frontend**: add "channel access icon (globe / padlock)" next to "sidebar `#` icon".
