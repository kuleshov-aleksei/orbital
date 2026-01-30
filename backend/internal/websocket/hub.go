package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/orbital/internal/models"
	"github.com/orbital/internal/service"
)

// Hub manages WebSocket connections
type Hub struct {
	clients     map[*Client]bool
	roomClients map[string]map[*Client]bool // room_id -> clients
	roomService *service.RoomService
	upgrader    websocket.Upgrader
	mu          sync.RWMutex
}

// Client represents a WebSocket client
type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	roomID string
	userID string
}

// NewHub creates a new WebSocket hub
func NewHub(roomService *service.RoomService) *Hub {
	return &Hub{
		clients:     make(map[*Client]bool),
		roomClients: make(map[string]map[*Client]bool),
		roomService: roomService,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for development
			},
		},
	}
}

// HandleWebSocket handles WebSocket connections
func (h *Hub) HandleWebSocket(roomID string, w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := &Client{
		hub:    h,
		conn:   conn,
		send:   make(chan []byte, 256),
		roomID: roomID,
	}

	h.mu.Lock()
	h.clients[client] = true

	// Only add to roomClients if roomID is provided (not empty)
	if roomID != "" {
		if h.roomClients[roomID] == nil {
			h.roomClients[roomID] = make(map[*Client]bool)
		}
		h.roomClients[roomID][client] = true
	}
	h.mu.Unlock()

	// Start goroutines for this client
	go client.writePump()
	go client.readPump()

	if roomID != "" {
		log.Printf("WebSocket client connected to room %s", roomID)
	} else {
		log.Printf("WebSocket client connected for global broadcasts")
	}
}

// HandleGlobalWebSocket handles WebSocket connections for global broadcasts (not room-specific)
func (h *Hub) HandleGlobalWebSocket(w http.ResponseWriter, r *http.Request) {
	h.HandleWebSocket("", w, r)
}

// BroadcastToRoom sends a message to all clients in a room
func (h *Hub) BroadcastToRoom(roomID string, message interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if clients, exists := h.roomClients[roomID]; exists {
		data, err := json.Marshal(message)
		if err != nil {
			log.Printf("Error marshaling message: %v", err)
			return
		}

		for client := range clients {
			if client == nil {
				continue
			}
			select {
			case client.send <- data:
			default:
				close(client.send)
				delete(h.clients, client)
				delete(h.roomClients[roomID], client)
			}
		}
	}
}

// BroadcastToAll sends a message to all connected clients
func (h *Hub) BroadcastToAll(message interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	data, err := json.Marshal(message)
	if err != nil {
		log.Printf("Error marshaling message: %v", err)
		return
	}

	for client := range h.clients {
		select {
		case client.send <- data:
		default:
			close(client.send)
			delete(h.clients, client)
			// Remove from room clients if present
			if h.roomClients[client.roomID] != nil {
				delete(h.roomClients[client.roomID], client)
			}
		}
	}
}

// BroadcastToRoomExcluding sends a message to all clients in a room except the specified client
func (h *Hub) BroadcastToRoomExcluding(roomID string, excludeClient *Client, message interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if clients, exists := h.roomClients[roomID]; exists {
		data, err := json.Marshal(message)
		if err != nil {
			log.Printf("Error marshaling message: %v", err)
			return
		}

		for client := range clients {
			if client != excludeClient {
				select {
				case client.send <- data:
				default:
					close(client.send)
					delete(h.clients, client)
					delete(h.roomClients[roomID], client)
				}
			}
		}
	}
}

// SendToUser sends a message to a specific user in a room
func (h *Hub) SendToUser(roomID string, userID string, message interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if clients, exists := h.roomClients[roomID]; exists {
		data, err := json.Marshal(message)
		if err != nil {
			log.Printf("Error marshaling message: %v", err)
			return
		}

		// Find the specific client by userID
		log.Printf("SendToUser: looking for user %s in room %s with %d clients", userID, roomID, len(clients))
		for client := range clients {
			log.Printf("SendToUser: checking client with userID '%s'", client.userID)
			if client.userID == userID {
				select {
				case client.send <- data:
					log.Printf("Message sent to user %s in room %s", userID, roomID)
				default:
					log.Printf("Failed to send message to user %s: channel blocked", userID)
				}
				return
			}
		}
		log.Printf("User %s not found in room %s", userID, roomID)
	}
}

