package websocket

import (
	"context"
	"log"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service/chatstore"
)

// NotifySettingPayload is the text_notify_settings event body.
func NotifySettingPayload(roomID string, s chatstore.NotifySetting) models.WebSocketMessage {
	return models.WebSocketMessage{
		Type: "text_notify_settings",
		Data: map[string]any{"room_id": roomID, "mode": s.Mode, "muted_until": s.MutedUntil},
	}
}

// ExpireMutes removes mutes that ran out and tells their owners.
func (h *Hub) ExpireMutes(now time.Time) {
	tc := h.textChatService()
	if tc == nil || tc.Notify == nil {
		return
	}
	expired, err := tc.Notify.TakeExpired(now.UnixMilli())
	if err != nil {
		log.Printf("[TextChat] Failed to expire mutes: %v", err)
		return
	}
	for _, e := range expired {
		h.sendTextToUser(e.UserID, NotifySettingPayload(e.RoomID, chatstore.NotifySetting{Mode: chatstore.NotifyAll}))
	}
}

// StartMuteExpiry runs ExpireMutes periodically until ctx ends.
func (h *Hub) StartMuteExpiry(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(muteExpiryInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				h.ExpireMutes(now)
			}
		}
	}()
}
