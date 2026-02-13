package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// Hub manages WebSocket connections
type Hub struct {
	clients        map[*Client]bool
	roomClients    map[string]map[*Client]bool // room_id -> clients
	roomService    *service.RoomService
	authService    *service.AuthService
	livekitService *service.LiveKitService
	cfg            *config.Config
	upgrader       websocket.Upgrader
	mu             sync.RWMutex
}

// Client represents a WebSocket client
type Client struct {
	hub          *Hub
	conn         *websocket.Conn
	send         chan []byte
	roomID       string
	userID       string
	lastPingTime time.Time
	mu           sync.RWMutex
}

// NewHub creates a new WebSocket hub
func NewHub(roomService *service.RoomService, authService *service.AuthService, livekitService *service.LiveKitService, cfg *config.Config) *Hub {
	hub := &Hub{
		clients:        make(map[*Client]bool),
		roomClients:    make(map[string]map[*Client]bool),
		roomService:    roomService,
		authService:    authService,
		livekitService: livekitService,
		cfg:            cfg,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for development
			},
		},
	}

	// Start the ping monitor goroutine
	go hub.startPingMonitor()

	return hub
}

// HandleWebSocket handles WebSocket connections
func (h *Hub) HandleWebSocket(roomID string, w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	client := &Client{
		hub:          h,
		conn:         conn,
		send:         make(chan []byte, 256),
		roomID:       roomID,
		lastPingTime: time.Now(),
	}

	// Extract and validate JWT token if auth service is available
	if h.authService != nil {
		token := r.URL.Query().Get("token")
		if token != "" {
			claims, err := h.authService.ValidateJWT(token)
			if err != nil {
				log.Printf("WebSocket token validation failed: %v", err)
				conn.Close()
				return
			}
			client.mu.Lock()
			client.userID = claims.UserID
			client.mu.Unlock()
			log.Printf("WebSocket client authenticated with userID: %s", claims.UserID)
		}
	}

	// Add client to the clients map FIRST (before broadcasting)
	// This ensures the client will receive broadcasts
	h.mu.Lock()
	h.clients[client] = true

	// Only add to roomClients if roomID is provided (not empty)
	if roomID != "" {
		if h.roomClients[roomID] == nil {
			h.roomClients[roomID] = make(map[*Client]bool)
		}
		h.roomClients[roomID][client] = true
		client.mu.RLock()
		userID := client.userID
		client.mu.RUnlock()
		log.Printf("WebSocket client connected to room %s (user: %s, total clients: %d)", roomID, userID, len(h.clients))
	} else {
		client.mu.RLock()
		userID := client.userID
		client.mu.RUnlock()
		log.Printf("WebSocket client connected for global broadcasts (user: %s, total clients: %d)", userID, len(h.clients))
	}
	h.mu.Unlock()

	// Start goroutines for this client
	go client.writePump()
	go client.readPump()
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
		// Remove from hub's client maps, but DO NOT clean up room state
		// Room cleanup only happens on ping timeout, allowing time for reconnection
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
	case "nickname_change":
		c.handleNicknameChange(message.Data)
	case "ping":
		c.handlePing(message.Data)
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

	c.mu.Lock()
	c.userID = req.UserID
	c.lastPingTime = time.Now() // Reset ping time on join to prevent immediate timeout
	c.mu.Unlock()

	// Create LiveKit room if LiveKit service is available
	// This is idempotent - safe to call multiple times
	if c.hub.livekitService != nil && c.hub.livekitService.IsHealthy() {
		// Get room info to determine max participants
		room, exists := c.hub.roomService.GetRoom(c.roomID)
		maxParticipants := 10 // Default fallback
		if exists {
			maxParticipants = room.MaxUsers
		}

		_, err := c.hub.livekitService.CreateRoom(c.roomID, maxParticipants)
		if err != nil {
			// Log error but don't fail the join - room might already exist
			log.Printf("[Hub] LiveKit CreateRoom error (may already exist): %v", err)
		} else {
			log.Printf("[Hub] LiveKit room created/verified for room %s (max participants: %d)", c.roomID, maxParticipants)
		}
	}

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
	c.mu.RLock()
	userID := c.userID
	roomID := c.roomID
	c.mu.RUnlock()

	c.hub.roomService.LeaveRoom(roomID, userID)

	// Broadcast user left message
	leaveMessage := models.WebSocketMessage{
		Type: "user_left",
		Data: map[string]string{"user_id": userID},
	}
	c.hub.BroadcastToRoom(roomID, leaveMessage)

	// Broadcast updated user list to all remaining users
	users := c.hub.roomService.GetRoomUsers(roomID)
	usersUpdate := models.WebSocketMessage{
		Type: "room_users",
		Data: users,
	}
	c.hub.BroadcastToRoom(roomID, usersUpdate)

	// Check if room is now empty and clean up LiveKit room
	if len(users) == 0 {
		c.hub.cleanupLiveKitRoom(roomID)
	}
}

