package websocket

import (
	"encoding/json"
	"log"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

// StatusAway marks an online user with no active session.
const StatusAway = "away"

// clientStateRequest is client_state: whether the user is using this
// session (page visible, input in the last 10 minutes; focus is ignored).
// Mobile pushes go out only when none of a user's sessions is active and the
// user is not in a call with an open mic (userInOpenMicCall); such a user is
// shown as away.
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
	if c.userID != "" {
		c.hub.refreshAway(c.userID)
	}
}

// globalSessions reports whether userID has a global socket and whether any
// of them is active. Sockets that never sent client_state count as active,
// so older clients never get duplicate pushes.
func (h *Hub) globalSessions(userID string) (hasGlobal, anyActive bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		if client.userID != userID || !isGlobalClient(client) {
			continue
		}
		hasGlobal = true
		client.mu.RLock()
		inactive := client.inactive
		client.mu.RUnlock()
		if !inactive {
			anyActive = true
		}
	}
	return hasGlobal, anyActive
}

// userInOpenMicCall reports whether userID has a live call socket in a room
// where they are unmuted and not deafened. Voice itself never reaches the
// backend (it goes to the LiveKit SFU), so an open mic stands in for
// "talking" and keeps the user active without any input.
func (h *Hub) userInOpenMicCall(userID string) bool {
	if h.roomService == nil {
		return false
	}
	// Collect rooms under h.mu, query roomService after releasing it.
	h.mu.RLock()
	var rooms []string
	for client := range h.clients {
		if client.userID != userID {
			continue
		}
		client.mu.RLock()
		roomID := client.roomID
		client.mu.RUnlock()
		if roomID != "" {
			rooms = append(rooms, roomID)
		}
	}
	h.mu.RUnlock()
	for _, roomID := range rooms {
		if state, ok := h.roomService.GetUserMediaState(roomID, userID); ok && !state.IsMuted && !state.IsDeafened {
			return true
		}
	}
	return false
}

// userIsActive: any global socket is active, or the user is in a call with
// an open mic. Mention pushes are skipped for active users.
func (h *Hub) userIsActive(userID string) bool {
	if _, anyActive := h.globalSessions(userID); anyActive {
		return true
	}
	return h.userInOpenMicCall(userID)
}

// userIsAway: online, has a global socket, none of them is active, and not
// in a call with an open mic.
func (h *Hub) userIsAway(userID string) bool {
	if !h.IsUserOnline(userID) {
		return false
	}
	hasGlobal, anyActive := h.globalSessions(userID)
	if !hasGlobal || anyActive {
		return false
	}
	return !h.userInOpenMicCall(userID)
}

// refreshAway recomputes a user's away state and broadcasts
// user_status {user_id, status: "away"|"online"} when it changed.
func (h *Hub) refreshAway(userID string) {
	away := h.userIsAway(userID)
	h.awayMu.Lock()
	if h.awayUsers == nil {
		h.awayUsers = map[string]bool{}
	}
	if h.awayUsers[userID] == away {
		h.awayMu.Unlock()
		return
	}
	if away {
		h.awayUsers[userID] = true
	} else {
		delete(h.awayUsers, userID)
	}
	h.awayMu.Unlock()

	status := "online"
	if away {
		status = StatusAway
	}
	h.BroadcastToAll(models.WebSocketMessage{
		Type: "user_status",
		Data: map[string]any{"user_id": userID, "status": status},
	})
}

// forgetAway drops the away state of a user who went offline (user_offline
// already told everyone).
func (h *Hub) forgetAway(userID string) {
	h.awayMu.Lock()
	delete(h.awayUsers, userID)
	h.awayMu.Unlock()
}

// resyncAway follows a user_online broadcast, which clients read as "not
// away": reset the cached state and announce away again if it still holds.
func (h *Hub) resyncAway(userID string) {
	h.forgetAway(userID)
	h.refreshAway(userID)
}

func (h *Hub) isAway(userID string) bool {
	h.awayMu.Lock()
	defer h.awayMu.Unlock()
	return h.awayUsers[userID]
}

// onlinePublicUser is the public view of an online user, with away status.
func (h *Hub) onlinePublicUser(user *models.User) models.PublicUser {
	pu := models.NewPublicUser(user, true)
	if h.isAway(user.ID) {
		pu.Status = StatusAway
	}
	return pu
}
