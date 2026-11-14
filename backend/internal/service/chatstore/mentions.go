package chatstore

import "regexp"

// MaxMentions caps the mentions of one message (users + roles).
const MaxMentions = 20

var mentionCaptureRe = regexp.MustCompile(`<@(&?)(` + mentionIDChars + `)>`)

// ParseMentions extracts unique user and role ids from mention tokens, in
// order of appearance.
func ParseMentions(content string) (users, roles []string) {
	seen := map[string]bool{}
	for _, m := range mentionCaptureRe.FindAllStringSubmatch(content, -1) {
		key := m[1] + m[2]
		if seen[key] {
			continue
		}
		seen[key] = true
		if m[1] == "&" {
			roles = append(roles, m[2])
		} else {
			users = append(users, m[2])
		}
	}
	return users, roles
}

// MentionResolver filters parsed mention ids for a channel: it drops unknown
// users, users who can't view the channel, unknown roles and the system
// roles. The websocket layer installs it; nil keeps every id.
type MentionResolver func(roomID string, users, roles []string) (keptUsers, keptRoles []string)

// SetMentionResolver installs the mention filter.
func (s *Service) SetMentionResolver(fn MentionResolver) {
	s.revertMu.Lock()
	s.resolveMentions = fn
	s.revertMu.Unlock()
}

// mentionsFor resolves content tokens and merges extra (reply-ping) users,
// capped at MaxMentions in total.
func (s *Service) mentionsFor(roomID, content string, extraUsers []string) (users, roles []string) {
	users, roles = ParseMentions(content)
	s.revertMu.RLock()
	fn := s.resolveMentions
	s.revertMu.RUnlock()
	if fn != nil && (len(users) > 0 || len(roles) > 0) {
		users, roles = fn(roomID, users, roles)
	}
	outUsers := []string{}
	seen := map[string]bool{}
	for _, list := range [][]string{extraUsers, users} {
		for _, u := range list {
			if !seen[u] {
				seen[u] = true
				outUsers = append(outUsers, u)
			}
		}
	}
	outRoles := append([]string{}, roles...)
	if len(outUsers) > MaxMentions {
		outUsers = outUsers[:MaxMentions]
	}
	if room := MaxMentions - len(outUsers); len(outRoles) > room {
		outRoles = outRoles[:room]
	}
	return outUsers, outRoles
}

// replyPinged returns the users of an existing message that came from a
// reply ping rather than from content tokens (kept across edits).
func replyPinged(m *Message) []string {
	tokens, _ := ParseMentions(m.Content)
	fromTokens := map[string]bool{}
	for _, u := range tokens {
		fromTokens[u] = true
	}
	var out []string
	for _, u := range m.MentionUserIDs {
		if !fromTokens[u] {
			out = append(out, u)
		}
	}
	return out
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// PlainText renders message content for plain-text sinks (push
// notifications): mentions become "@name", custom emoji ":shortcode:".
// userName and roleName return "" for unknown ids.
func PlainText(content string, userName, roleName func(id string) string) string {
	s := customEmojiTokenRe.ReplaceAllString(content, ":$1:")
	return mentionCaptureRe.ReplaceAllStringFunc(s, func(tok string) string {
		m := mentionCaptureRe.FindStringSubmatch(tok)
		name := ""
		if m[1] == "&" {
			if roleName != nil {
				name = roleName(m[2])
			}
			if name == "" {
				name = "role"
			}
		} else {
			if userName != nil {
				name = userName(m[2])
			}
			if name == "" {
				name = "unknown"
			}
		}
		return "@" + name
	})
}
