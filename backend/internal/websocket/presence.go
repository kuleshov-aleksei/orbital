package websocket

import (
	"encoding/json"
	"log"
)

// clientStateRequest is client_state: whether the user is looking at this
// session (page visible, focused, recent input). Mobile pushes go out only
// when none of a user's sessions is active.
type clientStateRequest struct {
	Active bool `json:"active"`
}

func (c *Client) handleClientState(data any) {
	raw, _ := json.Marshal(data)
	var req clientStateRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		log.Printf("[WebSocket] Invalid client_state payload: %v", err)
		return
	}
	c.mu.Lock()
	c.inactive = !req.Active
	c.mu.Unlock()
}

// userIsActive reports whether any global socket of userID is active.
// Sockets that never sent client_state count as active, so older clients
// never get duplicate pushes.
func (h *Hub) userIsActive(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		if client.userID != userID || !isGlobalClient(client) {
			continue
		}
		client.mu.RLock()
		inactive := client.inactive
		client.mu.RUnlock()
		if !inactive {
			return true
		}
	}
	return false
}
