package websocket

import (
	"github.com/kuleshov-aleksei/orbital/internal/models"
)

// AccountDeleted tears down a deleted account's live state: it leaves its
// voice room (LiveKit included), every socket closes with 4401 (sockets of
// legacy session-less tokens too) and all clients drop the user from their
// lists, so stored content falls back to "Deleted user".
func (h *Hub) AccountDeleted(userID string) {
	if h.roomService != nil {
		if roomID, ok := h.roomService.GetUserRoomID(userID); ok {
			h.RemoveUserFromRoom(roomID, userID, "account_deleted")
		}
		h.roomService.ForgetUser(userID)
	}
	h.closeUserSockets(userID, func(string) bool { return true })
	h.mu.Lock()
	delete(h.onlineUsers, userID)
	h.mu.Unlock()
	h.BroadcastToAll(models.WebSocketMessage{
		Type: "user_deleted",
		Data: map[string]string{"user_id": userID},
	})
}
