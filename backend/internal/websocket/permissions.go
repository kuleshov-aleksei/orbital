package websocket

import (
	"encoding/json"
	"log"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// SetPermissionService enables RBAC enforcement on the hub. When unset (only
// in unit tests) every permission check passes.
func (h *Hub) SetPermissionService(ps *service.PermissionService) {
	h.mu.Lock()
	h.permissions = ps
	h.mu.Unlock()
}

func (h *Hub) permissionService() *service.PermissionService {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.permissions
}

// clientSubject returns the permission subject of a client.
func (c *Client) permSubject() service.Subject {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.subject
}

// canInRoom checks a client's permissions in a room. Must not be called with h.mu held
// for writing.
func (h *Hub) canInRoom(ps *service.PermissionService, c *Client, roomID string, want permissions.Permission) bool {
	if ps == nil {
		return true
	}
	return ps.CanInRoom(c.permSubject(), roomID, want)
}

// CanUserInRoom checks a user's permissions in a room by user ID.
func (h *Hub) CanUserInRoom(userID, roomID string, want permissions.Permission) bool {
	ps := h.permissionService()
	if ps == nil {
		return true
	}
	return ps.CanInRoom(ps.SubjectByID(userID), roomID, want)
}

// BroadcastRoomScoped sends a room-related message only to clients that can
// see the room (VIEW_ROOM). Use for room lists, presence and media state.
func (h *Hub) BroadcastRoomScoped(roomID string, message interface{}) {
	data, err := json.Marshal(message)
	if err != nil {
		log.Printf("[WebSocket] Error marshaling room-scoped message: %v", err)
		return
	}
	ps := h.permissionService()

	h.mu.RLock()
	targets := make([]*Client, 0, len(h.clients))
	for client := range h.clients {
		targets = append(targets, client)
	}
	h.mu.RUnlock()

	for _, client := range targets {
		if !h.canInRoom(ps, client, roomID, permissions.ViewRoom) {
			continue
		}
		h.trySend(client, data)
	}
}

// BroadcastRoomOrder sends room sort orders, filtered to the rooms each client can see.
func (h *Hub) BroadcastRoomOrder(orders map[string]int) {
	ps := h.permissionService()
	h.mu.RLock()
	targets := make([]*Client, 0, len(h.clients))
	for client := range h.clients {
		targets = append(targets, client)
	}
	h.mu.RUnlock()

	for _, client := range targets {
		visible := make(map[string]int, len(orders))
		for roomID, order := range orders {
			if h.canInRoom(ps, client, roomID, permissions.ViewRoom) {
				visible[roomID] = order
			}
		}
		if len(visible) == 0 {
			continue
		}
		h.trySend(client, marshalMessage(models.WebSocketMessage{
			Type: "room_order_updated",
			Data: map[string]interface{}{"orders": visible},
		}))
	}
}

// trySend queues data on a client without blocking.
func (h *Hub) trySend(client *Client, data []byte) {
	defer func() {
		// The channel may have been closed concurrently by another broadcast.
		_ = recover()
	}()
	select {
	case client.send <- data:
	default:
		log.Printf("[WebSocket] Dropping message for user %s: channel blocked", client.userID)
	}
}

// SendToUserEverywhere sends a message to every connection of a user.
func (h *Hub) SendToUserEverywhere(userID string, message interface{}) {
	data := marshalMessage(message)
	h.mu.RLock()
	targets := make([]*Client, 0)
	for client := range h.clients {
		if client.userID == userID {
			targets = append(targets, client)
		}
	}
	h.mu.RUnlock()
	for _, client := range targets {
		h.trySend(client, data)
	}
}

// BroadcastPermissionsUpdated tells every client to refetch permissions and
// room/category lists.
func (h *Hub) BroadcastPermissionsUpdated(reason string) {
	h.BroadcastToAll(models.WebSocketMessage{
		Type: "permissions_updated",
		Data: map[string]string{"reason": reason},
	})
}

// RemoveUserFromRoom forcibly removes a user from a room (kick or lost
// permission) and notifies everyone who can see the room. Returns false if
// the user was not in the room.
func (h *Hub) RemoveUserFromRoom(roomID, userID, reason string) bool {
	if h.roomService == nil || !h.roomService.IsUserInRoom(roomID, userID) {
		return false
	}
	removed := h.roomService.KickUser(roomID, userID)
	if removed == nil {
		return false
	}
	if h.livekitService != nil {
		if err := h.livekitService.RemoveParticipant(roomID, userID); err != nil {
			log.Printf("[WebSocket] Failed to remove %s from LiveKit room %s: %v", userID, roomID, err)
		}
	}
	h.updateSessionLastSeen(userID, roomID)

	// Unsubscribe the user's sockets from the room's channel.
	h.mu.Lock()
	for client := range h.roomClients[roomID] {
		if client.userID == userID {
			delete(h.roomClients[roomID], client)
		}
	}
	h.mu.Unlock()

	msg := models.WebSocketMessage{
		Type: "room_user_left",
		Data: map[string]interface{}{
			"room_id": roomID,
			"user":    removed,
			"reason":  reason,
		},
	}
	h.BroadcastRoomScoped(roomID, msg)
	// The removed user may no longer be able to see the room; tell them directly.
	h.SendToUserEverywhere(userID, msg)
	h.BroadcastToRoom(roomID, models.WebSocketMessage{Type: "room_users", Data: h.roomService.GetRoomUsers(roomID)})
	return true
}

// coerceMediaState clears screen share / camera flags the user is not allowed to have.
func (h *Hub) coerceMediaState(c *Client, state *models.UpdateMediaStateRequest) {
	ps := h.permissionService()
	if ps == nil {
		return
	}
	perms := ps.RoomPerms(c.permSubject(), state.RoomID)
	if state.IsScreenSharing && !perms.Has(permissions.Screenshare) {
		state.IsScreenSharing = false
	}
	if state.IsCameraEnabled && !perms.Has(permissions.Video) {
		state.IsCameraEnabled = false
	}
}

func sendPermissionDenied(c *Client, action, roomID string) {
	select {
	case c.send <- marshalMessage(models.WebSocketMessage{
		Type: "permission_denied",
		Data: map[string]string{"action": action, "room_id": roomID},
	}):
	default:
	}
}

// OnPermissionsChanged re-applies effective permissions to everyone after any
// RBAC change: refreshes cached subjects, removes members who lost VIEW_ROOM
// or CONNECT, pushes new publish grants to LiveKit, clears media flags that are
// no longer allowed, and tells every client to refetch permissions/rooms.
func (h *Hub) OnPermissionsChanged(change service.PermissionChange) {
	ps := h.permissionService()
	if ps == nil {
		return
	}

	// Refresh RBAC identity of connected clients (e.g. guest upgraded to account).
	h.mu.RLock()
	clients := make([]*Client, 0, len(h.clients))
	for client := range h.clients {
		clients = append(clients, client)
	}
	h.mu.RUnlock()
	for _, client := range clients {
		client.mu.RLock()
		userID := client.userID
		client.mu.RUnlock()
		if userID == "" {
			continue
		}
		sub := ps.SubjectByID(userID)
		client.mu.Lock()
		client.subject = sub
		client.mu.Unlock()
	}

	if h.roomService != nil {
		type grantUpdate struct {
			roomID, userID string
			perms          permissions.Permission
		}
		var updates []grantUpdate

		for _, room := range h.roomService.GetRooms() {
			for _, userID := range h.roomService.GetRoomMemberIDs(room.ID) {
				perms := ps.RoomPerms(ps.SubjectByID(userID), room.ID)
				key := room.ID + "|" + userID
				if !perms.Has(permissions.ViewRoom | permissions.Connect) {
					log.Printf("[RBAC] Removing %s from room %s: permission revoked (%s)", userID, room.ID, change.Reason)
					h.RemoveUserFromRoom(room.ID, userID, "permission_revoked")
					h.forgetAppliedGrant(key)
					continue
				}
				if h.swapAppliedGrant(key, perms) {
					updates = append(updates, grantUpdate{room.ID, userID, perms})
				}
				h.enforceMediaState(room.ID, userID, perms)
			}
		}

		if h.livekitService != nil && h.livekitService.IsHealthy() && len(updates) > 0 {
			go func() {
				for _, u := range updates {
					if err := h.livekitService.UpdateParticipantPermissions(u.roomID, u.userID, u.perms); err != nil {
						log.Printf("[RBAC] LiveKit permission update for %s in %s failed: %v", u.userID, u.roomID, err)
					}
				}
			}()
		}
	}

	h.BroadcastPermissionsUpdated(change.Reason)
}

// swapAppliedGrant records the permissions last pushed to LiveKit for a
// member and reports whether they changed.
func (h *Hub) swapAppliedGrant(key string, perms permissions.Permission) bool {
	h.grantsMu.Lock()
	defer h.grantsMu.Unlock()
	if h.appliedGrants == nil {
		h.appliedGrants = make(map[string]permissions.Permission)
	}
	prev, ok := h.appliedGrants[key]
	h.appliedGrants[key] = perms
	// First sighting: the member's token was minted with current perms, but
	// we cannot be sure (token may predate the change), so push once.
	return !ok || prev != perms
}

func (h *Hub) forgetAppliedGrant(key string) {
	h.grantsMu.Lock()
	delete(h.appliedGrants, key)
	h.grantsMu.Unlock()
}

// enforceMediaState clears screen share / camera flags a member lost permission for.
func (h *Hub) enforceMediaState(roomID, userID string, perms permissions.Permission) {
	state, ok := h.roomService.GetUserMediaState(roomID, userID)
	if !ok {
		return
	}
	req := models.UpdateMediaStateRequest{
		RoomID:          roomID,
		IsMuted:         state.IsMuted,
		IsDeafened:      state.IsDeafened,
		IsScreenSharing: state.IsScreenSharing && perms.Has(permissions.Screenshare),
		IsCameraEnabled: state.IsCameraEnabled && perms.Has(permissions.Video),
	}
	if req.IsScreenSharing == state.IsScreenSharing && req.IsCameraEnabled == state.IsCameraEnabled {
		return
	}
	if changed, ok := h.roomService.UpdateUserMediaState(roomID, userID, req); ok && changed {
		h.BroadcastRoomScoped(roomID, models.WebSocketMessage{
			Type: "user_media_state",
			Data: models.UserMediaState{
				UserID: userID, RoomID: roomID,
				IsMuted: req.IsMuted, IsDeafened: req.IsDeafened,
				IsScreenSharing: req.IsScreenSharing, IsCameraEnabled: req.IsCameraEnabled,
			},
		})
	}
}
