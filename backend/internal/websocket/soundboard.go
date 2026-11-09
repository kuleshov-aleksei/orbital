package websocket

import (
	"encoding/json"
	"log"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
)

// SoundPlayCooldown is the minimum gap between two soundboard plays by one user.
const SoundPlayCooldown = 2 * time.Second

// SoundLookup is the part of the soundboard service the hub needs.
type SoundLookup interface {
	SoundExists(id string) bool
}

// SetSoundboard wires the soundboard library used to validate play_sound.
func (h *Hub) SetSoundboard(s SoundLookup) {
	h.mu.Lock()
	h.soundboard = s
	h.mu.Unlock()
}

func (h *Hub) soundLookup() SoundLookup {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.soundboard
}

// allowSoundPlay applies the per-user cooldown. It is keyed by user, not by
// connection, so opening extra sockets does not bypass it.
func (h *Hub) allowSoundPlay(userID string, now time.Time) bool {
	h.soundMu.Lock()
	defer h.soundMu.Unlock()
	if h.lastSoundPlay == nil {
		h.lastSoundPlay = make(map[string]time.Time)
	}
	if last, ok := h.lastSoundPlay[userID]; ok && now.Sub(last) < SoundPlayCooldown {
		return false
	}
	h.lastSoundPlay[userID] = now
	return true
}

// BroadcastSoundboardUpdated tells every connected client to refresh its
// soundboard library (after an upload, edit or delete).
func (h *Hub) BroadcastSoundboardUpdated() {
	h.BroadcastToAll(models.WebSocketMessage{Type: "soundboard_updated", Data: map[string]any{}})
}

// handlePlaySound validates a play_sound request and fans it out to the room.
// Every client plays the clip locally (preloaded), applying its own volume.
func (c *Client) handlePlaySound(data interface{}) {
	c.mu.RLock()
	userID := c.userID
	roomID := c.roomID
	c.mu.RUnlock()

	if userID == "" {
		return
	}
	if roomID == "" || c.hub.roomService == nil || !c.hub.roomService.IsUserInRoom(roomID, userID) {
		c.send <- marshalMessage(models.WebSocketMessage{
			Type: "error",
			Data: map[string]string{"message": "You are not in this room"},
		})
		return
	}
	if !c.hub.canInRoom(c.hub.permissionService(), c, roomID, permissions.UseSoundboard) {
		log.Printf("[Soundboard] Rejecting play from user %s in room %s: missing use_soundboard", userID, roomID)
		sendPermissionDenied(c, "play_sound", roomID)
		return
	}

	var req models.PlaySoundRequest
	jsonData, _ := json.Marshal(data)
	if err := json.Unmarshal(jsonData, &req); err != nil || req.SoundID == "" {
		log.Printf("[Soundboard] Invalid play_sound payload from %s", userID)
		return
	}
	lookup := c.hub.soundLookup()
	if lookup == nil || !lookup.SoundExists(req.SoundID) {
		c.send <- marshalMessage(models.WebSocketMessage{
			Type: "error",
			Data: map[string]string{"message": "Sound not found"},
		})
		return
	}
	if !c.hub.allowSoundPlay(userID, time.Now()) {
		return // silently drop spam; the client also enforces a cooldown
	}

	c.hub.BroadcastToRoom(roomID, models.WebSocketMessage{
		Type: "sound_played",
		Data: map[string]string{
			"room_id":  roomID,
			"sound_id": req.SoundID,
			"user_id":  userID,
		},
	})
}