// readPump handles messages from the WebSocket connection
func (c *Client) readPump() {
	defer func() {
		c.hub.mu.Lock()
		delete(c.hub.clients, c)
		if c.hub.roomClients[c.roomID] != nil {
			delete(c.hub.roomClients[c.roomID], c)
		}
		c.hub.mu.Unlock()
		c.conn.Close()
	}()

	for {
		var message models.WebSocketMessage
		err := c.conn.ReadJSON(&message)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		c.handleMessage(message)
	}
}

// writePump handles sending messages to the WebSocket connection
func (c *Client) writePump() {
	defer c.conn.Close()

	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			err := c.conn.WriteMessage(websocket.TextMessage, message)
			if err != nil {
				log.Printf("WebSocket write error: %v", err)
				return
			}
		}
	}
}

// handleMessage processes incoming WebSocket messages
func (c *Client) handleMessage(message models.WebSocketMessage) {
	switch message.Type {
	case "join_room":
		c.handleJoinRoom(message.Data)
	case "leave_room":
		c.handleLeaveRoom(message.Data)
	case "ice_candidate":
		c.handleICECandidate(message.Data)
	case "sdp_offer":
		c.handleSDPOffer(message.Data)
	case "sdp_answer":
		c.handleSDPAnswer(message.Data)
	case "speaking_status":
		c.handleSpeakingStatus(message.Data)
	case "mute_status":
		c.handleMuteStatus(message.Data)
	case "deafen_status":
		c.handleDeafenStatus(message.Data)
	case "room_created":
		// This is a broadcast message, no action needed on receive
		log.Printf("Received room_created broadcast")
	default:
		log.Printf("Unknown message type: %s", message.Type)
	}
}

// handleJoinRoom handles user joining a room
func (c *Client) handleJoinRoom(data interface{}) {
	var req models.JoinRoomRequest
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &req)

	c.userID = req.UserID
	_, _, err := c.hub.roomService.JoinRoom(c.roomID, req.UserID, req.Nickname)
	if err != nil {
		log.Printf("Error joining room: %v", err)
		return
	}

	// Send current room users to the joining user
	users := c.hub.roomService.GetRoomUsers(c.roomID)
	response := models.WebSocketMessage{
		Type: "room_users",
		Data: users,
	}
	c.send <- marshalMessage(response)

	// Broadcast updated user list to all users in room (including new user)
	usersUpdate := models.WebSocketMessage{
		Type: "room_users",
		Data: users,
	}
	c.hub.BroadcastToRoom(c.roomID, usersUpdate)
}

// handleLeaveRoom handles user leaving a room
func (c *Client) handleLeaveRoom(data interface{}) {
	c.hub.roomService.LeaveRoom(c.roomID, c.userID)

	// Broadcast user left message
	leaveMessage := models.WebSocketMessage{
		Type: "user_left",
		Data: map[string]string{"user_id": c.userID},
	}
	c.hub.BroadcastToRoom(c.roomID, leaveMessage)

	// Broadcast updated user list to all remaining users
	users := c.hub.roomService.GetRoomUsers(c.roomID)
	usersUpdate := models.WebSocketMessage{
		Type: "room_users",
		Data: users,
	}
	c.hub.BroadcastToRoom(c.roomID, usersUpdate)
}

// handleICECandidate handles WebRTC ICE candidates
func (c *Client) handleICECandidate(data interface{}) {
	// Parse the data to extract target user if available
	var candidateData map[string]interface{}
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &candidateData)

	if targetUserID, ok := candidateData["target_user_id"].(string); ok && targetUserID != "" {
		// Send to specific user
		candidateMessage := models.WebSocketMessage{
			Type: "ice_candidate",
			Data: data,
		}
		c.hub.SendToUser(c.roomID, targetUserID, candidateMessage)
	} else {
		// Broadcast to all users (legacy behavior)
		candidateMessage := models.WebSocketMessage{
			Type: "ice_candidate",
			Data: data,
		}
		c.hub.BroadcastToRoom(c.roomID, candidateMessage)
	}
}

