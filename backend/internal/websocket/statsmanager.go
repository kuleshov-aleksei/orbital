package websocket

import (
	"encoding/json"
	"log"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
)

const (
	maxStatsHistoryPerUser = 20
	defaultStatsIntervalMs = 15000
)

type roomParticipantStats struct {
	lastReport models.ClientStatsReport
	history    []models.ClientStatsReport
}

func (h *Hub) EnableStatsCollection(roomID string) {
	h.mu.Lock()
	h.statsEnabledRooms[roomID] = true
	if h.statsRoomData[roomID] == nil {
		h.statsRoomData[roomID] = make(map[string]*roomParticipantStats)
	}
	h.mu.Unlock()

	log.Printf("[Stats] Stats collection enabled for room %s", roomID)

	h.BroadcastToRoom(roomID, models.WebSocketMessage{
		Type: "enable_stats_collection",
		Data: models.StatsControlCommand{
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
		Data: models.StatsControlCommand{
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
		log.Printf("[Stats] No WebSocket client found for user %s to subscribe to room %s", userID, roomID)
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

	participants := make(map[string]models.ParticipantStatsData, len(roomData))
	for userID, ps := range roomData {
		participants[userID] = models.ParticipantStatsData{
			LastReport: ps.lastReport,
			History:    ps.history,
		}
	}
	h.mu.RUnlock()

	msg := models.WebSocketMessage{
		Type: "room_stats",
		Data: models.RoomStatsMessage{
			RoomID:       roomID,
			Participants: participants,
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

	participants := make(map[string]models.ParticipantStatsData, len(roomData))
	for userID, ps := range roomData {
		participants[userID] = models.ParticipantStatsData{
			LastReport: ps.lastReport,
			History:    ps.history,
		}
	}

	// Build a copy of subscriber list under lock
	subList := make([]*Client, 0, len(subs))
	for client := range subs {
		subList = append(subList, client)
	}
	h.mu.RUnlock()

	msg := models.WebSocketMessage{
		Type: "room_stats",
		Data: models.RoomStatsMessage{
			RoomID:       roomID,
			Participants: participants,
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

func (c *Client) handleClientStats(data interface{}) {
	var report models.ClientStatsReport
	jsonData, _ := json.Marshal(data)
	if err := json.Unmarshal(jsonData, &report); err != nil {
		log.Printf("[Stats] Failed to unmarshal client stats: %v", err)
		return
	}

	c.mu.RLock()
	userID := c.userID
	roomID := c.roomID
	c.mu.RUnlock()

	if report.RoomID != roomID || report.UserID != userID {
		log.Printf("[Stats] Stats report room/user mismatch: client=%s/%s, report=%s/%s",
			roomID, userID, report.RoomID, report.UserID)
		return
	}

	if !c.hub.IsStatsEnabled(roomID) {
		return
	}

	report.Timestamp = time.Now().UnixMilli()

	c.hub.mu.Lock()
	roomData, ok := c.hub.statsRoomData[roomID]
	if !ok {
		roomData = make(map[string]*roomParticipantStats)
		c.hub.statsRoomData[roomID] = roomData
	}

	ps, exists := roomData[userID]
	if !exists {
		ps = &roomParticipantStats{}
		roomData[userID] = ps
	}

	ps.lastReport = report
	ps.history = append(ps.history, report)
	if len(ps.history) > maxStatsHistoryPerUser {
		ps.history = ps.history[len(ps.history)-maxStatsHistoryPerUser:]
	}
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
