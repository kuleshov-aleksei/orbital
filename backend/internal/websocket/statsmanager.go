package websocket

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

const (
	defaultStatsIntervalMs = 15000
)

func (h *Hub) EnableStatsCollection(roomID string) {
	h.mu.Lock()
	h.statsEnabledRooms[roomID] = true
	if h.statsRoomData[roomID] == nil {
		h.statsRoomData[roomID] = make(map[string]models.ClientStatsBatch)
	}
	h.mu.Unlock()

	log.Printf("[Stats] Stats collection enabled for room %s", roomID)

	h.BroadcastToRoom(roomID, models.WebSocketMessage{
		Type: "enable_stats_collection",
		Data: models.EnableStatsCommand{
			RoomID:     roomID,
			Action:     "enable",
			IntervalMs: defaultStatsIntervalMs,
		},
	})
}

func (h *Hub) DisableStatsCollection(roomID string) {
	h.mu.Lock()
	delete(h.statsEnabledRooms, roomID)
	delete(h.statsRoomData, roomID)
	h.mu.Unlock()

	log.Printf("[Stats] Stats collection disabled for room %s", roomID)

	h.BroadcastToRoom(roomID, models.WebSocketMessage{
		Type: "disable_stats_collection",
		Data: models.EnableStatsCommand{
			RoomID: roomID,
			Action: "disable",
		},
	})
}

func (h *Hub) IsStatsEnabled(roomID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.statsEnabledRooms[roomID]
}

func (h *Hub) GetEnabledRooms() []models.StatsStatus {
	h.mu.RLock()
	defer h.mu.RUnlock()

	statuses := make([]models.StatsStatus, 0, len(h.statsEnabledRooms))
	for roomID, enabled := range h.statsEnabledRooms {
		statuses = append(statuses, models.StatsStatus{
			RoomID:  roomID,
			Enabled: enabled,
		})
	}
	return statuses
}

func (h *Hub) SubscribeAdmin(client *Client, roomID string) {
	h.mu.Lock()
	if h.statsAdminSubs[roomID] == nil {
		h.statsAdminSubs[roomID] = make(map[*Client]bool)
	}
	h.statsAdminSubs[roomID][client] = true
	h.mu.Unlock()

	log.Printf("[Stats] Admin client %s subscribed to room %s stats", client.userID, roomID)

	h.sendRoomStatsToAdmin(client, roomID)
}

func (h *Hub) UnsubscribeAdmin(client *Client) {
	h.mu.Lock()
	for roomID, subs := range h.statsAdminSubs {
		delete(subs, client)
		if len(subs) == 0 {
			delete(h.statsAdminSubs, roomID)
		}
	}
	h.mu.Unlock()
	log.Printf("[Stats] Admin client %s unsubscribed from all stats", client.userID)
}

func (h *Hub) SubscribeAdminByUserID(userID, roomID string) {
	h.mu.RLock()
	var targetClient *Client
	for client := range h.clients {
		client.mu.RLock()
		cid := client.userID
		client.mu.RUnlock()
		if cid == userID {
			targetClient = client
			break
		}
	}
	h.mu.RUnlock()

	if targetClient != nil {
		h.SubscribeAdmin(targetClient, roomID)
	} else {
		// Store pending subscription for when the WS client connects/authenticates
		h.mu.Lock()
		if h.pendingAdminSubs[userID] == nil {
			h.pendingAdminSubs[userID] = make(map[string]bool)
		}
		h.pendingAdminSubs[userID][roomID] = true
		h.mu.Unlock()
		log.Printf("[Stats] No WS client found for user %s, pending subscription to room %s", userID, roomID)
	}
}

func (h *Hub) applyPendingAdminSubs(client *Client, userID string) {
	h.mu.Lock()
	pending, exists := h.pendingAdminSubs[userID]
	if exists {
		delete(h.pendingAdminSubs, userID)
	}
	h.mu.Unlock()

	if !exists || len(pending) == 0 {
		return
	}

	for roomID := range pending {
		h.SubscribeAdmin(client, roomID)
		log.Printf("[Stats] Applied pending subscription: user %s -> room %s", userID, roomID)
	}
}

func (h *Hub) UnsubscribeAdminByUserID(userID, roomID string) {
	h.mu.RLock()
	var targetClient *Client
	for client := range h.clients {
		client.mu.RLock()
		cid := client.userID
		client.mu.RUnlock()
		if cid == userID {
			targetClient = client
			break
		}
	}
	h.mu.RUnlock()

	if targetClient != nil {
		h.mu.Lock()
		if subs, ok := h.statsAdminSubs[roomID]; ok {
			delete(subs, targetClient)
			if len(subs) == 0 {
				delete(h.statsAdminSubs, roomID)
			}
		}
		h.mu.Unlock()
		log.Printf("[Stats] User %s unsubscribed from room %s stats", userID, roomID)
	} else {
		log.Printf("[Stats] No WebSocket client found for user %s to unsubscribe from room %s", userID, roomID)
	}
}

