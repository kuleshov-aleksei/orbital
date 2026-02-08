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
	roomClients    map[string]map[*Client]bool   // room_id -> clients
	connectedUsers map[string]*models.PublicUser // userID -> PublicUser (for global user list)
	roomService    *service.RoomService
	authService    *service.AuthService
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
func NewHub(roomService *service.RoomService, authService *service.AuthService, cfg *config.Config) *Hub {
	hub := &Hub{
		clients:        make(map[*Client]bool),
		roomClients:    make(map[string]map[*Client]bool),
		connectedUsers: make(map[string]*models.PublicUser),
		roomService:    roomService,
		authService:    authService,
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
	var authenticatedUser *models.PublicUser
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

			// Prepare user data for later broadcast
			authenticatedUser = &models.PublicUser{
				ID:        claims.UserID,
				Nickname:  claims.Nickname,
				AvatarURL: claims.AvatarURL,
				Role:      claims.Role,
			}
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

	// Now that client is registered, broadcast if authenticated and send initial data
	if authenticatedUser != nil {
		// Broadcast user joined to all clients (including this one)
		h.AddConnectedUser(client.userID, authenticatedUser)

		// Send initial user list to the newly connected client
		userListMessage := models.WebSocketMessage{
			Type: models.MessageTypeUserList,
			Data: h.GetConnectedUsers(),
		}
		select {
		case client.send <- marshalMessage(userListMessage):
			log.Printf("Sent user list to newly connected client %s", client.userID)
		default:
			log.Printf("Failed to send user list to client %s", client.userID)
		}
	}

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

// AddConnectedUser adds a user to the global connected users map
func (h *Hub) AddConnectedUser(userID string, user *models.PublicUser) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Check if user is already connected (reconnection scenario)
	wasAlreadyConnected := h.connectedUsers[userID] != nil

	// Mark user as online
	user.IsOnline = true
	h.connectedUsers[userID] = user

	if !wasAlreadyConnected {
		// Broadcast user joined to all clients
		joinMessage := models.WebSocketMessage{
			Type: models.MessageTypeUserJoined,
			Data: user,
		}
		h.broadcastToAllInternal(joinMessage)
		log.Printf("User %s (%s) connected to platform", user.Nickname, userID)
	}
}

// RemoveConnectedUser removes a user from the global connected users map
func (h *Hub) RemoveConnectedUser(userID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if user, exists := h.connectedUsers[userID]; exists {
		delete(h.connectedUsers, userID)

		// Mark user as offline and broadcast to all clients
		user.IsOnline = false
		leaveMessage := models.WebSocketMessage{
			Type: models.MessageTypeUserLeft,
			Data: user,
		}
		h.broadcastToAllInternal(leaveMessage)
		log.Printf("User %s (%s) disconnected from platform", user.Nickname, userID)
	}
}

// BroadcastUserUpdate broadcasts a user update to all connected clients
func (h *Hub) BroadcastUserUpdate(user *models.PublicUser) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Update user in connected users map if present
	if existingUser, exists := h.connectedUsers[user.ID]; exists {
		existingUser.Nickname = user.Nickname
		existingUser.AvatarURL = user.AvatarURL
		existingUser.Role = user.Role
	}

	// Broadcast update to all clients
	updateMessage := models.WebSocketMessage{
		Type: models.MessageTypeUserUpdate,
		Data: user,
	}
	h.broadcastToAllInternal(updateMessage)
}

// GetConnectedUsers returns a list of all currently connected users
func (h *Hub) GetConnectedUsers() []*models.PublicUser {
	h.mu.RLock()
	defer h.mu.RUnlock()

	users := make([]*models.PublicUser, 0, len(h.connectedUsers))
	for _, user := range h.connectedUsers {
		// Ensure IsOnline is set to true for all connected users
		user.IsOnline = true
		users = append(users, user)
	}
	return users
}

// broadcastToAllInternal sends a message to all clients (internal use, caller must hold lock)
func (h *Hub) broadcastToAllInternal(message interface{}) {
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
			if h.roomClients[client.roomID] != nil {
				delete(h.roomClients[client.roomID], client)
			}
		}
	}
}