// cleanupLiveKitRoom deletes the LiveKit room when the last user leaves
func (h *Hub) cleanupLiveKitRoom(roomID string) {
	if h.livekitService != nil && h.livekitService.IsHealthy() {
		err := h.livekitService.DeleteRoom(roomID)
		if err != nil {
			// Log error but don't fail - room might already be deleted
			log.Printf("[Hub] LiveKit DeleteRoom error (may already be deleted): %v", err)
		} else {
			log.Printf("[Hub] LiveKit room deleted: %s", roomID)
		}
	}
}

// handleNicknameChange handles user nickname changes
func (c *Client) handleNicknameChange(data interface{}) {
	var req models.NicknameChangeRequest
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &req)

	// Only allow users to change their own nickname
	if req.UserID != c.userID {
		log.Printf("User %s attempted to change nickname for user %s", c.userID, req.UserID)
		return
	}

	// Update nickname in room service
	err := c.hub.roomService.UpdateUserNickname(c.roomID, req.UserID, req.Nickname)
	if err != nil {
		log.Printf("Error updating nickname: %v", err)
		return
	}

	// Broadcast nickname change to all users in room
	nicknameMessage := models.WebSocketMessage{
		Type: "nickname_change",
		Data: map[string]interface{}{
			"user_id":  req.UserID,
			"nickname": req.Nickname,
		},
	}
	c.hub.BroadcastToRoom(c.roomID, nicknameMessage)

	// Also broadcast globally so users outside room can see updated nickname
	c.hub.BroadcastToAll(nicknameMessage)
}

// handlePing handles ping messages and responds with pong
func (c *Client) handlePing(data interface{}) {
	var pingData struct {
		UserID    string `json:"user_id"`
		Timestamp int64  `json:"timestamp"`
	}
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &pingData)

	// Update last ping time
	c.mu.Lock()
	c.lastPingTime = time.Now()
	userID := c.userID
	roomID := c.roomID
	c.mu.Unlock()

	// Update ping time in room service (this is what actually matters for timeout detection)
	if roomID != "" && userID != "" {
		c.hub.roomService.UpdateUserPingTime(roomID, userID)
	}

	// Send pong response back to the client with the same timestamp
	pongMessage := models.WebSocketMessage{
		Type: "pong",
		Data: map[string]interface{}{
			"timestamp": pingData.Timestamp,
		},
	}
	c.send <- marshalMessage(pongMessage)
}

// Helper function to marshal messages
func marshalMessage(message interface{}) []byte {
	data, _ := json.Marshal(message)
	return data
}

// startPingMonitor periodically checks for clients that haven't sent pings within the timeout period
// and broadcasts user list every 30 seconds
func (h *Hub) startPingMonitor() {
	// Safety check for config
	if h.cfg == nil {
		log.Printf("ERROR: Ping monitor cannot start - config is nil")
		return
	}

	log.Printf("Starting ping monitor (timeout: %v, check interval: %v)",
		h.cfg.WebSocket.PingTimeout, h.cfg.WebSocket.PingCheckInterval)

	checkTicker := time.NewTicker(h.cfg.WebSocket.PingCheckInterval)
	defer checkTicker.Stop()

	for {
		select {
		case <-checkTicker.C:
			h.checkPingTimeouts()
		}
	}
}

