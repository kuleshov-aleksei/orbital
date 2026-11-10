package chatstore

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	// MaxReactionEmojis caps the distinct emoji per message.
	MaxReactionEmojis = 20
	// MaxPins caps the pinned messages per channel.
	MaxPins = 50

	customReactionPrefix = "custom:"
	maxEmojiBytes        = 64
	maxEmojiRunes        = 16
)

var customReactionRe = regexp.MustCompile(`^custom:[0-9a-f-]{36}$`)

// ValidReactionEmoji accepts one unicode emoji sequence or "custom:<id>".
func ValidReactionEmoji(emoji string) bool {
	if strings.HasPrefix(emoji, customReactionPrefix) {
		return customReactionRe.MatchString(emoji)
	}
	if emoji == "" || len(emoji) > maxEmojiBytes || utf8.RuneCountInString(emoji) > maxEmojiRunes {
		return false
	}
	hasSymbol := false
	for _, r := range emoji {
		if unicode.IsSpace(r) || unicode.IsControl(r) || unicode.IsLetter(r) {
			return false
		}
		if unicode.Is(unicode.So, r) || r == '⃣' || (r >= 0x1F1E6 && r <= 0x1F1FF) {
			hasSymbol = true
		}
	}
	return hasSymbol
}

// ToggleReaction adds or removes a user's reaction. Reactions keep the order
// of the first reaction; an emoji with no users left disappears.
func (s *Service) ToggleReaction(ctx context.Context, id, userID, emoji string) (*Message, error) {
	if !ValidReactionEmoji(emoji) {
		return nil, invalid("unsupported emoji")
	}
	return s.mutate(ctx, id, func(m *Message) (map[string]any, error) {
		idx := -1
		for i, r := range m.Reactions {
			if r.Emoji == emoji {
				idx = i
				break
			}
		}
		switch {
		case idx < 0:
			if len(m.Reactions) >= MaxReactionEmojis {
				return nil, invalid("this message has too many different reactions")
			}
			m.Reactions = append(m.Reactions, Reaction{Emoji: emoji, UserIDs: []string{userID}})
		case contains(m.Reactions[idx].UserIDs, userID):
			users := m.Reactions[idx].UserIDs[:0]
			for _, u := range m.Reactions[idx].UserIDs {
				if u != userID {
					users = append(users, u)
				}
			}
			if len(users) == 0 {
				m.Reactions = append(m.Reactions[:idx], m.Reactions[idx+1:]...)
			} else {
				m.Reactions[idx].UserIDs = users
			}
		default:
			m.Reactions[idx].UserIDs = append(m.Reactions[idx].UserIDs, userID)
		}
		m.Reactions = nonNilReactions(m.Reactions)
		return map[string]any{"reactions": m.Reactions}, nil
	})
}

// SetPinned pins or unpins a message. The caller checks ManageMessages.
// changed is false when the message already had that state.
func (s *Service) SetPinned(ctx context.Context, id, actorID string, pinned bool) (msg *Message, changed bool, err error) {
	s.pinMu.Lock()
	defer s.pinMu.Unlock()
	if pinned {
		cur, err := s.Get(ctx, id)
		if err != nil {
			return nil, false, err
		}
		if cur.Pinned {
			return cur, false, nil
		}
		pins, err := s.Pins(ctx, cur.RoomID)
		if err != nil {
			return nil, false, err
		}
		if len(pins) >= MaxPins {
			return nil, false, invalid("this channel already has 50 pinned messages")
		}
	}
	msg, err = s.mutate(ctx, id, func(m *Message) (map[string]any, error) {
		if m.Pinned == pinned {
			return nil, nil
		}
		changed = true
		if !pinned {
			m.Pinned, m.PinnedAtTS, m.PinnedBy = false, nil, nil
			return map[string]any{"pinned": false, "pinned_at_ts": nil, "pinned_by": nil}, nil
		}
		now := s.opts.Now().UnixMilli()
		actor := actorID
		m.Pinned, m.PinnedAtTS, m.PinnedBy = true, &now, &actor
		return map[string]any{"pinned": true, "pinned_at_ts": now, "pinned_by": actor}, nil
	})
	return msg, changed, err
}

// Pins returns a channel's pinned, non-deleted messages, newest pin first.
func (s *Service) Pins(ctx context.Context, roomID string) ([]*Message, error) {
	ctx, cancel, err := s.begin(ctx)
	defer cancel()
	if err != nil {
		return nil, err
	}
	pending := s.ov.room(roomID)
	docs, err := s.eng.Pins(ctx, roomID, MaxPins+len(pending)+1)
	if err != nil {
		return nil, engineErr(err)
	}
	byID := make(map[string]*Message, len(docs))
	for _, d := range docs {
		byID[d.ID] = d
	}
	for _, p := range pending {
		delete(byID, p.ID)
		if p.Pinned && !p.IsDeleted {
			byID[p.ID] = p
		}
	}
	out := make([]*Message, 0, len(byID))
	for _, m := range byID {
		out = append(out, m)
	}
	sortByPinned(out)
	return out, nil
}

func sortByPinned(msgs []*Message) {
	at := func(m *Message) int64 {
		if m.PinnedAtTS == nil {
			return 0
		}
		return *m.PinnedAtTS
	}
	sort.Slice(msgs, func(i, j int) bool {
		if at(msgs[i]) != at(msgs[j]) {
			return at(msgs[i]) > at(msgs[j])
		}
		return msgs[i].Seq > msgs[j].Seq
	})
}
