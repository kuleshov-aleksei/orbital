package websocket

import (
	"github.com/kuleshov-aleksei/orbital/internal/models"
)

// BroadcastBadgesUpdated tells every connected client to refresh its badge
// library and assignments (after a badge was created, edited or deleted).
func (h *Hub) BroadcastBadgesUpdated() {
	h.BroadcastToAll(models.WebSocketMessage{Type: "badges_updated", Data: map[string]any{}})
}

// BroadcastUserBadgesUpdated sends one user's new badge set (with award dates)
// so every client updates that user in place.
func (h *Hub) BroadcastUserBadgesUpdated(userID string, badges []models.UserBadge) {
	if badges == nil {
		badges = []models.UserBadge{}
	}
	h.BroadcastToAll(models.WebSocketMessage{
		Type: "user_badges_updated",
		Data: map[string]any{"user_id": userID, "badges": badges},
	})
}
