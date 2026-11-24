package chatstore

import (
	"context"
	"regexp"
	"unicode"
	"unicode/utf8"
)

// Embed kinds.
const (
	EmbedLink  = "link"
	EmbedImage = "image"
	EmbedVideo = "video"
)

// MaxEmbeds caps the link previews of one message.
const MaxEmbeds = 3

// Embed is the preview of one link (docs/specs/CHAT_SYSTEM.md §7.15).
type Embed struct {
	URL         string `json:"url"`
	Kind        string `json:"kind"`
	SiteName    string `json:"site_name,omitempty"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	// ImageID names the proxied thumbnail (GET /api/embeds/{id}/image).
	ImageID     string `json:"image_id,omitempty"`
	ImageWidth  int    `json:"image_width,omitempty"`
	ImageHeight int    `json:"image_height,omitempty"`
	// VideoProvider/VideoID: an inline player (only "youtube" for now).
	VideoProvider string `json:"video_provider,omitempty"`
	VideoID       string `json:"video_id,omitempty"`
}

func nonNilEmbeds(e []Embed) []Embed {
	if e == nil {
		return []Embed{}
	}
	return e
}

// Keep in sync with URL_RE / URL_TRAILING_RE in
// frontend/src/utils/messageMarkup.ts.
var (
	previewURLRe      = regexp.MustCompile(`(?i)^https?://[^\s<>]+`)
	previewTrailingRe = regexp.MustCompile(`[.,:;!?'")\]}*~|]+$`)
)

// PreviewURLs lists the links of a message that get a preview, in order,
// without duplicates, at most MaxEmbeds. Links written as <https://...> and
// links inside ||spoilers|| get none.
func PreviewURLs(content string) []string {
	spoiler := spoilerMask(content)
	var out []string
	seen := map[string]bool{}
	for i := 0; i < len(content) && len(out) < MaxEmbeds; {
		c := content[i]
		if (c != 'h' && c != 'H') || (i > 0 && isWordBefore(content, i)) {
			i++
			continue
		}
		m := previewURLRe.FindString(content[i:])
		if m == "" {
			i++
			continue
		}
		href := previewTrailingRe.ReplaceAllString(m, "")
		if len(href) < len("http://")+1 {
			i += len(m)
			continue
		}
		// The frontend renders <url> as a link (trailing punctuation included).
		suppressed := i > 0 && content[i-1] == '<' && i+len(m) < len(content) && content[i+len(m)] == '>'
		if !suppressed && !spoiler[i] && !seen[href] {
			seen[href] = true
			out = append(out, href)
		}
		i += len(href)
	}
	return out
}

// isWordBefore reports whether the rune before byte i is a letter or digit
// (a URL must start a word, like the frontend autolinker requires).
func isWordBefore(s string, i int) bool {
	r, _ := utf8.DecodeLastRuneInString(s[:i])
	return unicode.IsLetter(r) || unicode.IsDigit(r)
}

// spoilerMask marks the bytes between paired || markers. Escaped markers
// (\|) are ignored.
func spoilerMask(s string) []bool {
	mask := make([]bool, len(s))
	open := -1
	for i := 0; i+1 < len(s); i++ {
		if s[i] == '\\' {
			i++
			continue
		}
		if s[i] != '|' || s[i+1] != '|' {
			continue
		}
		if open < 0 {
			open = i + 2
		} else {
			for j := open; j < i; j++ {
				mask[j] = true
			}
			open = -1
		}
		i++
	}
	return mask
}

// keepEmbeds drops the embeds whose link is no longer in the text.
func keepEmbeds(embeds []Embed, content string) []Embed {
	want := map[string]bool{}
	for _, u := range PreviewURLs(content) {
		want[u] = true
	}
	out := []Embed{}
	for _, e := range embeds {
		if want[e.URL] {
			out = append(out, e)
		}
	}
	return out
}

// EmbedsCurrent reports whether a message already has a preview for every
// link that should have one (nothing to fetch).
func EmbedsCurrent(m *Message, urls []string) bool {
	if m.EmbedsSuppressed {
		return true
	}
	have := map[string]bool{}
	for _, e := range m.Embeds {
		have[e.URL] = true
	}
	for _, u := range urls {
		if !have[u] {
			return false
		}
	}
	return len(m.Embeds) == len(urls)
}

// SetEmbeds stores the link previews made for content. It changes nothing
// (and returns ErrStale) when the message was edited meanwhile or its
// previews were removed.
func (s *Service) SetEmbeds(ctx context.Context, id, content string, embeds []Embed) (*Message, error) {
	return s.mutate(ctx, id, func(m *Message) (map[string]any, error) {
		if m.Content != content || m.EmbedsSuppressed {
			return nil, ErrStale
		}
		m.Embeds = nonNilEmbeds(embeds)
		return map[string]any{"embeds": m.Embeds}, nil
	})
}

// SuppressEmbeds removes a message's link previews for good. The author may
// always; others need canManage(roomID) (ManageMessages in that channel).
func (s *Service) SuppressEmbeds(ctx context.Context, id, actorID string, canManage func(roomID string) bool) (*Message, error) {
	return s.mutate(ctx, id, func(m *Message) (map[string]any, error) {
		if m.SenderID != actorID && (canManage == nil || !canManage(m.RoomID)) {
			return nil, ErrForbidden
		}
		if m.EmbedsSuppressed {
			return nil, nil
		}
		m.EmbedsSuppressed, m.Embeds = true, []Embed{}
		return map[string]any{"embeds_suppressed": true, "embeds": m.Embeds}, nil
	})
}
