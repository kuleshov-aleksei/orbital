package handlers

import (
	"log"
	"net/http"

	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

// UnreadChannel is one entry of GET /api/chat/unread.
type UnreadChannel struct {
	RoomID       string `json:"room_id"`
	LastReadSeq  int64  `json:"last_read_seq"`
	NewestSeq    int64  `json:"newest_seq"`
	MentionCount int    `json:"mention_count"`
	NotifyMode   string `json:"notify_mode"`
	MutedUntil   *int64 `json:"muted_until"`
}

// GetUnread handles GET /api/chat/unread: read state of every visible text
// channel, for sidebar badges on load.
func (h *TextChatHandler) GetUnread(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	read, err := h.readState.ForUser(sub.UserID)
	if err != nil {
		log.Printf("[TextChat] Failed to load read state for %s: %v", sub.UserID, err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	settings, err := h.notify.ForUser(sub.UserID)
	if err != nil {
		log.Printf("[TextChat] Failed to load notification settings for %s: %v", sub.UserID, err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	now := h.store.Now()
	roleIDs := h.permissions.UserRoleIDs(sub.UserID)
	channels := make([]UnreadChannel, 0)
	var counts []chatstore.MentionCountQuery
	var countIdx []int
	for _, room := range h.roomService.GetRooms() {
		if !room.IsText() || !h.permissions.CanInRoom(sub, room.ID, permissions.ViewRoom) {
			continue
		}
		setting := settings[room.ID].Effective(now)
		ch := UnreadChannel{
			RoomID:      room.ID,
			LastReadSeq: read[room.ID],
			NewestSeq:   h.store.NewestSeq(room.ID),
			NotifyMode:  setting.Mode,
			MutedUntil:  setting.MutedUntil,
		}
		// Mention badges only where they apply and something is unread.
		if setting.WantsMentions(now) && ch.NewestSeq > ch.LastReadSeq {
			counts = append(counts, chatstore.MentionCountQuery{
				RoomID: room.ID, AfterSeq: ch.LastReadSeq, UserID: sub.UserID, RoleIDs: roleIDs,
			})
			countIdx = append(countIdx, len(channels))
		}
		channels = append(channels, ch)
	}
	if len(counts) > 0 && h.store.Ready() {
		got, err := h.store.MentionCounts(r.Context(), counts)
		if err != nil {
			log.Printf("[TextChat] Failed to count mentions for %s: %v", sub.UserID, err)
		} else {
			for i, n := range got {
				channels[countIdx[i]].MentionCount = n
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{"channels": channels, "available": h.store.Ready()})
}
