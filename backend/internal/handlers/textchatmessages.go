package handlers

import (
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

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

// GetPins handles GET /api/rooms/{id}/pins.
func (h *TextChatHandler) GetPins(w http.ResponseWriter, r *http.Request) {
	roomID := mux.Vars(r)["id"]
	if !h.requireTextRoom(w, r, roomID) {
		return
	}
	pins, err := h.store.Pins(r.Context(), roomID)
	if err != nil {
		writeChatError(w, err)
		return
	}
	out := make([]chatstore.PublicMessage, len(pins))
	for i, m := range pins {
		out[i] = m.Public()
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{"messages": out})
}
