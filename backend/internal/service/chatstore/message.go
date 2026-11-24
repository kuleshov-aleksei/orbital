// Package chatstore stores text channel messages. Messages live only in
// Meilisearch (see docs/specs/CHAT_SYSTEM.md): history, context, edits and
// soft-delete state are fields of one document per message.
package chatstore

import (
	"errors"
	"net"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// MaxContentRunes is the per-message character limit.
const MaxContentRunes = 2000

var (
	// ErrNotFound: the message does not exist or is deleted.
	ErrNotFound = errors.New("message not found")
	// ErrForbidden: the actor may not change this message.
	ErrForbidden = errors.New("not allowed")
	// ErrInvalid: the request is malformed (empty content, too long, ...).
	ErrInvalid = errors.New("invalid message")
	// ErrStale: the message changed while derived data (link previews) was
	// being made; the result was dropped.
	ErrStale = errors.New("message changed")
	// ErrUnavailable: Meilisearch is down or not bootstrapped yet.
	ErrUnavailable = errors.New("chat unavailable")
)

// invalidError carries a user-facing reason and matches ErrInvalid.
type invalidError struct{ msg string }

func (e invalidError) Error() string        { return e.msg }
func (e invalidError) Is(target error) bool { return target == ErrInvalid }

func invalid(msg string) error { return invalidError{msg} }

// Reaction is one emoji with the users who reacted with it (phase 2).
type Reaction struct {
	Emoji   string   `json:"emoji"`
	UserIDs []string `json:"user_ids"`
}

// GIF is a shared third-party GIF (docs/specs/CHAT_SYSTEM.md §7.17). The
// media is loaded by each client straight from the provider, because the
// provider terms forbid proxying or re-hosting it; the server stores only
// the reference and checks that its URLs point at that provider.
type GIF struct {
	Provider   string `json:"provider"`
	ID         string `json:"id"`
	URL        string `json:"url"`
	PreviewURL string `json:"preview_url"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Title      string `json:"title"`
}

func (g *GIF) clone() *GIF {
	if g == nil {
		return nil
	}
	c := *g
	return &c
}

// Message is the stored document (index `text_messages`).
type Message struct {
	ID             string     `json:"id"`
	Seq            int64      `json:"seq"`
	RoomID         string     `json:"room_id"`
	SenderID       string     `json:"sender_id"`
	Content        string     `json:"content"`
	ContentSearch  string     `json:"content_search"`
	CreatedAtTS    int64      `json:"created_at_ts"`
	EditedAtTS     *int64     `json:"edited_at_ts"`
	ReplyToID      *string    `json:"reply_to_id"`
	MentionUserIDs []string   `json:"mention_user_ids"`
	MentionRoleIDs []string   `json:"mention_role_ids"`
	Reactions      []Reaction `json:"reactions"`
	Pinned         bool       `json:"pinned"`
	PinnedAtTS     *int64     `json:"pinned_at_ts"`
	PinnedBy       *string    `json:"pinned_by"`
	IsDeleted      bool       `json:"is_deleted"`
	DeletedAtTS    *int64     `json:"deleted_at_ts"`
	DeletedBy      *string    `json:"deleted_by"`
	// Attachments (phase 3): a display copy; chat_attachments in SQLite is
	// the source of truth (docs/specs/CHAT_SYSTEM.md §7.12).
	Attachments     []Attachment `json:"attachments"`
	AttachmentKinds []string     `json:"attachment_kinds"`
	AttachmentNames []string     `json:"attachment_names"`
	AttachmentText  string       `json:"attachment_text"`
	// Link previews (docs/specs/CHAT_SYSTEM.md §7.15), filled in after the
	// message is stored. EmbedsSuppressed: the author or a moderator removed
	// them; no new ones are made.
	Embeds           []Embed `json:"embeds"`
	EmbedsSuppressed bool    `json:"embeds_suppressed"`
	// Command is the result of a slash command (service/chatcmd); nil for
	// plain messages.
	Command *Command `json:"command,omitempty"`
	// GIF is a shared third-party GIF (docs/specs/CHAT_SYSTEM.md §7.17).
	GIF *GIF `json:"gif"`
	// Poll (docs/specs/CHAT_SYSTEM.md §7.18); clients get PublicFor's view.
	Poll *Poll `json:"poll,omitempty"`
}

// PublicMessage is what clients receive: no search-only or moderation fields.
type PublicMessage struct {
	ID             string       `json:"id"`
	Seq            int64        `json:"seq"`
	RoomID         string       `json:"room_id"`
	SenderID       string       `json:"sender_id"`
	Content        string       `json:"content"`
	CreatedAtTS    int64        `json:"created_at_ts"`
	EditedAtTS     *int64       `json:"edited_at_ts"`
	ReplyToID      *string      `json:"reply_to_id"`
	MentionUserIDs []string     `json:"mention_user_ids"`
	MentionRoleIDs []string     `json:"mention_role_ids"`
	Reactions      []Reaction   `json:"reactions"`
	Pinned         bool         `json:"pinned"`
	PinnedAtTS     *int64       `json:"pinned_at_ts"`
	PinnedBy       *string      `json:"pinned_by"`
	Attachments    []Attachment `json:"attachments"`
	Embeds         []Embed      `json:"embeds"`
	// EmbedsSuppressed lets clients tell "no previews yet" from "removed".
	EmbedsSuppressed bool     `json:"embeds_suppressed"`
	Command          *Command `json:"command,omitempty"`
	GIF              *GIF     `json:"gif"`
	// Poll is the view of one viewer (results hidden until they voted).
	Poll *PublicPoll `json:"poll,omitempty"`
}

// Public converts a stored message to its client representation for no
// viewer in particular (poll results stay hidden unless the poll closed).
// Send poll messages to a user with PublicFor.
func (m *Message) Public() PublicMessage { return m.PublicFor("") }

// PublicFor converts a stored message to what viewerID may see.
func (m *Message) PublicFor(viewerID string) PublicMessage {
	return PublicMessage{
		ID: m.ID, Seq: m.Seq, RoomID: m.RoomID, SenderID: m.SenderID,
		Content: m.Content, CreatedAtTS: m.CreatedAtTS, EditedAtTS: m.EditedAtTS,
		ReplyToID: m.ReplyToID, MentionUserIDs: nonNil(m.MentionUserIDs), MentionRoleIDs: nonNil(m.MentionRoleIDs),
		Reactions: nonNilReactions(m.Reactions), Pinned: m.Pinned, PinnedAtTS: m.PinnedAtTS, PinnedBy: m.PinnedBy,
		Attachments: nonNilAttachments(m.Attachments),
		Embeds:      nonNilEmbeds(m.Embeds), EmbedsSuppressed: m.EmbedsSuppressed,
		Command: m.Command.clone(),
		GIF:     m.GIF.clone(),
		Poll:    m.Poll.public(viewerID),
	}
}

// normalize fills nil slices so documents always have the full shape.
func (m *Message) normalize() {
	m.MentionUserIDs = nonNil(m.MentionUserIDs)
	m.MentionRoleIDs = nonNil(m.MentionRoleIDs)
	m.Reactions = nonNilReactions(m.Reactions)
	m.Attachments = nonNilAttachments(m.Attachments)
	m.AttachmentKinds = nonNil(m.AttachmentKinds)
	m.AttachmentNames = nonNil(m.AttachmentNames)
	m.Embeds = nonNilEmbeds(m.Embeds)
}

func (m *Message) clone() *Message {
	c := *m
	c.MentionUserIDs = append([]string(nil), m.MentionUserIDs...)
	c.MentionRoleIDs = append([]string(nil), m.MentionRoleIDs...)
	c.Reactions = make([]Reaction, len(m.Reactions))
	for i, r := range m.Reactions {
		c.Reactions[i] = Reaction{Emoji: r.Emoji, UserIDs: append([]string(nil), r.UserIDs...)}
	}
	c.Attachments = make([]Attachment, len(m.Attachments))
	for i, a := range m.Attachments {
		c.Attachments[i] = a.clone()
	}
	c.AttachmentKinds = append([]string(nil), m.AttachmentKinds...)
	c.AttachmentNames = append([]string(nil), m.AttachmentNames...)
	c.Embeds = append([]Embed(nil), m.Embeds...)
	c.Command = m.Command.clone()
	c.GIF = m.GIF.clone()
	c.Poll = m.Poll.clone()
	c.normalize()
	return &c
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func nonNilReactions(r []Reaction) []Reaction {
	if r == nil {
		return []Reaction{}
	}
	return r
}

func nonNilAttachments(a []Attachment) []Attachment {
	if a == nil {
		return []Attachment{}
	}
	return a
}

// customEmojiTokenRe matches "<:shortcode:id>". Keep in sync with
// frontend/src/services/emoji/inlineText.ts and handlers/roomhandler.go.
var customEmojiTokenRe = regexp.MustCompile(`<:([\p{L}\p{N}_]{1,64}):[0-9a-f-]{36}>`)

// mentionIDChars are the characters of user and role ids in mention tokens:
// user ids are padded URL-safe base64 ("…Wg=="); standard base64 is allowed
// too. Keep in sync with frontend/src/utils/messageMarkup.ts MENTION_ID.
const mentionIDChars = `[A-Za-z0-9_=+/-]{1,64}`

// mentionTokenRe matches "<@user_id>" and "<@&role_id>".
var mentionTokenRe = regexp.MustCompile(`<@&?` + mentionIDChars + `>`)

// SearchText derives content_search: custom emoji become ":shortcode:" so
// they can be searched, mention tokens are removed.
func SearchText(content string) string {
	s := customEmojiTokenRe.ReplaceAllString(content, ":$1:")
	s = mentionTokenRe.ReplaceAllString(s, " ")
	return s
}

// NormalizeContent trims and validates message text. allowEmpty is for
// messages that carry attachments.
func NormalizeContent(content string, allowEmpty bool) (string, error) {
	content = strings.TrimSpace(strings.ToValidUTF8(content, "�"))
	if content == "" && !allowEmpty {
		return "", invalid("message content cannot be empty")
	}
	if len(content) > maxContentBytes || EmojiTextLength(content) > MaxContentRunes {
		return "", invalid("message content exceeds 2000 characters")
	}
	return content, nil
}

// maxContentBytes bounds the stored text: custom emoji tokens count as one
// character each but are ~50 bytes long.
const maxContentBytes = 32 * 1024

// EmojiTextLength counts characters (not bytes), with each custom emoji
// token counted as one, as the frontend emojiTextLength does.
func EmojiTextLength(s string) int {
	return utf8.RuneCountInString(customEmojiTokenRe.ReplaceAllString(s, "x"))
}

// Third-party GIF search (docs/specs/CHAT_SYSTEM.md §7.17).

const (
	// maxGIFURLLen bounds a stored media URL (provider URLs carry delivery
	// parameters, so they are not rewritten).
	maxGIFURLLen = 1024
	// maxGIFDimension bounds the reported size of the animation.
	maxGIFDimension = 4096
	// maxGIFTitleRunes bounds the provider title (alt text).
	maxGIFTitleRunes = 200
)

// gifProviderDomains are the domains a provider's references may point at.
// Anything else (a tracking pixel, an arbitrary host) would make every
// viewer's browser contact it, so the list stays strict; subdomains of the
// provider's own domain are allowed because the media host varies between
// renditions.
var gifProviderDomains = map[string][]string{
	"klipy": {"klipy.com"},
	"giphy": {"giphy.com"},
}

var gifIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// NormalizeGIF validates a GIF reference sent by a client. A nil input stays
// nil (a message without a GIF).
func NormalizeGIF(g *GIF) (*GIF, error) {
	if g == nil {
		return nil, nil
	}
	provider := strings.ToLower(strings.TrimSpace(g.Provider))
	domains, ok := gifProviderDomains[provider]
	if !ok {
		return nil, invalid("unknown GIF provider")
	}
	id := strings.TrimSpace(g.ID)
	if !gifIDRe.MatchString(id) {
		return nil, invalid("invalid GIF id")
	}
	media, err := normalizeGIFURL(g.URL, domains)
	if err != nil {
		return nil, err
	}
	preview, err := normalizeGIFURL(g.PreviewURL, domains)
	if err != nil {
		return nil, err
	}
	width, height := g.Width, g.Height
	if width < 1 || height < 1 || width > maxGIFDimension || height > maxGIFDimension {
		// Layout hints only; the client falls back to the intrinsic size.
		width, height = 0, 0
	}
	title := gifTitle(g.Title)
	return &GIF{
		Provider: provider, ID: id, URL: media, PreviewURL: preview,
		Width: width, Height: height, Title: title,
	}, nil
}

// normalizeGIFURL keeps an https URL on one of the provider's domains.
func normalizeGIFURL(raw string, domains []string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > maxGIFURLLen {
		return "", invalid("invalid GIF URL")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Port() != "" {
		return "", invalid("invalid GIF URL")
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || net.ParseIP(host) != nil {
		return "", invalid("invalid GIF URL")
	}
	for _, domain := range domains {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return u.String(), nil
		}
	}
	return "", invalid("invalid GIF URL")
}

// gifTitle keeps a plain-text title: line breaks become spaces, other
// control characters are dropped, and the length is bounded.
func gifTitle(s string) string {
	s = oneLine(s)
	if r := []rune(s); len(r) > maxGIFTitleRunes {
		s = strings.TrimSpace(string(r[:maxGIFTitleRunes]))
	}
	return s
}

// oneLine makes single-line plain text: line breaks become spaces, other
// control characters are dropped, runs of spaces collapse.
func oneLine(s string) string {
	s = strings.Map(func(r rune) rune {
		switch r {
		case '\n', '\r', '\t':
			return ' '
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	return strings.Join(strings.Fields(strings.ToValidUTF8(s, "�")), " ")
}