// handleSDPOffer handles WebRTC SDP offers
func (c *Client) handleSDPOffer(data interface{}) {
	// Parse the data to extract target user if available
	var offerData map[string]interface{}
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &offerData)

	if targetUserID, ok := offerData["target_user_id"].(string); ok && targetUserID != "" {
		// Send to specific user
		offerMessage := models.WebSocketMessage{
			Type: "sdp_offer",
			Data: data,
		}
		c.hub.SendToUser(c.roomID, targetUserID, offerMessage)
	} else {
		// Broadcast to all users (legacy behavior)
		offerMessage := models.WebSocketMessage{
			Type: "sdp_offer",
			Data: data,
		}
		c.hub.BroadcastToRoom(c.roomID, offerMessage)
	}
}

// handleSDPAnswer handles WebRTC SDP answers
func (c *Client) handleSDPAnswer(data interface{}) {
	// Parse the data to extract target user if available
	var answerData map[string]interface{}
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &answerData)

	if targetUserID, ok := answerData["target_user_id"].(string); ok && targetUserID != "" {
		// Send to specific user
		answerMessage := models.WebSocketMessage{
			Type: "sdp_answer",
			Data: data,
		}
		c.hub.SendToUser(c.roomID, targetUserID, answerMessage)
	} else {
		// Broadcast to all users (legacy behavior)
		answerMessage := models.WebSocketMessage{
			Type: "sdp_answer",
			Data: data,
		}
		c.hub.BroadcastToRoom(c.roomID, answerMessage)
	}
}

// handleSpeakingStatus handles user speaking status updates
func (c *Client) handleSpeakingStatus(data interface{}) {
	var statusData struct {
		IsSpeaking bool `json:"is_speaking"`
		IsMuted    bool `json:"is_muted"`
	}
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &statusData)

	c.hub.roomService.UpdateUserSpeakingStatus(c.roomID, c.userID, statusData.IsSpeaking)

	// Broadcast speaking status to other users in room
	statusMessage := models.WebSocketMessage{
		Type: "speaking_status",
		Data: map[string]interface{}{
			"user_id":     c.userID,
			"is_speaking": statusData.IsSpeaking,
			"is_muted":    statusData.IsMuted,
		},
	}
	c.hub.BroadcastToRoomExcluding(c.roomID, c, statusMessage)

	// Also broadcast globally so users outside room can see status in room list
	c.hub.BroadcastToAll(statusMessage)
}

// handleMuteStatus handles user mute status updates
func (c *Client) handleMuteStatus(data interface{}) {
	var statusData struct {
		IsMuted bool `json:"is_muted"`
	}
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &statusData)

	c.hub.roomService.UpdateUserMuteStatus(c.roomID, c.userID, statusData.IsMuted)

	// Broadcast mute status to other users in room (excluding sender)
	statusMessage := models.WebSocketMessage{
		Type: "mute_status",
		Data: map[string]interface{}{
			"user_id":  c.userID,
			"is_muted": statusData.IsMuted,
		},
	}
	c.hub.BroadcastToRoomExcluding(c.roomID, c, statusMessage)

	// Also broadcast globally so users outside room can see status in room list
	c.hub.BroadcastToAll(statusMessage)
}

// handleDeafenStatus handles user deafen status updates
func (c *Client) handleDeafenStatus(data interface{}) {
	var statusData struct {
		IsDeafened bool `json:"is_deafened"`
	}
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &statusData)

	c.hub.roomService.UpdateUserDeafenStatus(c.roomID, c.userID, statusData.IsDeafened)

	// Broadcast deafen status to other users in room (excluding sender)
	statusMessage := models.WebSocketMessage{
		Type: "deafen_status",
		Data: map[string]interface{}{
			"user_id":     c.userID,
			"is_deafened": statusData.IsDeafened,
		},
	}
	c.hub.BroadcastToRoomExcluding(c.roomID, c, statusMessage)

	// Also broadcast globally so users outside room can see status in room list
	c.hub.BroadcastToAll(statusMessage)
}

// Helper function to marshal messages
func marshalMessage(message interface{}) []byte {
	data, _ := json.Marshal(message)
	return data
}
