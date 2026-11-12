package service

import (
	"encoding/base64"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

// MaxEmojiPageSize caps one page of the library, a search or a batch lookup.
const MaxEmojiPageSize = 200

var ErrEmojiInvalidCursor = errors.New("invalid cursor")

// emojiIndex is an in-memory view of the library: a few thousand rows at
// most, so scanning it beats SQL over the JSON aliases column.
type emojiIndex struct {
	list        []*models.CustomEmoji // (created_at, id) order, image_url set
	byID        map[string]*models.CustomEmoji
	byShortcode map[string]*models.CustomEmoji
	// byNameShortcode holds name shortcodes only (names are unique by
	// shortcode, see EmojiService.nameTakenLocked).
	byNameShortcode map[string]*models.CustomEmoji
}

// EmojiShortcode turns an emoji name into its `:shortcode:` form
// ("Party Parrot!" -> "party_parrot"). Keep in sync with emojiShortcode in
// frontend/src/services/emoji/inlineText.ts.
func EmojiShortcode(name string) string {
	var b strings.Builder
	sep := false
	for _, r := range strings.ToLower(name) {
		if !unicode.IsLetter(r) && !unicode.IsNumber(r) {
			sep = true
			continue
		}
		if sep && b.Len() > 0 {
			b.WriteByte('_')
		}
		sep = false
		b.WriteRune(r)
	}
	slug := b.String()
	if utf8.RuneCountInString(slug) > 64 {
		slug = string([]rune(slug)[:64])
	}
	if slug == "" {
		return "emoji"
	}
	return slug
}

func buildEmojiIndex(emojis []*models.CustomEmoji) *emojiIndex {
	sort.SliceStable(emojis, func(i, j int) bool { return emojiBefore(emojis[i], emojis[j]) })
	idx := &emojiIndex{
		list:            emojis,
		byID:            make(map[string]*models.CustomEmoji, len(emojis)),
		byShortcode:     make(map[string]*models.CustomEmoji, len(emojis)),
		byNameShortcode: make(map[string]*models.CustomEmoji, len(emojis)),
	}
	// Name shortcodes win over alias shortcodes; among equals the oldest
	// emoji wins (same rule as the frontend before paging).
	for _, e := range emojis {
		withImageURL(e)
		idx.byID[e.ID] = e
		if code := EmojiShortcode(e.Name); idx.byShortcode[code] == nil {
			idx.byShortcode[code] = e
			idx.byNameShortcode[code] = e
		}
	}
	for _, e := range emojis {
		for _, alias := range e.Aliases {
			if code := EmojiShortcode(alias); idx.byShortcode[code] == nil {
				idx.byShortcode[code] = e
			}
		}
	}
	return idx
}

func emojiBefore(a, b *models.CustomEmoji) bool {
	if !a.CreatedAt.Equal(b.CreatedAt) {
		return a.CreatedAt.Before(b.CreatedAt)
	}
	return a.ID < b.ID
}

func (s *EmojiService) index() (*emojiIndex, error) {
	s.idxMu.Lock()
	defer s.idxMu.Unlock()
	if s.idx != nil {
		return s.idx, nil
	}
	emojis, err := s.repo.List()
	if err != nil {
		return nil, err
	}
	s.idx = buildEmojiIndex(emojis)
	return s.idx, nil
}

func (s *EmojiService) invalidateIndex() {
	s.idxMu.Lock()
	s.idx = nil
	s.idxMu.Unlock()
}

// cloneEmoji keeps callers from mutating the shared index.
func cloneEmoji(e *models.CustomEmoji) *models.CustomEmoji {
	c := *e
	// Never nil: clients expect "aliases": [] (append onto nil would give null).
	c.Aliases = make([]string, len(e.Aliases))
	copy(c.Aliases, e.Aliases)
	return &c
}

func cloneEmojis(list []*models.CustomEmoji) []*models.CustomEmoji {
	out := make([]*models.CustomEmoji, len(list))
	for i, e := range list {
		out[i] = cloneEmoji(e)
	}
	return out
}

func clampEmojiLimit(limit int) int {
	if limit <= 0 || limit > MaxEmojiPageSize {
		return MaxEmojiPageSize
	}
	return limit
}

// Paging cursors are opaque to clients. Browse cursors name the last emoji
// returned (created_at|id), so a deletion does not shift later pages.
// Search cursors are offsets into the ranked result list.
func encodeKeyCursor(e *models.CustomEmoji) string {
	return base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("k|%d|%s", e.CreatedAt.UnixNano(), e.ID)))
}

func encodeOffsetCursor(offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("o|%d", offset)))
}

func decodeCursor(cursor string) (kind string, parts []string, err error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return "", nil, ErrEmojiInvalidCursor
	}
	parts = strings.SplitN(string(raw), "|", 3)
	switch {
	case parts[0] == "k" && len(parts) == 3, parts[0] == "o" && len(parts) == 2:
		return parts[0], parts[1:], nil
	}
	return "", nil, ErrEmojiInvalidCursor
}

