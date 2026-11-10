package websocket

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"
	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/ratelimit"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

const maxWebSocketMessageSize = 1 << 20

// Hub manages WebSocket connections
type Hub struct {
	clients        map[*Client]bool
	roomClients    map[string]map[*Client]bool // room_id -> clients
	onlineUsers    map[string]time.Time        // user_id -> last_seen timestamp (global connections)
	roomService    *service.RoomService
	authService    *service.AuthService
	livekitService *service.LiveKitService
	chatService    *service.ChatService
	sessionRepo    *repository.SessionRepository
	permissions    *service.PermissionService // nil only in unit tests
	grantsMu       sync.Mutex
	appliedGrants  map[string]permissions.Permission // "room|user" -> perms last pushed to LiveKit
	cfg            *config.Config
	upgrader       websocket.Upgrader
	mu             sync.RWMutex

	// Stats manager fields
	statsEnabledRooms map[string]bool                               // room_id -> enabled
	statsAdminSubs    map[string]map[*Client]bool                   // room_id -> admin clients subscribed
	statsRoomData     map[string]map[string]models.ClientStatsBatch // room_id -> reporter_id -> latest batch
	pendingAdminSubs  map[string]map[string]bool                    // userID -> roomID -> pending subscription

	// Soundboard (see soundboard.go)
	soundboard    SoundLookup
	soundMu       sync.Mutex
	lastSoundPlay map[string]time.Time // user_id -> last accepted play_sound

	// Text channels (see textchat.go)
	textChat    *TextChat
	textLimiter *ratelimit.Limiter
}

// Client represents a WebSocket client
type Client struct {
	hub               *Hub
	conn              *websocket.Conn
	send              chan []byte
	roomID            string
	userID            string
	subject           service.Subject // RBAC identity, resolved at connect
	lastPingTime      time.Time
	firstPingReceived bool
	mu                sync.RWMutex
}

// NewHub creates a new WebSocket hub
func NewHub(roomService *service.RoomService, authService *service.AuthService, livekitService *service.LiveKitService, chatService *service.ChatService, sessionRepo *repository.SessionRepository, cfg *config.Config) *Hub {
	hub := &Hub{
		clients:           make(map[*Client]bool),
		roomClients:       make(map[string]map[*Client]bool),
		onlineUsers:       make(map[string]time.Time),
		roomService:       roomService,
		authService:       authService,
		livekitService:    livekitService,
		chatService:       chatService,
		sessionRepo:       sessionRepo,
		cfg:               cfg,
		statsEnabledRooms: make(map[string]bool),
		statsAdminSubs:    make(map[string]map[*Client]bool),
		statsRoomData:     make(map[string]map[string]models.ClientStatsBatch),
		pendingAdminSubs:  make(map[string]map[string]bool),
	}
	hub.upgrader = websocket.Upgrader{CheckOrigin: hub.checkOrigin}

	// Start the ping monitor goroutine
	go hub.startPingMonitor()

	return hub
}

// checkOrigin limits WebSocket upgrades to the configured frontend origins.
// Non-browser clients that omit Origin are allowed; Electron uses orbital://app.
func (h *Hub) checkOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	if strings.EqualFold(strings.TrimRight(origin, "/"), "orbital://app") {
		return true
	}
	if h.cfg == nil {
		return false
	}

	for _, allowed := range h.cfg.GetCORSOrigins() {
		allowed = strings.TrimRight(strings.TrimSpace(allowed), "/")
		if allowed == "*" || strings.EqualFold(allowed, strings.TrimRight(origin, "/")) {
			return true
		}
	}
	return false
}

func (h *Hub) subscribeClientToRoom(client *Client, roomID string) {
	if roomID == "" {
		return
	}
	h.mu.Lock()
	if h.roomClients[roomID] == nil {
		h.roomClients[roomID] = make(map[*Client]bool)
	}
	h.roomClients[roomID][client] = true
	h.mu.Unlock()
}

func (h *Hub) unsubscribeClientFromRoom(client *Client, roomID string) {
	if roomID == "" {
		return
	}
	h.mu.Lock()
	if h.roomClients[roomID] != nil {
		delete(h.roomClients[roomID], client)
		if len(h.roomClients[roomID]) == 0 {
			delete(h.roomClients, roomID)
		}
	}
	h.mu.Unlock()
}

