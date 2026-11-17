package websocket

import (
	"encoding/json"
	"log"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
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
		c.hub.refreshPresence(c.userID)
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

// presenceState is what clients know about an online user beyond "online".
// The zero value (active, not mobile-only) is what user_online implies.
type presenceState struct {
	Away   bool
	Mobile bool
}

// userOnMobileOnly reports whether userID has any socket, and whether all of
// them come from the mobile app (?client=android/<version>). A desktop or web
// session next to the phone hides the mobile indicator, as in Discord.
func (h *Hub) userOnMobileOnly(userID string) (hasSockets, mobileOnly bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.clients {
		if client.userID != userID {
			continue
		}
		// clientID is set once when the socket is created.
		if platform, _ := service.ParseClientID(client.clientID); platform != service.PlatformAndroid {
			return true, false
		}
		hasSockets = true
	}
	return hasSockets, hasSockets
}

// refreshPresence recomputes a user's presence and broadcasts
// user_status {user_id, status: "away"|"online", mobile} when it changed.
func (h *Hub) refreshPresence(userID string) {
	online := h.IsUserOnline(userID)
	hasSockets, mobileOnly := h.userOnMobileOnly(userID)
	state := presenceState{Away: h.userIsAway(userID), Mobile: online && mobileOnly}

	h.presenceMu.Lock()
	if h.presence == nil {
		h.presence = map[string]presenceState{}
	}
	// A user whose sockets all closed stays online until the last ping
	// expires (30 s). Keep the mobile flag for that lingering time, so closing
	// the app doesn't flip the user to "desktop" before they go offline.
	if online && !hasSockets {
		state.Mobile = h.presence[userID].Mobile
	}
	if h.presence[userID] == state {
		h.presenceMu.Unlock()
		return
	}
	if state == (presenceState{}) {
		delete(h.presence, userID)
	} else {
		h.presence[userID] = state
	}
	h.presenceMu.Unlock()

	status := "online"
	if state.Away {
		status = StatusAway
	}
	h.BroadcastToAll(models.WebSocketMessage{
		Type: "user_status",
		Data: map[string]any{"user_id": userID, "status": status, "mobile": state.Mobile},
	})
}

// forgetPresence drops the presence state of a user who went offline
// (user_offline already told everyone).
func (h *Hub) forgetPresence(userID string) {
	h.presenceMu.Lock()
	delete(h.presence, userID)
	h.presenceMu.Unlock()
}

// resyncPresence follows a user_online broadcast, which clients read as "not
// away, not mobile": reset the cached state and announce it again if needed.
func (h *Hub) resyncPresence(userID string) {
	h.forgetPresence(userID)
	h.refreshPresence(userID)
}

func (h *Hub) presenceOf(userID string) presenceState {
	h.presenceMu.Lock()
	defer h.presenceMu.Unlock()
	return h.presence[userID]
}

// onlinePublicUser is the public view of an online user, with away status
// and the mobile flag.
func (h *Hub) onlinePublicUser(user *models.User) models.PublicUser {
	pu := models.NewPublicUser(user, true)
	state := h.presenceOf(user.ID)
	if state.Away {
		pu.Status = StatusAway
	}
	pu.Mobile = state.Mobile
	return pu
}
