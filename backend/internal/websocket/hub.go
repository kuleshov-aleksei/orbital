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
	clients         map[*Client]bool
	roomClients     map[string]map[*Client]bool                    // room_id -> clients
	onlineUsers     map[string]time.Time                            // user_id -> last_seen timestamp (global connections)
	userAudioState  map[string]map[string]models.UserAudioState     // user_id -> room_id -> audio state (mute/deafen)
	roomService     *service.RoomService
	authService     *service.AuthService
	livekitService  *service.LiveKitService
	chatService     *service.ChatService
	cfg             *config.Config
	upgrader        websocket.Upgrader
	mu              sync.RWMutex
}

// Client represents a WebSocket client
type Client struct {
	hub               *Hub
	conn              *websocket.Conn
	send              chan []byte
	roomID            string
	userID            string
	lastPingTime      time.Time
	firstPingReceived bool
	mu                sync.RWMutex
}

// NewHub creates a new WebSocket hub
func NewHub(roomService *service.RoomService, authService *service.AuthService, livekitService *service.LiveKitService, chatService *service.ChatService, cfg *config.Config) *Hub {
	hub := &Hub{
		clients:        make(map[*Client]bool),
		roomClients:    make(map[string]map[*Client]bool),
		onlineUsers:    make(map[string]time.Time),
		userAudioState: make(map[string]map[string]models.UserAudioState),
		roomService:    roomService,
		authService:    authService,
		livekitService: livekitService,
		chatService:    chatService,
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

	// Mark user as online if they have a valid userID
	client.mu.RLock()
	userID := client.userID
	client.mu.RUnlock()
	if userID != "" {
		h.UpdateUserPing(userID)
		log.Printf("[WebSocket] User %s marked as online", userID)

		// Broadcast user online status with full user data to all connected clients
		if h.authService != nil {
			user, err := h.authService.GetUserByID(userID)
			if err != nil {
				log.Printf("[WebSocket] Failed to get user %s for broadcast: %v", userID, err)
			} else if user == nil {
				log.Printf("[WebSocket] User %s not found in database", userID)
			} else {
				log.Printf("[WebSocket] Broadcasting user_online for %s (%s) to %d clients", userID, user.Nickname, len(h.clients))
				h.BroadcastToAll(models.WebSocketMessage{
					Type: "user_online",
					Data: models.PublicUser{
						ID:        user.ID,
						Nickname:  user.Nickname,
						AvatarURL: user.AvatarURL,
						Role:      user.Role,
						IsOnline:  true,
					},
				})
			}
		} else {
			log.Printf("[WebSocket] Cannot broadcast user_online: authService is nil")
		}
	} else {
		log.Printf("[WebSocket] Client connected without userID, waiting for authentication via ping")
	}

	// Start goroutines for this client FIRST so they can receive messages
	go client.writePump()
	go client.readPump()

	// Send initial online users list to the new client (after writePump starts)
	log.Printf("[WebSocket] HandleWebSocket: roomID=%q, userID=%q", roomID, userID)
	if roomID == "" && userID != "" {
		log.Printf("[WebSocket] Sending initial data to user %s (global ws)", userID)
		onlineUserIDs := h.GetOnlineUsers()
		log.Printf("[WebSocket] Preparing initial online_users list for %s: %d users online", userID, len(onlineUserIDs))

		// Fetch full user data for all online users
		var onlineUsers []models.PublicUser
		if h.authService != nil {
			for _, uid := range onlineUserIDs {
				user, err := h.authService.GetUserByID(uid)
				if err == nil && user != nil {
					onlineUsers = append(onlineUsers, models.PublicUser{
						ID:        user.ID,
						Nickname:  user.Nickname,
						AvatarURL: user.AvatarURL,
						Role:      user.Role,
						IsOnline:  true,
					})
				}
			}
		}

		initialOnlineMessage := models.WebSocketMessage{
			Type: "online_users",
			Data: map[string]interface{}{
				"users": onlineUsers,
			},
		}
		select {
		case client.send <- marshalMessage(initialOnlineMessage):
			log.Printf("[WebSocket] Sent initial online_users list to user %s (%d users)", userID, len(onlineUsers))
		default:
			log.Printf("[WebSocket] Failed to send initial online_users list to user %s: channel blocked", userID)
		}
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
	clientCount := len(h.clients)
	h.mu.RUnlock()

	data, err := json.Marshal(message)
	if err != nil {
		log.Printf("[WebSocket] Error marshaling message: %v", err)
		return
	}

	log.Printf("[WebSocket] Broadcasting message to %d clients", clientCount)

	h.mu.RLock()
	defer h.mu.RUnlock()

	successCount := 0
	failCount := 0
	for client := range h.clients {
		select {
		case client.send <- data:
			successCount++
		default:
			failCount++
			close(client.send)
			delete(h.clients, client)
			// Remove from room clients if present
			if h.roomClients[client.roomID] != nil {
				delete(h.roomClients[client.roomID], client)
			}
		}
	}

	if failCount > 0 {
		log.Printf("[WebSocket] Broadcast complete: %d sent, %d failed (channel blocked)", successCount, failCount)
	} else {
		log.Printf("[WebSocket] Broadcast complete: %d sent successfully", successCount)
	}
}

// BroadcastSoundPackChange broadcasts a user's sound pack change to all connected clients
func (h *Hub) BroadcastSoundPackChange(userID string, soundPack string) {
	message := models.WebSocketMessage{
		Type: "sound_pack_change",
		Data: map[string]string{
			"user_id":    userID,
			"sound_pack": soundPack,
		},
	}
	h.BroadcastToAll(message)
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

// UpdateUserPing updates a user's last seen timestamp (called on ping)
func (h *Hub) UpdateUserPing(userID string) {
	if userID == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	wasOnline := h.isUserOnlineLocked(userID)
	h.onlineUsers[userID] = time.Now()
	if !wasOnline {
		log.Printf("User %s is now online (total online: %d)", userID, len(h.onlineUsers))
	}
}

// isUserOnlineLocked checks if a user is online (must be called with lock held)
func (h *Hub) isUserOnlineLocked(userID string) bool {
	lastSeen, exists := h.onlineUsers[userID]
	if !exists {
		return false
	}
	// Consider user online if they've pinged within the last 30 seconds
	return time.Since(lastSeen) < 30*time.Second
}

// RemoveOnlineUser marks a user as offline (when they disconnect and have no other connections)
func (h *Hub) RemoveOnlineUser(userID string) {
	if userID == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()

	// Check if user has any other active connections
	connectionCount := 0
	for client := range h.clients {
		if client.userID == userID {
			connectionCount++
		}
	}

	// Check if user has pinged recently (within 30 seconds)
	// This handles the case where another connection exists but hasn't been authenticated yet
	lastSeen, hasLastSeen := h.onlineUsers[userID]
	hasRecentPing := hasLastSeen && time.Since(lastSeen) < 30*time.Second

	if connectionCount == 0 && !hasRecentPing {
		delete(h.onlineUsers, userID)
		log.Printf("User %s is now offline (no connections, total online: %d)", userID, len(h.onlineUsers))
	} else if connectionCount > 0 {
		log.Printf("User %s still has %d connection(s), keeping online status", userID, connectionCount)
	} else if hasRecentPing {
		log.Printf("User %s has recent ping, keeping online status", userID)
	}
}

// IsUserOnline checks if a user is currently online (within last 60 seconds)
func (h *Hub) IsUserOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.isUserOnlineLocked(userID)
}

// GetOnlineUsers returns a list of all online user IDs (pinged within last 30 seconds)
func (h *Hub) GetOnlineUsers() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	users := make([]string, 0, len(h.onlineUsers))
	for userID := range h.onlineUsers {
		if h.isUserOnlineLocked(userID) {
			users = append(users, userID)
		}
	}
	return users
}

// sendAudioStatesToClient sends all current audio states to a client
func (h *Hub) sendAudioStatesToClient(client *Client) {
	h.mu.RLock()
	audioStates := make([]models.UserAudioState, 0)
	for _, roomStates := range h.userAudioState {
		for _, state := range roomStates {
			audioStates = append(audioStates, state)
		}
	}
	h.mu.RUnlock()

	log.Printf("[WebSocket] sendAudioStatesToClient: userID=%q, states_count=%d", client.userID, len(audioStates))

	message := models.WebSocketMessage{
		Type: "audio_states",
		Data: map[string]interface{}{
			"states": audioStates,
		},
	}
	select {
	case client.send <- marshalMessage(message):
		log.Printf("[WebSocket] Sent %d audio states to user %s", len(audioStates), client.userID)
	default:
		log.Printf("[WebSocket] Failed to send audio states to user %s: channel blocked", client.userID)
	}
}

// readPump handles messages from the WebSocket connection
func (c *Client) readPump() {
	defer func() {
		// Get userID before removing from maps
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

		// Mark user as offline if they have no other connections
		if userID != "" {
			wasOnline := c.hub.IsUserOnline(userID)
			c.hub.RemoveOnlineUser(userID)
			isStillOnline := c.hub.IsUserOnline(userID)
			// Only broadcast if user actually went offline
			if wasOnline && !isStillOnline {
				log.Printf("[WebSocket] Broadcasting user_offline for %s (disconnected, no other connections)", userID)
				// Broadcast user offline status with full user data to all connected clients
				if c.hub.authService != nil {
					user, err := c.hub.authService.GetUserByID(userID)
					if err == nil && user != nil {
						c.hub.BroadcastToAll(models.WebSocketMessage{
							Type: "user_offline",
							Data: models.PublicUser{
								ID:        user.ID,
								Nickname:  user.Nickname,
								AvatarURL: user.AvatarURL,
								Role:      user.Role,
								IsOnline:  false,
							},
						})
					}
				}
			} else if wasOnline && isStillOnline {
				log.Printf("[WebSocket] User %s disconnected but still has other connections, keeping online", userID)
			}
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
	case "nickname_change":
		c.handleNicknameChange(message.Data)
	case "ping":
		c.handlePing(message.Data)
	case "update_mute_state":
		c.handleUpdateMuteState(message.Data)
	case "update_deafen_state":
		c.handleUpdateDeafenState(message.Data)
	case "room_created":
		// This is a broadcast message, no action needed on receive
		log.Printf("Received room_created broadcast")
	case "send_message":
		c.handleSendMessage(message.Data)
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

	_, previewUser, err := c.hub.roomService.JoinRoom(c.roomID, req.UserID, req.Nickname)
	if err != nil {
		log.Printf("Error joining room: %v", err)
		return
	}

	// Broadcast room_user_joined to all clients (not just room) so they update their rooms list
	if previewUser != nil {
		roomUserJoinedMessage := models.WebSocketMessage{
			Type: "room_user_joined",
			Data: map[string]interface{}{
				"room_id": c.roomID,
				"user":    previewUser,
			},
		}
		c.hub.BroadcastToAll(roomUserJoinedMessage)
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

	// Send chat history to the joining user
	if c.hub.chatService != nil {
		messages := c.hub.chatService.GetMessages(c.roomID)
		chatHistoryMessage := models.WebSocketMessage{
			Type: "chat_history",
			Data: map[string]interface{}{
				"room_id":  c.roomID,
				"messages": messages,
			},
		}
		c.send <- marshalMessage(chatHistoryMessage)
	}
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

	// Note: We don't delete the LiveKit room here even if WebSocket room is empty.
	// LiveKit has its own empty timeout (300s) and will auto-delete the room.
	// This prevents disconnecting users who are still connected via LiveKit
	// but may have temporarily lost their WebSocket connection.
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

// handleUpdateMuteState handles mute state updates from clients
func (c *Client) handleUpdateMuteState(data interface{}) {
	var req models.UpdateAudioStateRequest
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &req)

	c.mu.RLock()
	userID := c.userID
	c.mu.RUnlock()

	if userID == "" {
		log.Printf("[WebSocket] Cannot update mute state: userID is empty")
		return
	}

	roomID := req.RoomID
	if roomID == "" {
		log.Printf("[WebSocket] Cannot update mute state: roomID is empty")
		return
	}

	log.Printf("[WebSocket] handleUpdateMuteState: userID=%q, roomID=%q, is_muted=%v", userID, roomID, req.IsMuted)

	// Update user's audio state in hub
	c.hub.mu.Lock()
	if c.hub.userAudioState[userID] == nil {
		c.hub.userAudioState[userID] = make(map[string]models.UserAudioState)
	}
	currentState := c.hub.userAudioState[userID][roomID]
	if currentState.IsMuted != req.IsMuted {
		c.hub.userAudioState[userID][roomID] = models.UserAudioState{
			UserID:     userID,
			RoomID:     roomID,
			IsMuted:    req.IsMuted,
			IsDeafened: currentState.IsDeafened,
		}
	}
	c.hub.mu.Unlock()

	// Update room service member state for API consistency
	if c.hub.roomService != nil {
		c.hub.roomService.UpdateUserMuteStatus(roomID, userID, req.IsMuted)
	}

	// Broadcast to all connected clients (global broadcast for server-side state)
	c.hub.BroadcastToAll(models.WebSocketMessage{
		Type: "user_audio_state",
		Data: models.UserAudioState{
			UserID:     userID,
			RoomID:     roomID,
			IsMuted:    req.IsMuted,
			IsDeafened: currentState.IsDeafened,
		},
	})
}

// handleUpdateDeafenState handles deafen state updates from clients
func (c *Client) handleUpdateDeafenState(data interface{}) {
	var req models.UpdateAudioStateRequest
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &req)

	c.mu.RLock()
	userID := c.userID
	c.mu.RUnlock()

	if userID == "" {
		log.Printf("[WebSocket] Cannot update deafen state: userID is empty")
		return
	}

	roomID := req.RoomID
	if roomID == "" {
		log.Printf("[WebSocket] Cannot update deafen state: roomID is empty")
		return
	}

	log.Printf("[WebSocket] handleUpdateDeafenState: userID=%q, roomID=%q, is_deafened=%v", userID, roomID, req.IsDeafened)

	// Update user's audio state in hub
	c.hub.mu.Lock()
	if c.hub.userAudioState[userID] == nil {
		c.hub.userAudioState[userID] = make(map[string]models.UserAudioState)
	}
	currentState := c.hub.userAudioState[userID][roomID]
	if currentState.IsDeafened != req.IsDeafened {
		c.hub.userAudioState[userID][roomID] = models.UserAudioState{
			UserID:     userID,
			RoomID:     roomID,
			IsMuted:    currentState.IsMuted,
			IsDeafened: req.IsDeafened,
		}
	}
	c.hub.mu.Unlock()

	// Update room service member state for API consistency
	if c.hub.roomService != nil {
		c.hub.roomService.UpdateUserDeafenStatus(roomID, userID, req.IsDeafened)
	}

	// Broadcast to all connected clients (global broadcast for server-side state)
	c.hub.BroadcastToAll(models.WebSocketMessage{
		Type: "user_audio_state",
		Data: models.UserAudioState{
			UserID:     userID,
			RoomID:     roomID,
			IsMuted:    currentState.IsMuted,
			IsDeafened: req.IsDeafened,
		},
	})
}

// handlePing handles ping messages and responds with pong
func (c *Client) handlePing(data interface{}) {
	var pingData struct {
		UserID    string `json:"user_id"`
		Timestamp int64  `json:"timestamp"`
	}
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &pingData)

	// Check if this is a new authentication (userID was empty but ping has one)
	c.mu.Lock()
	c.lastPingTime = time.Now()
	// Check if this is the first ping from this client
	shouldSendInitialData := !c.firstPingReceived
	c.firstPingReceived = true
	// If client doesn't have a userID yet but ping data has one, use it
	// This handles the case where user authenticates after connecting
	isNewAuthentication := false
	if c.userID == "" && pingData.UserID != "" {
		c.userID = pingData.UserID
		isNewAuthentication = true
		log.Printf("[WebSocket] User authenticated via ping: %s", pingData.UserID)
	}
	userID := c.userID
	roomID := c.roomID
	c.mu.Unlock()

	// Send initial audio states on first ping (client is now fully ready)
	if shouldSendInitialData && userID != "" {
		log.Printf("[WebSocket] First ping received from %s, sending initial audio states", userID)
		c.hub.sendAudioStatesToClient(c)
	}

	// Update ping time in room service (this is what actually matters for timeout detection)
	if roomID != "" && userID != "" {
		c.hub.roomService.UpdateUserPingTime(roomID, userID)
	}

	// Update global presence (for users connected via global WebSocket)
	if userID != "" {
		wasOnline := c.hub.IsUserOnline(userID)
		c.hub.UpdateUserPing(userID)
		// Broadcast if either:
		// 1. User just authenticated via ping (new connection with auth)
		// 2. User was offline but is now online
		shouldBroadcast := isNewAuthentication || !wasOnline
		if shouldBroadcast {
			if c.hub.authService != nil {
				user, err := c.hub.authService.GetUserByID(userID)
				if err == nil && user != nil {
					log.Printf("[WebSocket] Broadcasting user_online for %s (new_auth=%v, was_online=%v)", userID, isNewAuthentication, wasOnline)
					c.hub.BroadcastToAll(models.WebSocketMessage{
						Type: "user_online",
						Data: models.PublicUser{
							ID:        user.ID,
							Nickname:  user.Nickname,
							AvatarURL: user.AvatarURL,
							Role:      user.Role,
							IsOnline:  true,
						},
					})
				} else {
					log.Printf("[WebSocket] Cannot broadcast user_online for %s: auth error=%v, user=%v", userID, err, user)
				}
			} else {
				log.Printf("[WebSocket] Cannot broadcast user_online for %s: authService is nil", userID)
			}
		} else {
			log.Printf("[WebSocket] Not broadcasting user_online for %s: wasOnline=%v, isNewAuth=%v", userID, wasOnline, isNewAuthentication)
		}
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
	broadcastTicker := time.NewTicker(30 * time.Second)
	defer checkTicker.Stop()
	defer broadcastTicker.Stop()

	for {
		select {
		case <-checkTicker.C:
			h.checkPingTimeouts()
		case <-broadcastTicker.C:
			h.broadcastOnlineUsers()
		}
	}
}

// broadcastOnlineUsers sends the current list of online users to all connected clients
func (h *Hub) broadcastOnlineUsers() {
	onlineUserIDs := h.GetOnlineUsers()
	if len(onlineUserIDs) == 0 {
		return
	}

	// Fetch full user data for all online users
	var onlineUsers []models.PublicUser
	if h.authService != nil {
		for _, userID := range onlineUserIDs {
			user, err := h.authService.GetUserByID(userID)
			if err == nil && user != nil {
				onlineUsers = append(onlineUsers, models.PublicUser{
					ID:        user.ID,
					Nickname:  user.Nickname,
					AvatarURL: user.AvatarURL,
					Role:      user.Role,
					IsOnline:  true,
				})
			}
		}
	}

	message := models.WebSocketMessage{
		Type: "online_users",
		Data: map[string]interface{}{
			"users": onlineUsers,
		},
	}
	h.BroadcastToAll(message)
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

	// Check for users who went offline based on global presence (60 second timeout)
	h.checkGlobalPresenceTimeouts()
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

// checkGlobalPresenceTimeouts checks for users who haven't pinged in 30 seconds and marks them offline
// Note: Offline status is propagated via the periodic online_users broadcast (lazy update),
// not via individual user_offline events
func (h *Hub) checkGlobalPresenceTimeouts() {
	h.mu.Lock()
	defer h.mu.Unlock()

	timeout := 30 * time.Second
	now := time.Now()
	offlineUsers := make([]string, 0)

	for userID, lastSeen := range h.onlineUsers {
		if now.Sub(lastSeen) > timeout {
			offlineUsers = append(offlineUsers, userID)
		}
	}

	// Remove offline users - their offline status will be propagated via the next online_users broadcast
	for _, userID := range offlineUsers {
		delete(h.onlineUsers, userID)
		log.Printf("User %s marked offline due to inactivity (30s timeout), will be synced via online_users broadcast", userID)
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

	// Note: We don't delete the LiveKit room here even if WebSocket room is empty.
	// LiveKit has its own empty timeout (300s) and will auto-delete the room.
	// This prevents disconnecting users who are still connected via LiveKit
	// but may have temporarily lost their WebSocket connection.

	log.Printf("User %s successfully removed from room %s due to ping timeout", userID, roomID)
}

// handleSendMessage handles sending a chat message
func (c *Client) handleSendMessage(data interface{}) {
	c.mu.RLock()
	userID := c.userID
	roomID := c.roomID
	c.mu.RUnlock()

	if userID == "" {
		log.Printf("[Chat] Cannot send message: userID is empty")
		return
	}

	var req models.SendChatMessageRequest
	jsonData, _ := json.Marshal(data)
	json.Unmarshal(jsonData, &req)

	// Validate content
	content := req.Content
	if content == "" {
		log.Printf("[Chat] Cannot send message: content is empty")
		c.send <- marshalMessage(models.WebSocketMessage{
			Type: "error",
			Data: map[string]string{"message": "Message content cannot be empty"},
		})
		return
	}

	if len(content) > 2000 {
		log.Printf("[Chat] Cannot send message: content exceeds 2000 characters")
		c.send <- marshalMessage(models.WebSocketMessage{
			Type: "error",
			Data: map[string]string{"message": "Message content exceeds 2000 characters"},
		})
		return
	}

	// Add message to chat service
	if c.hub.chatService != nil {
		msg, err := c.hub.chatService.AddMessage(roomID, userID, content)
		if err != nil {
			log.Printf("[Chat] Error adding message: %v", err)
			c.send <- marshalMessage(models.WebSocketMessage{
				Type: "error",
				Data: map[string]string{"message": err.Error()},
			})
			return
		}

		// Broadcast new message to all users in room
		newMessageBroadcast := models.WebSocketMessage{
			Type: "new_message",
			Data: map[string]interface{}{
				"room_id": roomID,
				"message": msg,
			},
		}
		c.hub.BroadcastToRoom(roomID, newMessageBroadcast)
		log.Printf("[Chat] Message broadcast to room %s from user %s", roomID, userID)
	}
}

// ClearChatHistory clears chat history for a room (called when LiveKit room is deleted)
func (h *Hub) ClearChatHistory(roomID string) {
	if h.chatService != nil {
		h.chatService.ClearRoom(roomID)
		log.Printf("[Chat] Chat history cleared for room %s", roomID)
	}
}