// checkPingTimeouts checks all room members and global clients for ping timeouts
func (h *Hub) checkPingTimeouts() {
	if h.cfg == nil {
		log.Printf("ERROR: checkPingTimeouts called with nil config")
		return
	}

	timeout := h.cfg.WebSocket.PingTimeout
	if timeout == 0 {
		log.Printf("ERROR: Ping timeout is 0, using default 30s")
		timeout = 30 * time.Second
	}

	// Check for timed-out users using room service (this tracks members, not just connected clients)
	timedOutUsers := h.roomService.CheckPingTimeouts(timeout)

	if len(timedOutUsers) > 0 {
		log.Printf("Ping monitor: found %d timed-out users (timeout: %v)", len(timedOutUsers), timeout)
	}

	// Remove each timed-out user from rooms
	for _, user := range timedOutUsers {
		log.Printf("Ping timeout for user %s in room %s - removing from room", user.UserID, user.RoomID)
		h.disconnectUserDueToTimeout(user.RoomID, user.UserID)
	}

	// Check global clients for ping timeouts (clients not in any room)
	h.checkGlobalPingTimeouts(timeout)
}

// checkGlobalPingTimeouts checks global WebSocket clients and removes timed-out users
func (h *Hub) checkGlobalPingTimeouts(timeout time.Duration) {
	h.mu.Lock()
	defer h.mu.Unlock()

	now := time.Now()
	timedOutClients := make([]*Client, 0)

	for client := range h.clients {
		client.mu.RLock()
		lastPing := client.lastPingTime
		userID := client.userID
		client.mu.RUnlock()

		// Skip clients without userID (not authenticated)
		if userID == "" {
			continue
		}

		// Check if client hasn't pinged within timeout
		if now.Sub(lastPing) > timeout {
			timedOutClients = append(timedOutClients, client)
		}
	}

	// Remove timed-out clients
	for _, client := range timedOutClients {
		// Clean up client connection
		close(client.send)
		delete(h.clients, client)
		if h.roomClients[client.roomID] != nil {
			delete(h.roomClients[client.roomID], client)
		}
		client.conn.Close()
	}
}

// disconnectUserDueToTimeout removes a user from a room due to ping timeout
func (h *Hub) disconnectUserDueToTimeout(roomID, userID string) {
	if userID == "" {
		log.Printf("WARNING: disconnectUserDueToTimeout called with empty userID for room %s", roomID)
		return
	}

	log.Printf("Disconnecting user %s from room %s due to ping timeout", userID, roomID)

	// Get user info before removing them from the room
	roomUsers := h.roomService.GetRoomUsers(roomID)
	var leftUser interface{}
	for _, u := range roomUsers {
		if u.ID == userID {
			leftUser = u
			break
		}
	}

	// Remove user from room service
	h.roomService.LeaveRoom(roomID, userID)

	// Broadcast user_left message globally
	leaveMessage := models.WebSocketMessage{
		Type: "user_left",
		Data: map[string]string{
			"user_id": userID,
			"room_id": roomID,
		},
	}
	h.BroadcastToAll(leaveMessage)

	// Broadcast room_user_left message globally (for room list updates)
	if leftUser != nil {
		roomUserLeftMessage := models.WebSocketMessage{
			Type: "room_user_left",
			Data: map[string]interface{}{
				"room_id": roomID,
				"user":    leftUser,
			},
		}
		h.BroadcastToAll(roomUserLeftMessage)
	}

	// Broadcast updated room users to the room
	users := h.roomService.GetRoomUsers(roomID)
	usersUpdate := models.WebSocketMessage{
		Type: "room_users",
		Data: users,
	}
	h.BroadcastToRoom(roomID, usersUpdate)

	// Check if room is now empty and clean up LiveKit room
	if len(users) == 0 {
		h.cleanupLiveKitRoom(roomID)
	}

	log.Printf("User %s successfully removed from room %s due to ping timeout", userID, roomID)
}