// readPump handles messages from the WebSocket connection
func (c *Client) readPump() {
	defer func() {
		// Get userID before cleaning up
		c.mu.RLock()
		userID := c.userID
		c.mu.RUnlock()

		// Remove from hub's client maps, but DO NOT clean up room state
		// Room cleanup only happens on ping timeout, allowing time for reconnection
		c.hub.mu.Lock()
		delete(c.hub.clients, c)
		if c.hub.roomClients[c.roomID] != nil {
			delete(c.hub.roomClients[c.roomID], c)
		}
		c.hub.mu.Unlock()

		// Remove user from global connected users
		if userID != "" {
			c.hub.RemoveConnectedUser(userID)
		}

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
	case "nickname_change":
		c.handleNicknameChange(message.Data)
	case "screen_share_start":
		c.handleScreenShareStart(message.Data)
	case "screen_share_stop":
		c.handleScreenShareStop(message.Data)
	case "ping":
		c.handlePing(message.Data)
	case "reconnect_request":
		c.handleReconnectRequest(message.Data)
	case "reconnect_ready":
		c.handleReconnectReady(message.Data)
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

// handleReconnectRequest handles reconnection handshake step 1/3
func (c *Client) handleReconnectRequest(data interface{}) {
	var requestData map[string]interface{}
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &requestData)

	if targetUserID, ok := requestData["target_user_id"].(string); ok && targetUserID != "" {
		log.Printf("Reconnection request from %s to %s", c.userID, targetUserID)
		requestMessage := models.WebSocketMessage{
			Type: "reconnect_request",
			Data: data,
		}
		c.hub.SendToUser(c.roomID, targetUserID, requestMessage)
	}
}

// handleReconnectReady handles reconnection handshake step 2/3
func (c *Client) handleReconnectReady(data interface{}) {
	var readyData map[string]interface{}
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &readyData)

	if targetUserID, ok := readyData["target_user_id"].(string); ok && targetUserID != "" {
		log.Printf("Reconnection ready from %s to %s", c.userID, targetUserID)
		readyMessage := models.WebSocketMessage{
			Type: "reconnect_ready",
			Data: data,
		}
		c.hub.SendToUser(c.roomID, targetUserID, readyMessage)
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

	// Update and broadcast user data change for global user list
	c.mu.RLock()
	userID := c.userID
	c.mu.RUnlock()

	// Get current user data from connected users
	c.hub.mu.RLock()
	if user, exists := c.hub.connectedUsers[userID]; exists {
		user.Nickname = req.Nickname
		// Create a copy to broadcast
		updatedUser := &models.PublicUser{
			ID:        user.ID,
			Nickname:  user.Nickname,
			AvatarURL: user.AvatarURL,
			Role:      user.Role,
		}
		c.hub.mu.RUnlock()
		c.hub.BroadcastUserUpdate(updatedUser)
	} else {
		c.hub.mu.RUnlock()
	}
}

// handleScreenShareStart handles screen sharing start notifications
func (c *Client) handleScreenShareStart(data interface{}) {
	var shareData struct {
		UserID   string `json:"user_id"`
		Quality  string `json:"quality"`
		HasAudio bool   `json:"has_audio"`
	}
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &shareData)

	// Validate that the user is only reporting their own screen share
	if shareData.UserID != c.userID {
		log.Printf("User %s attempted to report screen share for user %s", c.userID, shareData.UserID)
		return
	}

	// Update screen sharing state in room service
	c.hub.roomService.UpdateUserScreenShareStatus(c.roomID, c.userID, true, shareData.Quality)

	log.Printf("User %s started screen sharing (quality: %s, audio: %v)", c.userID, shareData.Quality, shareData.HasAudio)

	// Broadcast screen share start to all other users in room
	shareMessage := models.WebSocketMessage{
		Type: "screen_share_start",
		Data: map[string]interface{}{
			"user_id":   c.userID,
			"quality":   shareData.Quality,
			"has_audio": shareData.HasAudio,
		},
	}
	c.hub.BroadcastToRoomExcluding(c.roomID, c, shareMessage)

	// Also broadcast globally so users outside room can see status in room list
	c.hub.BroadcastToAll(shareMessage)
}

// handleScreenShareStop handles screen sharing stop notifications
func (c *Client) handleScreenShareStop(data interface{}) {
	var stopData struct {
		UserID string `json:"user_id"`
	}
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &stopData)

	// Validate that the user is only stopping their own screen share
	if stopData.UserID != c.userID {
		log.Printf("User %s attempted to stop screen share for user %s", c.userID, stopData.UserID)
		return
	}

	// Update screen sharing state in room service
	c.hub.roomService.UpdateUserScreenShareStatus(c.roomID, c.userID, false, "")

	log.Printf("User %s stopped screen sharing", c.userID)

	// Broadcast screen share stop to all other users in room
	stopMessage := models.WebSocketMessage{
		Type: "screen_share_stop",
		Data: map[string]interface{}{
			"user_id": c.userID,
		},
	}
	c.hub.BroadcastToRoomExcluding(c.roomID, c, stopMessage)

	// Also broadcast globally so users outside room can see status in room list
	c.hub.BroadcastToAll(stopMessage)
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
func (h *Hub) startPingMonitor() {
	// Safety check for config
	if h.cfg == nil {
		log.Printf("ERROR: Ping monitor cannot start - config is nil")
		return
	}

	log.Printf("Starting ping monitor (timeout: %v, check interval: %v)",
		h.cfg.WebSocket.PingTimeout, h.cfg.WebSocket.PingCheckInterval)

	ticker := time.NewTicker(h.cfg.WebSocket.PingCheckInterval)
	defer ticker.Stop()

	for range ticker.C {
		h.checkPingTimeouts()
	}
}

// checkPingTimeouts checks all room members for ping timeouts and removes timed-out users
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

	// Remove each timed-out user
	for _, user := range timedOutUsers {
		log.Printf("Ping timeout for user %s in room %s - removing from room", user.UserID, user.RoomID)
		h.disconnectUserDueToTimeout(user.RoomID, user.UserID)
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

	log.Printf("User %s successfully removed from room %s due to ping timeout", userID, roomID)
}
