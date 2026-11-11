package handlers

import (
	"errors"
	"log"
	"net/http"
	"strconv"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatmedia"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

// TextChatHandler serves text channel history (docs/specs/CHAT_SYSTEM.md §8).
// Writes go over WebSocket (websocket/textchat.go).
type TextChatHandler struct {
	store       *chatstore.Service
	readState   chatstore.ReadStateStore
	notify      chatstore.NotifyStore
	roomService *service.RoomService
	permissions *service.PermissionService
	users       func() []*models.User
	events      TextEventSender
	media       *chatmedia.Service
}

// TextEventSender pushes text channel events to one user's sessions.
type TextEventSender interface {
	SendTextToUser(userID string, message models.WebSocketMessage)
}

// TextChatDeps are the TextChatHandler dependencies. Users lists every user
// (for from:/mentions: search filters); Events may be nil in tests.
type TextChatDeps struct {
	Store       *chatstore.Service
	ReadState   chatstore.ReadStateStore
	Notify      chatstore.NotifyStore
	RoomService *service.RoomService
	Permissions *service.PermissionService
	Users       func() []*models.User
	Events      TextEventSender
	// Media serves attachments; nil when S3 is not configured.
	Media *chatmedia.Service
}

func NewTextChatHandler(d TextChatDeps) *TextChatHandler {
	if d.Notify == nil {
		d.Notify = chatstore.NewMemoryNotify()
	}
	if d.Users == nil {
		d.Users = func() []*models.User { return nil }
	}
	return &TextChatHandler{
		store: d.Store, readState: d.ReadState, notify: d.Notify, roomService: d.RoomService,
		permissions: d.Permissions, users: d.Users, events: d.Events, media: d.Media,
	}
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