func (h *Hub) sendRoomStatsToAdmin(client *Client, roomID string) {
	h.mu.RLock()
	roomData, hasRoom := h.statsRoomData[roomID]
	if !hasRoom || len(roomData) == 0 {
		h.mu.RUnlock()
		return
	}

	reports := make(map[string]models.ClientStatsBatch, len(roomData))
	for reporterID, batch := range roomData {
		reports[reporterID] = batch
	}
	h.mu.RUnlock()

	msg := models.WebSocketMessage{
		Type: "room_stats",
		Data: models.RoomStatsMessage{
			RoomID:  roomID,
			Reports: reports,
		},
	}

	client.send <- marshalMessage(msg)
}

func (h *Hub) broadcastRoomStats(roomID string) {
	h.mu.RLock()
	roomData, hasRoom := h.statsRoomData[roomID]
	subs := h.statsAdminSubs[roomID]

	if !hasRoom || len(roomData) == 0 || len(subs) == 0 {
		h.mu.RUnlock()
		return
	}

	reports := make(map[string]models.ClientStatsBatch, len(roomData))
	for reporterID, batch := range roomData {
		reports[reporterID] = batch
	}

	subList := make([]*Client, 0, len(subs))
	for client := range subs {
		subList = append(subList, client)
	}
	h.mu.RUnlock()

	msg := models.WebSocketMessage{
		Type: "room_stats",
		Data: models.RoomStatsMessage{
			RoomID:  roomID,
			Reports: reports,
		},
	}

	data := marshalMessage(msg)

	for _, client := range subList {
		select {
		case client.send <- data:
		default:
			log.Printf("[Stats] Failed to send stats to admin client %s: channel blocked", client.userID)
		}
	}
}

func (c *Client) handleClientStatsBatch(data interface{}) {
	dataStr, ok := data.(string)
	if !ok {
		log.Printf("[Stats] client_stats_batch data is not a string")
		return
	}

	compressed, err := base64.StdEncoding.DecodeString(dataStr)
	if err != nil {
		log.Printf("[Stats] Failed to base64 decode stats batch: %v", err)
		return
	}

	reader, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		log.Printf("[Stats] Failed to create gzip reader: %v", err)
		return
	}
	defer reader.Close()

	raw, err := io.ReadAll(reader)
	if err != nil {
		log.Printf("[Stats] Failed to decompress stats batch: %v", err)
		return
	}

	var batch models.ClientStatsBatch
	if err := json.Unmarshal(raw, &batch); err != nil {
		log.Printf("[Stats] Failed to unmarshal stats batch: %v", err)
		return
	}

	c.mu.RLock()
	userID := c.userID
	roomID := c.roomID
	c.mu.RUnlock()

	if batch.RoomID != roomID || batch.ReporterID != userID {
		log.Printf("[Stats] Stats batch room/user mismatch: client=%s/%s, batch=%s/%s",
			roomID, userID, batch.RoomID, batch.ReporterID)
		return
	}

	if !c.hub.IsStatsEnabled(roomID) {
		return
	}

	batch.Timestamp = time.Now().UnixMilli()

	c.hub.mu.Lock()
	roomData, ok := c.hub.statsRoomData[roomID]
	if !ok {
		roomData = make(map[string]models.ClientStatsBatch)
		c.hub.statsRoomData[roomID] = roomData
	}

	roomData[userID] = batch
	c.hub.mu.Unlock()

	c.hub.broadcastRoomStats(roomID)
}

func (h *Hub) CleanupRoomStats(roomID string) {
	h.mu.Lock()
	delete(h.statsEnabledRooms, roomID)
	delete(h.statsRoomData, roomID)
	delete(h.statsAdminSubs, roomID)
	h.mu.Unlock()
	log.Printf("[Stats] Cleaned up stats data for room %s", roomID)
}

func (c *Client) handleRequestStatsState(data interface{}) {
	c.mu.RLock()
	roomID := c.roomID
	c.mu.RUnlock()
	if roomID == "" {
		return
	}

	if c.hub.IsStatsEnabled(roomID) {
		msg := models.WebSocketMessage{
			Type: "enable_stats_collection",
			Data: models.EnableStatsCommand{
				RoomID:     roomID,
				Action:     "enable",
				IntervalMs: defaultStatsIntervalMs,
			},
		}
		c.send <- marshalMessage(msg)
	}
}