// HandleWebSocket handles WebSocket connections
func (h *Hub) HandleWebSocket(roomID string, w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	conn.SetReadLimit(maxWebSocketMessageSize)

	// Enable TCP keepalive to detect half-open connections (power loss, network cut)
	if tcpConn, ok := conn.UnderlyingConn().(*net.TCPConn); ok {
		if err := tcpConn.SetKeepAlive(true); err != nil {
			log.Printf("WebSocket keepalive error: %v", err)
		}
		if err := tcpConn.SetKeepAlivePeriod(15 * time.Second); err != nil {
			log.Printf("WebSocket keepalive period error: %v", err)
		}
	}

	// Set initial read deadline so a stale connection is detected even if the ping monitor fails
	pingTimeout := 90 * time.Second
	if h.cfg != nil && h.cfg.WebSocket.PingTimeout > 0 {
		pingTimeout = h.cfg.WebSocket.PingTimeout
	}
	if err := conn.SetReadDeadline(time.Now().Add(pingTimeout)); err != nil {
		log.Printf("WebSocket read deadline error: %v", err)
	}

	client := &Client{
		hub:          h,
		conn:         conn,
		send:         make(chan []byte, 256),
		roomID:       roomID,
		lastPingTime: time.Now(),
	}

	// JWT authentication is mandatory: no token means no connection.
	// Client-supplied user IDs in messages are never trusted (see handlePing/handleJoinRoom).
	if h.authService == nil {
		log.Printf("WebSocket connection rejected (roomID=%q): auth service unavailable", roomID)
		_ = conn.Close()
		return
	}
	token := r.URL.Query().Get("token")
	if token == "" {
		log.Printf("WebSocket connection rejected (roomID=%q): missing token", roomID)
		_ = conn.Close()
		return
	}
	claims, err := h.authService.ValidateJWT(token)
	if err != nil {
		log.Printf("WebSocket connection rejected (roomID=%q): token validation failed: %v", roomID, err)
		_ = conn.Close()
		return
	}
	if claims.UserID == "" {
		log.Printf("WebSocket connection rejected (roomID=%q): token has empty userID", roomID)
		_ = conn.Close()
		return
	}
	user, err := h.authService.GetUserByID(claims.UserID)
	if err != nil || user == nil {
		log.Printf("WebSocket connection rejected (roomID=%q): user no longer exists", roomID)
		_ = conn.Close()
		return
	}
	if claims.TokenVersion != user.TokenVersion {
		log.Printf("WebSocket connection rejected (roomID=%q): token has been revoked", roomID)
		_ = conn.Close()
		return
	}
	client.mu.Lock()
	client.userID = claims.UserID
	client.subject = service.SubjectFromUser(user)
	client.mu.Unlock()
	userID := claims.UserID
	log.Printf("WebSocket client authenticated with userID: %s", userID)

	// Add client to the global clients map first so presence and global
	// broadcasts work immediately. Room subscription happens only after a
	// successful join_room.
	h.mu.Lock()
	h.clients[client] = true
	clientCount := len(h.clients)
	h.mu.Unlock()

	if roomID != "" {
		log.Printf("WebSocket client connected to room %s (user: %s, awaiting join, total clients: %d)", roomID, userID, clientCount)
	} else {
		log.Printf("WebSocket client connected for global broadcasts (user: %s, total clients: %d)", userID, clientCount)
	}

	// Apply any pending admin stats subscriptions for this user
	h.applyPendingAdminSubs(client, userID)

	// Mark user as online (userID is guaranteed non-empty: unauthenticated
	// connections are rejected above)
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
				Data: models.NewPublicUser(user, true),
			})
		}
	} else {
		log.Printf("[WebSocket] Cannot broadcast user_online: authService is nil")
	}

	// Start goroutines for this client FIRST so they can receive messages
	go client.writePump()
	go client.readPump()

	// Send initial online users list to the new client (after writePump starts)
	log.Printf("[WebSocket] HandleWebSocket: roomID=%q, userID=%q", roomID, userID)
	if roomID == "" {
		log.Printf("[WebSocket] Sending initial data to user %s (global ws)", userID)
		onlineUserIDs := h.GetOnlineUsers()
		log.Printf("[WebSocket] Preparing initial online_users list for %s: %d users online", userID, len(onlineUserIDs))

		// Fetch full user data for all online users
		var onlineUsers []models.PublicUser
		if h.authService != nil {
			for _, uid := range onlineUserIDs {
				user, err := h.authService.GetUserByID(uid)
				if err == nil && user != nil {
					onlineUsers = append(onlineUsers, models.NewPublicUser(user, true))
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

// BroadcastCustomStatusChange broadcasts a user's custom status change to all connected clients
func (h *Hub) BroadcastCustomStatusChange(status models.CustomStatusResponse) {
	h.BroadcastToAll(models.WebSocketMessage{
		Type: "custom_status_change",
		Data: status,
	})
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

// BroadcastHalloweenPumpkinState broadcasts a user's pumpkin customization
// change to every room the user is currently in.
func (h *Hub) BroadcastHalloweenPumpkinState(userID string, equippedJSON string) {
	h.mu.RLock()
	rooms := make(map[string]bool)
	for roomID, clients := range h.roomClients {
		for client := range clients {
			if client != nil && client.userID == userID {
				rooms[roomID] = true
				break
			}
		}
	}
	h.mu.RUnlock()

	for roomID := range rooms {
		h.BroadcastToRoom(roomID, models.WebSocketMessage{
			Type: "halloween_pumpkin_state",
			Data: map[string]string{
				"user_id":       userID,
				"equipped_json": equippedJSON,
			},
		})
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

// sendMediaStatesToClient sends the media state (mute/deafen/screen share/camera)
// of every room member to a client. Room members are the single source of truth.
func (h *Hub) sendMediaStatesToClient(client *Client) {
	all := h.roomService.GetAllMediaStates()
	ps := h.permissionService()
	states := make([]models.UserMediaState, 0, len(all))
	for _, st := range all {
		if h.canInRoom(ps, client, st.RoomID, permissions.ViewRoom) {
			states = append(states, st)
		}
	}

	message := models.WebSocketMessage{
		Type: "media_states",
		Data: map[string]interface{}{
			"states": states,
		},
	}
	select {
	case client.send <- marshalMessage(message):
		log.Printf("[WebSocket] Sent %d media states to user %s", len(states), client.userID)
	default:
		log.Printf("[WebSocket] Failed to send media states to user %s: channel blocked", client.userID)
	}
}

// readPump handles messages from the WebSocket connection
func (c *Client) readPump() {
	defer func() {
		// Get userID before removing from maps
		c.mu.RLock()
		userID := c.userID
		roomID := c.roomID
		c.mu.RUnlock()

		// Clean up admin stats subscription
		c.hub.UnsubscribeAdmin(c)

		// Finalize the call session (abrupt disconnect, e.g. page close)
		c.hub.updateSessionLastSeen(userID, roomID)

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
							Data: models.NewPublicUser(user, false),
						})
					}
				}
			} else if wasOnline && isStillOnline {
				log.Printf("[WebSocket] User %s disconnected but still has other connections, keeping online", userID)
			}
		}

		_ = c.conn.Close()
	}()

	for {
		// Reset read deadline on each successful read so the connection stays alive
		// as long as messages arrive within the ping timeout window
		pingTimeout := 90 * time.Second
		if c.hub.cfg != nil && c.hub.cfg.WebSocket.PingTimeout > 0 {
			pingTimeout = c.hub.cfg.WebSocket.PingTimeout
		}
		if err := c.conn.SetReadDeadline(time.Now().Add(pingTimeout)); err != nil {
			log.Printf("WebSocket read deadline error: %v", err)
			break
		}

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
	defer func() { _ = c.conn.Close() }()

	for message := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
			log.Printf("WebSocket write error: %v", err)
			return
		}
	}

	_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
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
	case "update_media_state":
		c.handleUpdateMediaState(message.Data)
	case "update_mute_state":
		c.handleUpdateMuteState(message.Data)
	case "update_deafen_state":
		c.handleUpdateDeafenState(message.Data)
	case "room_created":
		// This is a broadcast message, no action needed on receive
		log.Printf("Received room_created broadcast")
	case "send_message":
		c.handleSendMessage(message.Data)
	case "play_sound":
		c.handlePlaySound(message.Data)
	case "client_stats_batch":
		c.handleClientStatsBatch(message.Data)
	case "request_stats_state":
		c.handleRequestStatsState(message.Data)
	case "request_logs":
		c.handleRequestLogs(message.Data)
	case "text_message_send":
		c.handleTextMessageSend(message.Data)
	case "text_message_edit":
		c.handleTextMessageEdit(message.Data)
	case "text_message_delete":
		c.handleTextMessageDelete(message.Data)
	case "text_channel_read":
		c.handleTextChannelRead(message.Data)
	case "text_reaction_toggle":
		c.handleTextReactionToggle(message.Data)
	case "text_pin":
		c.handleTextPin(message.Data)
	case "text_typing":
		c.handleTextTyping(message.Data)
	default:
		log.Printf("Unknown message type: %s", message.Type)
	}
}

