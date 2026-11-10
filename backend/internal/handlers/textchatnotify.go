package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
	"github.com/kuleshov-aleksei/orbital/internal/websocket"
)

type notifyRequest struct {
	Mode         string `json:"mode"`
	MuteDuration string `json:"mute_duration"`
}

// SetNotify handles PUT /api/rooms/{id}/notify {mode, mute_duration}.
func (h *TextChatHandler) SetNotify(w http.ResponseWriter, r *http.Request) {
	roomID := mux.Vars(r)["id"]
	if !h.requireTextRoom(w, r, roomID) {
		return
	}
	sub, _ := subjectFromRequest(r)
	var req notifyRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	setting := chatstore.NotifySetting{Mode: req.Mode}
	switch req.Mode {
	case chatstore.NotifyAll, chatstore.NotifyNoMentions:
		if req.MuteDuration != "" {
			http.Error(w, "mute_duration is only valid with mode muted", http.StatusBadRequest)
			return
		}
	case chatstore.NotifyMuted:
		if req.MuteDuration != "forever" {
			d, ok := chatstore.MuteDurations[req.MuteDuration]
			if !ok {
				http.Error(w, "mute_duration must be 1h, 4h, 1d, 1w or forever", http.StatusBadRequest)
				return
			}
			until := h.store.Now().Add(d).UnixMilli()
			setting.MutedUntil = &until
		}
	default:
		http.Error(w, "mode must be all, no_mentions or muted", http.StatusBadRequest)
		return
	}
	if err := h.notify.Set(sub.UserID, roomID, setting); err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	if h.events != nil {
		h.events.SendTextToUser(sub.UserID, websocket.NotifySettingPayload(roomID, setting))
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]any{"room_id": roomID, "mode": setting.Mode, "muted_until": setting.MutedUntil})
}
