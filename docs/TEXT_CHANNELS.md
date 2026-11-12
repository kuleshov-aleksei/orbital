# Text Channels

Text channels are persistent chat rooms. They live in the sidebar next to the voice rooms, marked with `#`. The design spec, with every decision and limit, is [specs/CHAT_SYSTEM.md](specs/CHAT_SYSTEM.md).

The chat inside a voice call is a different feature: it is temporary and is not saved.

## Messages

- Messages are up to 2000 characters. Consecutive messages from one person are grouped together.
- **Formatting**: `**bold**`, `*italic*` or `_italic_`, `~~strikethrough~~`, `||spoiler||` (click to reveal). Links are detected automatically. A backslash escapes a marker. Headings, lists and code blocks are not supported.
- **Emoji**: unicode and custom emoji, with the picker or `:shortcode` autocomplete. A message with only emoji shows them larger.
- **Replies**: click the quote above a reply to jump to the original. Replying pings the author unless you turn off the "@ mention" toggle.
- **Mentions**: type `@` to mention a person or a role. Mentioned people hear a chime and see a red badge on the channel. Mentions added by editing a message don't ping anyone. `@everyone` / `@here` do not exist.
- **Reactions**: up to 20 different emoji per message.
- **Pins**: up to 50 per channel, listed in the pin panel in the channel header. Pinning needs the *Manage Messages* permission.
- **Editing and deleting**: press ↑ in an empty composer to edit your last message. Deleting asks for confirmation; Shift+click skips it. A deleted message disappears for everyone, and its attachments are removed.

## Unread messages and notifications

- A channel opens at the first message you haven't read, below a "New messages" divider. Esc marks the channel as read.
- Your read position syncs across all your devices.
- Each channel has a notification mode (bell icon in the header, or the channel's context menu):
  - **Everything** (default): unread dot, mention badge and mention sound.
  - **Mentions off**: unread dot only.
  - **Muted**: nothing, for 1 hour, 4 hours, 1 day, 1 week or forever.

## Attachments

Drag files in, paste them, or use the attachment button. Up to 10 files per message:

| Kind | Formats | Max size (default) |
|---|---|---|
| Images | png, jpeg, webp, gif | 20 MB |
| Audio | mp3, wav, ogg | 25 MB |
| Video | mp4 | 100 MB |

- Location data (EXIF) is stripped from images.
- Audio messages show a waveform.
- Video in a codec your browser can't play (for example HEVC) shows a download link instead of a player.

**Storage quota.** Each user has 5 GB by default. When an upload doesn't fit, your **oldest unprotected** files are removed to make room, and a notice tells you which ones. Files of other users are never touched.

- **Protect** a file from its context menu to keep it from being removed automatically.
- **My files** (Account settings, or "Manage my storage" in the file menu) lists all your uploads. You can filter, sort, download, protect, delete and jump to the message. The files marked "removed next" are the ones that go first.

Attachments need S3 storage on the server. Without it, the attachment button is hidden.

## Search

Press `Ctrl+F` (`Cmd+F` on macOS) or click the search box in the channel header. Results update as you type, and clicking one jumps to the message.

Free text is typo-tolerant, and `"quoted phrases"` match exactly. Filters:

| Filter | Example | Meaning |
|---|---|---|
| `from:` | `from:alex`, `from:"Long Name"` | Author. Repeat it to search for several people |
| `in:` | `in:#general` | Channel. Can be repeated |
| `has:` | `has:image`, `has:video`, `has:audio`, `has:file` | Messages with attachments of that kind |
| `during:` | `during:2026-11`, `during:today`, `during:yesterday` | A day or a month |
| `before:` / `after:` | `after:2026-11-01` | Date range (dates themselves are excluded) |
| `mentions:` | `mentions:@alex` | Messages that mention someone |
| `pinned:` | `pinned:true` | Pinned messages only |

Dates use your own time zone. Results are sorted by relevance when you type text and by date otherwise; a toggle switches between the two.

### Searching inside images

When the server has image search enabled, every image attachment is indexed in the background, including images sent before the feature was turned on:

- **OCR** reads the text in the image (Russian, Ukrainian, Belarusian and English). Searching for a word that appears in a screenshot finds it.
- **CLIP** understands what the image shows. Searching for `sunset over the sea` or `закат над морем` finds matching photos even when nobody wrote those words. These "by meaning" results only appear when you search by relevance.

To see what search knows about an image, open its menu and choose **What search sees**. It shows the recognized text and can test how well a phrase matches. Admins can follow indexing progress in **Admin panel → Search indexing**.

Both models run on an existing [Immich](https://immich.app/) machine-learning service. Setup is in [CONFIGURATION.md](CONFIGURATION.md#search-by-image-contents-immich-ml).
