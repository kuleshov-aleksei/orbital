package handlers

import (
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

// TextChatHandler serves text channel history (docs/specs/CHAT_SYSTEM.md §8).
// Writes go over WebSocket (websocket/textchat.go).
type TextChatHandler struct {
	store       *chatstore.Service
	readState   chatstore.ReadStateStore
	roomService *service.RoomService
	permissions *service.PermissionService
}

func NewTextChatHandler(store *chatstore.Service, readState chatstore.ReadStateStore, roomService *service.RoomService, ps *service.PermissionService) *TextChatHandler {
	return &TextChatHandler{store: store, readState: readState, roomService: roomService, permissions: ps}
}

func writeChatError(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")
	switch {
	case errors.Is(err, chatstore.ErrNotFound):
		w.WriteHeader(http.StatusNotFound)
		writeJSON(w, map[string]string{"error": "not_found"})
	case errors.Is(err, chatstore.ErrInvalid):
		w.WriteHeader(http.StatusBadRequest)
		writeJSON(w, map[string]string{"error": err.Error()})
	default:
		log.Printf("[TextChat] Store error: %v", err)
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]string{"error": "chat_unavailable"})
	}
}

func queryInt64(r *http.Request, key string) (int64, bool) {
	v := r.URL.Query().Get(key)
	if v == "" {
		return 0, true
	}
	n, err := strconv.ParseInt(v, 10, 64)
	return n, err == nil && n >= 0
}

// requireTextRoom checks VIEW_ROOM and that the room is a text channel.
func (h *TextChatHandler) requireTextRoom(w http.ResponseWriter, r *http.Request, roomID string) bool {
	if _, ok := requireRoomPerm(w, r, h.permissions, roomID, permissions.ViewRoom); !ok {
		return false
	}
	room, ok := h.roomService.GetRoom(roomID)
	if !ok || !room.IsText() {
		http.Error(w, "Text channel not found", http.StatusNotFound)
		return false
	}
	return true
}

// GetMessages handles GET /api/rooms/{id}/messages?before_seq=|after_seq=|around_seq=|before_ts=&limit=
func (h *TextChatHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	roomID := mux.Vars(r)["id"]
	if !h.requireTextRoom(w, r, roomID) {
		return
	}
	q := chatstore.HistoryQuery{RoomID: roomID}
	var ok bool
	if q.BeforeSeq, ok = queryInt64(r, "before_seq"); !ok {
		http.Error(w, "Invalid before_seq", http.StatusBadRequest)
		return
	}
	if q.AfterSeq, ok = queryInt64(r, "after_seq"); !ok {
		http.Error(w, "Invalid after_seq", http.StatusBadRequest)
		return
	}
	if q.AroundSeq, ok = queryInt64(r, "around_seq"); !ok {
		http.Error(w, "Invalid around_seq", http.StatusBadRequest)
		return
	}
	if q.BeforeTS, ok = queryInt64(r, "before_ts"); !ok {
		http.Error(w, "Invalid before_ts", http.StatusBadRequest)
		return
	}
	limit, ok := queryInt64(r, "limit")
	if !ok {
		http.Error(w, "Invalid limit", http.StatusBadRequest)
		return
	}
	q.Limit = int(min(limit, chatstore.MaxPageSize))

	page, err := h.store.History(r.Context(), q)
	if err != nil {
		writeChatError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, page)
}

// GetMessageContext handles GET /api/messages/{id}/context?n=25: a window
// around one message (reply jumps, search results).
func (h *TextChatHandler) GetMessageContext(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	msg, err := h.store.Get(r.Context(), id)
	if err != nil {
		writeChatError(w, err)
		return
	}
	// A message in a hidden channel is reported exactly like a missing one.
	if !h.permissions.CanInRoom(sub, msg.RoomID, permissions.ViewRoom) {
		writeChatError(w, chatstore.ErrNotFound)
		return
	}
	n, ok := queryInt64(r, "n")
	if !ok {
		http.Error(w, "Invalid n", http.StatusBadRequest)
		return
	}
	if n <= 0 {
		n = 25
	}
	page, err := h.store.History(r.Context(), chatstore.HistoryQuery{
		RoomID: msg.RoomID, AroundSeq: msg.Seq, Limit: int(min(n*2, chatstore.MaxPageSize)),
	})
	if err != nil {
		writeChatError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{
		"room_id":         msg.RoomID,
		"message_id":      msg.ID,
		"messages":        page.Messages,
		"replied":         page.Replied,
		"has_more_before": page.HasMoreBefore,
		"has_more_after":  page.HasMoreAfter,
	})
}

// UnreadChannel is one entry of GET /api/chat/unread.
type UnreadChannel struct {
	RoomID       string `json:"room_id"`
	LastReadSeq  int64  `json:"last_read_seq"`
	NewestSeq    int64  `json:"newest_seq"`
	MentionCount int    `json:"mention_count"`
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
	channels := make([]UnreadChannel, 0)
	for _, room := range h.roomService.GetRooms() {
		if !room.IsText() || !h.permissions.CanInRoom(sub, room.ID, permissions.ViewRoom) {
			continue
		}
		channels = append(channels, UnreadChannel{
			RoomID:      room.ID,
			LastReadSeq: read[room.ID],
			NewestSeq:   h.store.NewestSeq(room.ID),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{"channels": channels, "available": h.store.Ready()})
}
