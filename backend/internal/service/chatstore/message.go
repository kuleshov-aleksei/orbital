// Package chatstore stores text channel messages. Messages live only in
// Meilisearch (see docs/specs/CHAT_SYSTEM.md): history, context, edits and
// soft-delete state are fields of one document per message.
package chatstore

import (
	"errors"
	"regexp"
	"strings"
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
}

// Public converts a stored message to its client representation.
func (m *Message) Public() PublicMessage {
	return PublicMessage{
		ID: m.ID, Seq: m.Seq, RoomID: m.RoomID, SenderID: m.SenderID,
		Content: m.Content, CreatedAtTS: m.CreatedAtTS, EditedAtTS: m.EditedAtTS,
		ReplyToID: m.ReplyToID, MentionUserIDs: nonNil(m.MentionUserIDs), MentionRoleIDs: nonNil(m.MentionRoleIDs),
		Reactions: nonNilReactions(m.Reactions), Pinned: m.Pinned, PinnedAtTS: m.PinnedAtTS, PinnedBy: m.PinnedBy,
		Attachments: nonNilAttachments(m.Attachments),
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
	if utf8.RuneCountInString(content) > MaxContentRunes {
		return "", invalid("message content exceeds 2000 characters")
	}
	return content, nil
}