// handleJoinRoom handles user joining a room
func (c *Client) handleJoinRoom(data interface{}) {
	var req models.JoinRoomRequest
	jsonData, _ := json.Marshal(data)
	if err := json.Unmarshal(jsonData, &req); err != nil {
		log.Printf("[WebSocket] Invalid join_room payload: %v", err)
		return
	}

	c.mu.Lock()
	c.lastPingTime = time.Now() // Reset ping time on join to prevent immediate timeout
	c.mu.Unlock()

	c.mu.RLock()
	userID := c.userID // Authenticated at connection time; never trust req.UserID
	c.mu.RUnlock()

	if userID == "" {
		log.Printf("[WebSocket] Rejecting join_room for room %s: unauthenticated client", c.roomID)
		return
	}
	if req.UserID != "" && req.UserID != userID {
		log.Printf("[WebSocket] Rejecting join_room: user_id mismatch (authenticated=%s, requested=%s)", userID, req.UserID)
		return
	}

	if room, ok := c.hub.roomService.GetRoom(c.roomID); ok && room.IsText() {
		log.Printf("[WebSocket] Rejecting join_room for user %s in room %s: text channels cannot be joined", userID, c.roomID)
		c.hub.trySend(c, marshalMessage(models.WebSocketMessage{
			Type: "error",
			Data: map[string]string{"message": "Text channels cannot be joined"},
		}))
		return
	}

	if !c.hub.canInRoom(c.hub.permissionService(), c, c.roomID, permissions.ViewRoom|permissions.Connect) {
		log.Printf("[WebSocket] Rejecting join_room for user %s in room %s: missing connect permission", userID, c.roomID)
		sendPermissionDenied(c, "join_room", c.roomID)
		return
	}

	nickname := req.Nickname
	if nickname == "" {
		if len(userID) >= 8 {
			nickname = "User-" + userID[:8]
		} else {
			nickname = "User-" + userID
		}
	}

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

	_, previewUser, err := c.hub.roomService.JoinRoom(c.roomID, userID, nickname)
	if err != nil {
		log.Printf("Error joining room: %v", err)
		return
	}

	// Apply the client's media state at join so the member (and the
	// room_user_joined/room_users broadcasts below) never carry stale defaults.
	if req.MediaState != nil {
		state := *req.MediaState
		state.RoomID = c.roomID
		c.hub.coerceMediaState(c, &state)
		if _, ok := c.hub.roomService.UpdateUserMediaState(c.roomID, userID, state); ok && previewUser != nil {
			previewUser.IsMuted = state.IsMuted
			previewUser.IsDeafened = state.IsDeafened
			previewUser.IsScreenSharing = state.IsScreenSharing
			previewUser.IsCameraEnabled = state.IsCameraEnabled
		}
	}

	c.hub.subscribeClientToRoom(c, c.roomID)

	// Track the call session (1 row per user per call)
	c.hub.recordSessionStart(userID, c.roomID, req.DeviceInfo)

	// Broadcast room_user_joined to all clients (not just room) so they update their rooms list
	if previewUser != nil {
		roomUserJoinedMessage := models.WebSocketMessage{
			Type: "room_user_joined",
			Data: map[string]interface{}{
				"room_id": c.roomID,
				"user":    previewUser,
			},
		}
		c.hub.BroadcastRoomScoped(c.roomID, roomUserJoinedMessage)
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

	// If stats collection is enabled for this room, notify the joining user
	if c.hub.IsStatsEnabled(c.roomID) {
		enableMsg := models.WebSocketMessage{
			Type: "enable_stats_collection",
			Data: models.EnableStatsCommand{
				RoomID:     c.roomID,
				Action:     "enable",
				IntervalMs: defaultStatsIntervalMs,
			},
		}
		c.send <- marshalMessage(enableMsg)
	}
}

// handleLeaveRoom handles user leaving a room
func (c *Client) handleLeaveRoom(data interface{}) {
	c.mu.RLock()
	userID := c.userID
	roomID := c.roomID
	c.mu.RUnlock()

	c.hub.unsubscribeClientFromRoom(c, roomID)
	c.hub.roomService.LeaveRoom(roomID, userID)

	// Finalize the call session last_seen so short calls get accurate durations
	c.hub.updateSessionLastSeen(userID, roomID)

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

	// Clear chat history when last user leaves
	if len(users) == 0 && c.hub.chatService != nil {
		c.hub.chatService.ClearRoom(roomID)
		log.Printf("[Chat] Chat history cleared for room %s (last user left)", roomID)
	}

	// Note: We don't delete the LiveKit room here even if WebSocket room is empty.
	// LiveKit has its own empty timeout (300s) and will auto-delete the room.
	// This prevents disconnecting users who are still connected via LiveKit
	// but may have temporarily lost their WebSocket connection.
}

// handleNicknameChange handles user nickname changes
func (c *Client) handleNicknameChange(data interface{}) {
	var req models.NicknameChangeRequest
	jsonData, _ := json.Marshal(data)
	if err := json.Unmarshal(jsonData, &req); err != nil {
		log.Printf("[WebSocket] Invalid nickname_change payload: %v", err)
		return
	}

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

// handleUpdateMediaState handles a full media state snapshot from a client
func (c *Client) handleUpdateMediaState(data interface{}) {
	var req models.UpdateMediaStateRequest
	jsonData, _ := json.Marshal(data)
	if err := json.Unmarshal(jsonData, &req); err != nil {
		log.Printf("[WebSocket] Invalid update_media_state payload: %v", err)
		return
	}
	c.applyMediaState(req)
}

// handleUpdateMuteState handles legacy mute-only updates (older clients).
// It patches the stored snapshot so other fields are kept.
func (c *Client) handleUpdateMuteState(data interface{}) {
	var req struct {
		RoomID  string `json:"room_id"`
		IsMuted bool   `json:"is_muted"`
	}
	jsonData, _ := json.Marshal(data)
	if err := json.Unmarshal(jsonData, &req); err != nil {
		log.Printf("[WebSocket] Invalid update_mute_state payload: %v", err)
		return
	}
	c.patchMediaState(req.RoomID, func(s *models.UpdateMediaStateRequest) { s.IsMuted = req.IsMuted })
}

// handleUpdateDeafenState handles legacy deafen-only updates (older clients).
func (c *Client) handleUpdateDeafenState(data interface{}) {
	var req struct {
		RoomID     string `json:"room_id"`
		IsDeafened bool   `json:"is_deafened"`
	}
	jsonData, _ := json.Marshal(data)
	if err := json.Unmarshal(jsonData, &req); err != nil {
		log.Printf("[WebSocket] Invalid update_deafen_state payload: %v", err)
		return
	}
	c.patchMediaState(req.RoomID, func(s *models.UpdateMediaStateRequest) { s.IsDeafened = req.IsDeafened })
}

func (c *Client) patchMediaState(roomID string, patch func(*models.UpdateMediaStateRequest)) {
	c.mu.RLock()
	userID := c.userID
	c.mu.RUnlock()

	if c.hub.roomService == nil {
		return
	}
	current, ok := c.hub.roomService.GetUserMediaState(roomID, userID)
	if !ok {
		log.Printf("[WebSocket] Rejecting media state for user %s: not a member of room %s", userID, roomID)
		return
	}
	req := models.UpdateMediaStateRequest{
		RoomID:          roomID,
		IsMuted:         current.IsMuted,
		IsDeafened:      current.IsDeafened,
		IsScreenSharing: current.IsScreenSharing,
		IsCameraEnabled: current.IsCameraEnabled,
	}
	patch(&req)
	c.applyMediaState(req)
}

// applyMediaState stores the snapshot on the room member and broadcasts it
// to every connected client when something changed.
func (c *Client) applyMediaState(req models.UpdateMediaStateRequest) {
	c.mu.RLock()
	userID := c.userID
	c.mu.RUnlock()

	if userID == "" || req.RoomID == "" || c.hub.roomService == nil {
		log.Printf("[WebSocket] Cannot update media state: userID=%q roomID=%q", userID, req.RoomID)
		return
	}

	c.hub.coerceMediaState(c, &req)
	changed, ok := c.hub.roomService.UpdateUserMediaState(req.RoomID, userID, req)
	if !ok {
		log.Printf("[WebSocket] Rejecting media state for user %s: not a member of room %s", userID, req.RoomID)
		return
	}
	if !changed {
		return
	}

	log.Printf("[WebSocket] Media state: userID=%q roomID=%q muted=%v deafened=%v screen=%v camera=%v",
		userID, req.RoomID, req.IsMuted, req.IsDeafened, req.IsScreenSharing, req.IsCameraEnabled)

	c.hub.BroadcastRoomScoped(req.RoomID, models.WebSocketMessage{
		Type: "user_media_state",
		Data: models.UserMediaState{
			UserID:          userID,
			RoomID:          req.RoomID,
			IsMuted:         req.IsMuted,
			IsDeafened:      req.IsDeafened,
			IsScreenSharing: req.IsScreenSharing,
			IsCameraEnabled: req.IsCameraEnabled,
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
	if err := json.Unmarshal(jsonData, &pingData); err != nil {
		log.Printf("[WebSocket] Invalid ping payload: %v", err)
		return
	}

	// Identity comes solely from the JWT validated at connection time.
	// A user_id in the ping body is never trusted; a mismatch is logged and ignored.
	c.mu.Lock()
	c.lastPingTime = time.Now()
	// Check if this is the first ping from this client
	shouldSendInitialData := !c.firstPingReceived
	c.firstPingReceived = true
	userID := c.userID
	roomID := c.roomID
	c.mu.Unlock()

	if pingData.UserID != "" && pingData.UserID != userID {
		log.Printf("[WebSocket] Ignoring ping user_id mismatch (authenticated=%s, ping=%s)", userID, pingData.UserID)
	}

	if userID == "" {
		log.Printf("[WebSocket] Ignoring ping from unauthenticated client")
		return
	}

	// Send initial audio states on first ping (client is now fully ready)
	if shouldSendInitialData {
		log.Printf("[WebSocket] First ping received from %s, sending initial media states", userID)
		c.hub.sendMediaStatesToClient(c)
	}

	// Update ping time in room service (this is what actually matters for timeout detection)
	if roomID != "" {
		c.hub.roomService.UpdateUserPingTime(roomID, userID)
		// Refresh the call session last_seen
		c.hub.updateSessionLastSeen(userID, roomID)
	}

	// Update global presence (for users connected via global WebSocket)
	wasOnline := c.hub.IsUserOnline(userID)
	c.hub.UpdateUserPing(userID)
	// Broadcast only when the user transitions from offline to online
	if !wasOnline {
		if c.hub.authService != nil {
			user, err := c.hub.authService.GetUserByID(userID)
			if err == nil && user != nil {
				log.Printf("[WebSocket] Broadcasting user_online for %s (was_online=%v)", userID, wasOnline)
				c.hub.BroadcastToAll(models.WebSocketMessage{
					Type: "user_online",
					Data: models.NewPublicUser(user, true),
				})
			} else {
				log.Printf("[WebSocket] Cannot broadcast user_online for %s: auth error=%v, user=%v", userID, err, user)
			}
		} else {
			log.Printf("[WebSocket] Cannot broadcast user_online for %s: authService is nil", userID)
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
// defaultPingCheckInterval matches config.DefaultConfig; used when the configured
// interval is zero/negative (e.g. a partial config) instead of panicking in NewTicker.
const defaultPingCheckInterval = 10 * time.Second

func pingCheckInterval(configured time.Duration) time.Duration {
	if configured <= 0 {
		log.Printf("WARNING: invalid ping check interval %v, using %v", configured, defaultPingCheckInterval)
		return defaultPingCheckInterval
	}
	return configured
}

func (h *Hub) startPingMonitor() {
	// Safety check for config
	if h.cfg == nil {
		log.Printf("ERROR: Ping monitor cannot start - config is nil")
		return
	}

	checkInterval := pingCheckInterval(h.cfg.WebSocket.PingCheckInterval)

	log.Printf("Starting ping monitor (timeout: %v, check interval: %v)",
		h.cfg.WebSocket.PingTimeout, checkInterval)

	checkTicker := time.NewTicker(checkInterval)
	broadcastTicker := time.NewTicker(30 * time.Second)
	defer checkTicker.Stop()
	defer broadcastTicker.Stop()

	for {
		// Recover from panics so a single error doesn't kill the entire ping monitor
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("CRITICAL: Ping monitor recovered from panic: %v", r)
				}
			}()

			select {
			case <-checkTicker.C:
				h.checkPingTimeouts()
			case <-broadcastTicker.C:
				h.broadcastOnlineUsers()
			}
		}()
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
				onlineUsers = append(onlineUsers, models.NewPublicUser(user, true))
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
		_ = client.conn.Close()
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

	// Finalize the call session last_seen (ping timeout)
	h.updateSessionLastSeen(userID, roomID)

	// Broadcast user_left message globally
	leaveMessage := models.WebSocketMessage{
		Type: "user_left",
		Data: map[string]string{
			"user_id": userID,
			"room_id": roomID,
		},
	}
	h.BroadcastRoomScoped(roomID, leaveMessage)

	// Broadcast room_user_left message to everyone who can see the room (for room list updates)
	if leftUser != nil {
		roomUserLeftMessage := models.WebSocketMessage{
			Type: "room_user_left",
			Data: map[string]interface{}{
				"room_id": roomID,
				"user":    leftUser,
			},
		}
		h.BroadcastRoomScoped(roomID, roomUserLeftMessage)
	}

	// Broadcast updated room users to the room
	users := h.roomService.GetRoomUsers(roomID)
	usersUpdate := models.WebSocketMessage{
		Type: "room_users",
		Data: users,
	}
	h.BroadcastToRoom(roomID, usersUpdate)

	// Clear chat history when last user leaves due to ping timeout
	if len(users) == 0 && h.chatService != nil {
		h.chatService.ClearRoom(roomID)
		log.Printf("[Chat] Chat history cleared for room %s (last user left due to ping timeout)", roomID)
	}

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
	if roomID == "" || c.hub.roomService == nil || !c.hub.roomService.IsUserInRoom(roomID, userID) {
		log.Printf("[Chat] Rejecting message from user %s: not a member of room %s", userID, roomID)
		c.send <- marshalMessage(models.WebSocketMessage{
			Type: "error",
			Data: map[string]string{"message": "You are not in this room"},
		})
		return
	}

	if !c.hub.canInRoom(c.hub.permissionService(), c, roomID, permissions.SendMessages) {
		log.Printf("[Chat] Rejecting message from user %s in room %s: missing send_messages", userID, roomID)
		sendPermissionDenied(c, "send_message", roomID)
		return
	}

	var req models.SendChatMessageRequest
	jsonData, _ := json.Marshal(data)
	if err := json.Unmarshal(jsonData, &req); err != nil {
		log.Printf("[WebSocket] Invalid send_message payload: %v", err)
		return
	}

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

	if utf8.RuneCountInString(content) > 2000 {
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