// Page returns up to limit emojis after cursor (from the start when empty),
// in upload order, plus the cursor of the next page ("" at the end).
func (s *EmojiService) Page(cursor string, limit int) ([]*models.CustomEmoji, string, error) {
	idx, err := s.index()
	if err != nil {
		return nil, "", err
	}
	limit = clampEmojiLimit(limit)
	start := 0
	if cursor != "" {
		kind, parts, err := decodeCursor(cursor)
		if err != nil || kind != "k" {
			return nil, "", ErrEmojiInvalidCursor
		}
		nanos, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			return nil, "", ErrEmojiInvalidCursor
		}
		after := &models.CustomEmoji{CreatedAt: time.Unix(0, nanos), ID: parts[1]}
		start = sort.Search(len(idx.list), func(i int) bool { return emojiBefore(after, idx.list[i]) })
	}
	end := min(start+limit, len(idx.list))
	next := ""
	if end < len(idx.list) && end > start {
		next = encodeKeyCursor(idx.list[end-1])
	}
	return cloneEmojis(idx.list[start:end]), next, nil
}

// emojiSearchScore mirrors searchEmojis in frontend/src/services/emoji/registry.ts:
// every query word must match a keyword (name, name word or alias); exact
// matches score 3, prefixes 2, substrings 1. 0 means no match.
func emojiSearchScore(e *models.CustomEmoji, words []string) int {
	name := strings.ToLower(e.Name)
	keywords := append(append([]string{name}, strings.Fields(name)...), e.Aliases...)
	score := 0
	for _, word := range words {
		best := 0
		for _, k := range keywords {
			switch {
			case k == word:
				best = 3
			case best < 2 && strings.HasPrefix(k, word):
				best = 2
			case best < 1 && strings.Contains(k, word):
				best = 1
			}
			if best == 3 {
				break
			}
		}
		if best == 0 {
			return 0
		}
		score += best
	}
	return score
}

// Search returns emojis matching every word of q, best matches first (ties
// in upload order), paged with an offset cursor.
func (s *EmojiService) Search(q, cursor string, limit int) ([]*models.CustomEmoji, string, error) {
	idx, err := s.index()
	if err != nil {
		return nil, "", err
	}
	limit = clampEmojiLimit(limit)
	offset := 0
	if cursor != "" {
		kind, parts, err := decodeCursor(cursor)
		if err != nil || kind != "o" {
			return nil, "", ErrEmojiInvalidCursor
		}
		if offset, err = strconv.Atoi(parts[0]); err != nil || offset < 0 {
			return nil, "", ErrEmojiInvalidCursor
		}
	}
	words := strings.Fields(strings.ToLower(q))
	if len(words) == 0 {
		return []*models.CustomEmoji{}, "", nil
	}
	type hit struct {
		e     *models.CustomEmoji
		score int
	}
	var hits []hit
	for _, e := range idx.list {
		if score := emojiSearchScore(e, words); score > 0 {
			hits = append(hits, hit{e, score})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].score > hits[j].score })
	if offset > len(hits) {
		offset = len(hits)
	}
	end := min(offset+limit, len(hits))
	out := make([]*models.CustomEmoji, 0, end-offset)
	for _, h := range hits[offset:end] {
		out = append(out, cloneEmoji(h.e))
	}
	next := ""
	if end < len(hits) {
		next = encodeOffsetCursor(end)
	}
	return out, next, nil
}

// GetByIDs returns the emojis that exist among ids (unknown ids are skipped).
func (s *EmojiService) GetByIDs(ids []string) ([]*models.CustomEmoji, error) {
	idx, err := s.index()
	if err != nil {
		return nil, err
	}
	out := make([]*models.CustomEmoji, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if e := idx.byID[id]; e != nil && !seen[id] {
			seen[id] = true
			out = append(out, cloneEmoji(e))
		}
	}
	return out, nil
}

// ByShortcodes resolves `:shortcode:`s to emojis. The map holds the
// shortcodes that matched; emojis lists each matched emoji once.
func (s *EmojiService) ByShortcodes(codes []string) (map[string]string, []*models.CustomEmoji, error) {
	idx, err := s.index()
	if err != nil {
		return nil, nil, err
	}
	ids := make(map[string]string, len(codes))
	emojis := make([]*models.CustomEmoji, 0, len(codes))
	seen := make(map[string]bool, len(codes))
	for _, code := range codes {
		e := idx.byShortcode[code]
		if e == nil {
			continue
		}
		ids[code] = e.ID
		if !seen[e.ID] {
			seen[e.ID] = true
			emojis = append(emojis, cloneEmoji(e))
		}
	}
	return ids, emojis, nil
}

// Count is the library size.
func (s *EmojiService) Count() (int, error) {
	idx, err := s.index()
	if err != nil {
		return 0, err
	}
	return len(idx.list), nil
}
