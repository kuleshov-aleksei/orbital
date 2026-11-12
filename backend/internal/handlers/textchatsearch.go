package handlers

import (
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

// SearchHit is one entry of GET /api/chat/search.
type SearchHit struct {
	Message chatstore.PublicMessage `json:"message"`
	Snippet string                  `json:"snippet"`
}

var emojiTokenRe = regexp.MustCompile(`<:([\p{L}\p{N}_]{1,64}):[0-9a-f-]{36}>`)

// plainRoomName mirrors the frontend emojiTextToPlain (tokens -> :code:).
func plainRoomName(name string) string {
	return strings.TrimSpace(emojiTokenRe.ReplaceAllString(name, ":$1:"))
}

// matchNames resolves a typed name: exact case-insensitive matches win,
// otherwise prefix matches.
func matchNames[T any](want string, items []T, names func(T) []string, id func(T) string) []string {
	want = strings.ToLower(strings.TrimSpace(want))
	var exact, prefix []string
	for _, it := range items {
		hitExact, hitPrefix := false, false
		for _, n := range names(it) {
			n = strings.ToLower(n)
			if n == "" {
				continue
			}
			if n == want {
				hitExact = true
			} else if strings.HasPrefix(n, want) {
				hitPrefix = true
			}
		}
		if hitExact {
			exact = append(exact, id(it))
		} else if hitPrefix {
			prefix = append(prefix, id(it))
		}
	}
	if len(exact) > 0 {
		return exact
	}
	return prefix
}

func userNames(u *models.User) []string { return []string{u.Nickname, u.OriginalNickname} }

func userID(u *models.User) string { return u.ID }

// Search handles GET /api/chat/search?q=&tz=&sort=relevance|newest&limit=&offset=.
// Results are always limited to the text channels the user can view.
func (h *TextChatHandler) Search(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	started := time.Now()
	query := r.URL.Query()
	loc := time.UTC
	if tz := query.Get("tz"); tz != "" {
		if l, err := time.LoadLocation(tz); err == nil {
			loc = l
		}
	}
	limit, ok1 := queryInt64(r, "limit")
	offset, ok2 := queryInt64(r, "offset")
	if !ok1 || !ok2 {
		http.Error(w, "Invalid limit or offset", http.StatusBadRequest)
		return
	}
	parsed := chatstore.ParseQuery(query.Get("q"))
	hints := []string{}
	respond := func(hits []SearchHit, total int) {
		w.Header().Set("Content-Type", "application/json")
		writeJSON(w, map[string]any{
			"hits": hits, "total": total, "hints": hints, "took_ms": time.Since(started).Milliseconds(),
		})
	}
	if parsed.Empty() {
		respond([]SearchHit{}, 0)
		return
	}

	req := chatstore.SearchRequest{
		Text: strings.TrimSpace(parsed.Text), Pinned: parsed.Pinned,
		Limit: int(limit), Offset: int(min(offset, 1000)),
	}
	switch query.Get("sort") {
	case "newest":
		req.SortNewest = true
	case "", "relevance":
	default:
		http.Error(w, "sort must be relevance or newest", http.StatusBadRequest)
		return
	}
	var fromHints []string
	req.FromTS, req.ToTS, fromHints = parsed.TimeBounds(loc, h.store.Now())
	hints = append(hints, fromHints...)
	if req.FromTS > 0 && req.ToTS > 0 && req.FromTS >= req.ToTS {
		hints = append(hints, "the date filters don't overlap")
		respond([]SearchHit{}, 0)
		return
	}

	// Forced filter: only channels the user can view, intersected with in:.
	var visible []models.Room
	for _, room := range h.roomService.GetRooms() {
		if room.IsText() && h.permissions.CanInRoom(sub, room.ID, permissions.ViewRoom) {
			visible = append(visible, room)
		}
	}
	roomNames := func(room models.Room) []string {
		return []string{plainRoomName(room.Name), plainRoomName(emojiTokenRe.ReplaceAllString(room.Name, ""))}
	}
	roomID := func(room models.Room) string { return room.ID }
	if len(parsed.In) == 0 {
		for _, room := range visible {
			req.RoomIDs = append(req.RoomIDs, room.ID)
		}
	} else {
		seen := map[string]bool{}
		for _, name := range parsed.In {
			ids := matchNames(name, visible, roomNames, roomID)
			if len(ids) == 0 {
				hints = append(hints, fmt.Sprintf("no channel named %q", name))
			}
			for _, id := range ids {
				if !seen[id] {
					seen[id] = true
					req.RoomIDs = append(req.RoomIDs, id)
				}
			}
		}
	}

	users := h.users()
	resolveUsers := func(names []string) ([]string, bool) {
		var out []string
		for _, name := range names {
			ids := matchNames(name, users, userNames, userID)
			if len(ids) == 0 {
				hints = append(hints, fmt.Sprintf("no user named %q", name))
			}
			out = append(out, ids...)
		}
		return out, len(out) > 0
	}
	var okFrom, okMentions = true, true
	if len(parsed.From) > 0 {
		req.SenderIDs, okFrom = resolveUsers(parsed.From)
	}
	if len(parsed.Mentions) > 0 {
		req.MentionUserIDs, okMentions = resolveUsers(parsed.Mentions)
	}
	var hasHints []string
	req.HasKinds, req.HasAttachment, hasHints = parsed.HasFilter()
	hints = append(hints, hasHints...)
	if !okFrom || !okMentions || len(hasHints) > 0 || len(req.RoomIDs) == 0 {
		respond([]SearchHit{}, 0)
		return
	}
	sort.Strings(req.RoomIDs)

	res, err := h.store.Search(r.Context(), req)
	if err != nil {
		writeChatError(w, err)
		return
	}
	hits := make([]SearchHit, len(res.Hits))
	for i, hit := range res.Hits {
		hits[i] = SearchHit{Message: hit.Message.Public(), Snippet: hit.Snippet}
	}
	respond(hits, res.Total)
}
