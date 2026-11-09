package websocket

import "github.com/kuleshov-aleksei/orbital/internal/models"

// BroadcastCustomEmojisUpdated tells every connected client to refresh its
// custom emoji library (after an upload, edit or delete).
func (h *Hub) BroadcastCustomEmojisUpdated() {
	h.BroadcastToAll(models.WebSocketMessage{Type: "custom_emojis_updated", Data: map[string]any{}})
}
