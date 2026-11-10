package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"unicode/utf8"

	"github.com/gorilla/mux"
	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/permissions"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/websocket"
)

const (
	maxRoomNameChars = 100
	// maxRoomNameBytes bounds the raw value: 100 longest custom emoji tokens
	// ("<:" + 64-rune shortcode + ":" + 36-char id + ">", up to 4 bytes per rune).
	maxRoomNameBytes = 100 * (2 + 64*4 + 1 + 36 + 1)
)

// customEmojiTokenRe matches inline custom emojis in room names:
// "<:shortcode:id>". Keep in sync with frontend/src/services/emoji/inlineText.ts.
var customEmojiTokenRe = regexp.MustCompile(`<:[\p{L}\p{N}_]{1,64}:[0-9a-f-]{36}>`)

// validRoomNameLength counts characters, not bytes (emojis and non-Latin
// names are multi-byte), with each custom emoji token counted as one.
func validRoomNameLength(name string) bool {
	if len(name) > maxRoomNameBytes {
		return false
	}
	return utf8.RuneCountInString(customEmojiTokenRe.ReplaceAllString(name, "x")) <= maxRoomNameChars
}

// RoomHandler handles room-related HTTP requests
type RoomHandler struct {
	roomService     *service.RoomService
	categoryService *service.CategoryService
	livekitService  *service.LiveKitService
	permissions     *service.PermissionService
	wsHub           *websocket.Hub
	textChat        *websocket.TextChat // nil when text channels are disabled
}

// SetTextChat enables creating text channels and cleans up their messages
// when they are deleted.
func (h *RoomHandler) SetTextChat(tc *websocket.TextChat) {
	h.textChat = tc
}

// NewRoomHandler creates a new RoomHandler
func NewRoomHandler(roomService *service.RoomService, categoryService *service.CategoryService, livekitService *service.LiveKitService, permissionService *service.PermissionService, wsHub *websocket.Hub) *RoomHandler {
	return &RoomHandler{
		roomService:     roomService,
		categoryService: categoryService,
		livekitService:  livekitService,
		permissions:     permissionService,
		wsHub:           wsHub,
	}
}

// CreateRoom handles POST /api/rooms
func (h *RoomHandler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	var req models.CreateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if req.Name == "" {
		http.Error(w, "Room name is required", http.StatusBadRequest)
		return
	}
	if !validRoomNameLength(req.Name) {
		http.Error(w, "Room name too long (max 100 characters)", http.StatusBadRequest)
		return
	}

	if req.MaxUsers < config.RoomConfig.MinUsers || req.MaxUsers > config.RoomConfig.MaxUsers {
		req.MaxUsers = config.RoomConfig.DefaultMaxUsers
	}

	if req.Category == "" {
		req.Category = "general"
	}

	if req.Type == "" {
		req.Type = models.RoomTypeVoice
	}
	if !models.ValidRoomType(req.Type) {
		http.Error(w, "Unknown room type", http.StatusBadRequest)
		return
	}
	if req.Type == models.RoomTypeText && h.textChat == nil {
		http.Error(w, "Text channels are not enabled on this server", http.StatusBadRequest)
		return
	}

	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Check if category exists, if not create it
	categoryExists := false
	categoryID := ""
	categories := h.categoryService.GetCategories()
	for _, cat := range categories {
		if cat.Name == req.Category {
			categoryExists = true
			categoryID = cat.ID
			break
		}
	}

	// Creating in an existing category needs manage_rooms there; auto-creating
	// a category needs manage_rooms server-wide.
	if categoryExists {
		if !h.permissions.CategoryPerms(sub, categoryID).Has(permissions.ManageRooms) {
			http.Error(w, "Missing permission", http.StatusForbidden)
			return
		}
	} else if !h.permissions.CanServer(sub, permissions.ManageRooms) {
		http.Error(w, "Missing permission", http.StatusForbidden)
		return
	}

	if !categoryExists {
		// Create the category
		newCategory, err := h.categoryService.CreateCategory(req.Category)
		if err != nil {
			http.Error(w, "Failed to create category: "+err.Error(), http.StatusBadRequest)
			return
		}
		categoryID = newCategory.ID
		log.Printf("Auto-created category: %s (ID: %s)", req.Category, categoryID)

		// Broadcast category creation
		if h.wsHub != nil {
			categoryCreatedMessage := map[string]interface{}{
				"type": "category_created",
				"data": newCategory,
			}
			h.wsHub.BroadcastToAll(categoryCreatedMessage)
		}
	}

	room, err := h.roomService.CreateRoom(req.Name, categoryID, req.MaxUsers, req.Type, req.World)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Resolve category name for the response
	categoryName := ""
	if h.categoryService != nil {
		if category, exists := h.categoryService.GetCategory(room.Category); exists {
			categoryName = category.Name
		}
	}

	// Create response with category name
	roomResponse := map[string]interface{}{
		"id":            room.ID,
		"name":          room.Name,
		"owner_id":      room.OwnerID,
		"max_users":     room.MaxUsers,
		"type":          room.Type,
		"user_count":    room.UserCount,
		"created_at":    room.CreatedAt,
		"category":      room.Category,
		"category_name": categoryName,
		"sort_order":    room.SortOrder,
		"world":         room.World,

		"permissions_synced": room.PermissionsSynced,
	}

	// Broadcast room creation to clients that can see it
	if h.wsHub != nil {
		roomCreatedMessage := map[string]interface{}{
			"type": "room_created",
			"data": roomResponse,
		}
		h.wsHub.BroadcastRoomScoped(room.ID, roomCreatedMessage)
		// Per-room permission maps changed for everyone.
		h.wsHub.BroadcastPermissionsUpdated("room_created")
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, roomResponse)
}

// GetRooms handles GET /api/rooms
func (h *RoomHandler) GetRooms(w http.ResponseWriter, r *http.Request) {
	sub, ok := subjectFromRequest(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Check if preview is requested
	includePreview := r.URL.Query().Get("preview") == "true"

	// Only rooms the user can see (VIEW_ROOM)
	var rooms interface{}
	if includePreview {
		visible := make([]models.RoomPreview, 0)
		for _, room := range h.roomService.GetRoomsWithPreview() {
			if h.permissions.CanInRoom(sub, room.ID, permissions.ViewRoom) {
				visible = append(visible, room)
			}
		}
		rooms = visible
	} else {
		visible := make([]models.Room, 0)
		for _, room := range h.roomService.GetRooms() {
			if h.permissions.CanInRoom(sub, room.ID, permissions.ViewRoom) {
				visible = append(visible, room)
			}
		}
		rooms = visible
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, rooms)
}

// GetRoom handles GET /api/rooms/{id}
func (h *RoomHandler) GetRoom(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

	if _, ok := requireRoomPerm(w, r, h.permissions, roomID, permissions.ViewRoom); !ok {
		return
	}
	room, exists := h.roomService.GetRoom(roomID)
	if !exists {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, room)
}

// GetRoomUsers handles GET /api/rooms/{id}/users
func (h *RoomHandler) GetRoomUsers(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

	if _, ok := requireRoomPerm(w, r, h.permissions, roomID, permissions.ViewRoom); !ok {
		return
	}
	users := h.roomService.GetRoomUsers(roomID)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, users)
}

// JoinRoom handles POST /api/rooms/{id}/join
// Requires authentication (AuthMiddleware): the joined user is always the
// JWT-authenticated user; a user_id in the body that doesn't match is rejected.
func (h *RoomHandler) JoinRoom(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

	claims, ok := r.Context().Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil || claims.UserID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req models.JoinRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Identity comes from the JWT, never from the request body
	if req.UserID != "" && req.UserID != claims.UserID {
		log.Printf("JoinRoom rejected: user_id mismatch (authenticated=%s, requested=%s)", claims.UserID, req.UserID)
		http.Error(w, "user_id does not match authenticated user", http.StatusForbidden)
		return
	}
	req.UserID = claims.UserID

	if _, ok := requireRoomPerm(w, r, h.permissions, roomID, permissions.ViewRoom|permissions.Connect); !ok {
		return
	}
	if room, exists := h.roomService.GetRoom(roomID); exists && room.IsText() {
		http.Error(w, "Text channels cannot be joined", http.StatusBadRequest)
		return
	}

	if req.Nickname == "" {
		if len(req.UserID) >= 8 {
			req.Nickname = "User-" + req.UserID[:8]
		} else {
			req.Nickname = "User-" + req.UserID
		}
	}

	user, previewUser, err := h.roomService.JoinRoom(roomID, req.UserID, req.Nickname)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Broadcast room user joined event to all clients
	if h.wsHub != nil && previewUser != nil {
		roomUserJoinedMessage := map[string]interface{}{
			"type": "room_user_joined",
			"data": map[string]interface{}{
				"room_id": roomID,
				"user":    previewUser,
			},
		}
		h.wsHub.BroadcastRoomScoped(roomID, roomUserJoinedMessage)
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, user)
}

// LeaveRoom handles POST /api/rooms/{id}/leave
// Requires authentication (AuthMiddleware): users can only remove themselves.
func (h *RoomHandler) LeaveRoom(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

	claims, ok := r.Context().Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil || claims.UserID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.UserID != "" && req.UserID != claims.UserID {
		log.Printf("LeaveRoom rejected: user_id mismatch (authenticated=%s, requested=%s)", claims.UserID, req.UserID)
		http.Error(w, "user_id does not match authenticated user", http.StatusForbidden)
		return
	}
	req.UserID = claims.UserID

	leftUser := h.roomService.LeaveRoom(roomID, req.UserID)

	// Remove from LiveKit
	if leftUser != nil && h.livekitService != nil {
		if err := h.livekitService.RemoveParticipant(roomID, req.UserID); err != nil {
			log.Printf("Failed to remove user %s from LiveKit room %s: %v", req.UserID, roomID, err)
		}
	}

	// Broadcast room user left event to clients that can see the room
	if h.wsHub != nil && leftUser != nil {
		roomUserLeftMessage := map[string]interface{}{
			"type": "room_user_left",
			"data": map[string]interface{}{
				"room_id": roomID,
				"user":    leftUser,
			},
		}
		h.wsHub.BroadcastRoomScoped(roomID, roomUserLeftMessage)
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{"status": "success"})
}

// KickUser handles POST /api/rooms/{room_id}/kick/{user_id}
// Requires kick_members in the room and outranking the target.
func (h *RoomHandler) KickUser(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["room_id"]
	userID := vars["user_id"]

	actor, ok := requireRoomPerm(w, r, h.permissions, roomID, permissions.KickMembers)
	if !ok {
		return
	}
	if !h.permissions.CanTarget(actor, h.permissions.SubjectByID(userID)) {
		http.Error(w, "Cannot kick a user with an equal or higher role", http.StatusForbidden)
		return
	}

	if h.wsHub != nil {
		if !h.wsHub.RemoveUserFromRoom(roomID, userID, "kicked") {
			http.Error(w, "User not found in room", http.StatusNotFound)
			return
		}
	} else {
		if h.roomService.KickUser(roomID, userID) == nil {
			http.Error(w, "User not found in room", http.StatusNotFound)
			return
		}
		if h.livekitService != nil {
			if err := h.livekitService.RemoveParticipant(roomID, userID); err != nil {
				log.Printf("Failed to remove user %s from LiveKit room %s: %v", userID, roomID, err)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{"status": "success"})
}

// UpdateRoom handles PUT /api/rooms/{id}
func (h *RoomHandler) UpdateRoom(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

	sub, ok := requireRoomPerm(w, r, h.permissions, roomID, permissions.ManageRooms)
	if !ok {
		return
	}

	var req models.UpdateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if req.Name != "" && !validRoomNameLength(req.Name) {
		http.Error(w, "Room name too long (max 100 characters)", http.StatusBadRequest)
		return
	}

	if req.MaxUsers > 0 && (req.MaxUsers < config.RoomConfig.MinUsers || req.MaxUsers > config.RoomConfig.MaxUsers) {
		http.Error(w, "Max users must be between 2 and 10", http.StatusBadRequest)
		return
	}

	// Get current room to check if category is being changed
	currentRoom, exists := h.roomService.GetRoom(roomID)
	if !exists {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}
	if req.Type != "" && req.Type != currentRoom.Type {
		if !models.ValidRoomType(req.Type) {
			http.Error(w, "Unknown room type", http.StatusBadRequest)
			return
		}
		// Text history would be orphaned (or appear) on a type switch.
		if req.Type == models.RoomTypeText || currentRoom.IsText() {
			http.Error(w, "Cannot convert between text and voice channels", http.StatusBadRequest)
			return
		}
	}

	// Resolve category ID if category name is provided
	categoryID := req.Category
	if categoryID != "" {
		categories := h.categoryService.GetCategories()
		found := false
		for _, cat := range categories {
			if cat.ID == categoryID || cat.Name == categoryID {
				categoryID = cat.ID
				found = true
				break
			}
		}
		if !found {
			http.Error(w, "Category not found", http.StatusBadRequest)
			return
		}
		// Moving into another category needs manage_rooms there too.
		if categoryID != currentRoom.Category && !h.permissions.CategoryPerms(sub, categoryID).Has(permissions.ManageRooms) {
			http.Error(w, "Missing permission in target category", http.StatusForbidden)
			return
		}
	}

	room, err := h.roomService.UpdateRoom(roomID, req.Name, req.MaxUsers, categoryID, req.Type, req.World)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Broadcast room update to clients that can see the room
	if h.wsHub != nil {
		roomUpdatedMessage := map[string]interface{}{
			"type": "room_updated",
			"data": map[string]interface{}{
				"room_id":      roomID,
				"room":         room,
				"old_category": currentRoom.Category,
			},
		}
		h.wsHub.BroadcastRoomScoped(roomID, roomUpdatedMessage)
	}
	// A synced room that changed category inherits different overwrites.
	if room.Category != currentRoom.Category {
		h.permissions.Notify("room_category_changed")
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, room)
}

// DeleteRoom handles DELETE /api/rooms/{id}
func (h *RoomHandler) DeleteRoom(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

	if _, ok := requireRoomPerm(w, r, h.permissions, roomID, permissions.ManageRooms); !ok {
		return
	}

	// Get room info before deletion for the broadcast
	room, exists := h.roomService.GetRoom(roomID)
	if !exists {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}

	err := h.roomService.DeleteRoom(roomID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	h.permissions.ForgetTarget(models.OverwriteTargetRoom, roomID)
	if room.IsText() && h.textChat != nil {
		if err := h.textChat.Store.DeleteRoom(r.Context(), roomID); err != nil {
			log.Printf("Failed to delete messages of text channel %s: %v", roomID, err)
		}
		if err := h.textChat.ReadState.DeleteRoom(roomID); err != nil {
			log.Printf("Failed to delete read state of text channel %s: %v", roomID, err)
		}
	}
	// Disconnect anyone still in the LiveKit room.
	if !room.IsText() && h.livekitService != nil {
		if err := h.livekitService.DeleteRoom(roomID); err != nil {
			log.Printf("Failed to delete LiveKit room %s: %v", roomID, err)
		}
	}

	// Broadcast room deletion to all connected clients
	if h.wsHub != nil {
		roomDeletedMessage := map[string]interface{}{
			"type": "room_deleted",
			"data": map[string]interface{}{
				"room_id":  roomID,
				"category": room.Category,
			},
		}
		h.wsHub.BroadcastToAll(roomDeletedMessage)
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{"status": "success"})
}

// UpdateRoomOrder handles PUT /api/rooms/order
func (h *RoomHandler) UpdateRoomOrder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Orders map[string]int `json:"orders"` // room_id -> sort_order
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if len(req.Orders) == 0 {
		http.Error(w, "No room orders provided", http.StatusBadRequest)
		return
	}

	if err := h.roomService.UpdateRoomSortOrder(req.Orders); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Broadcast room order update to all connected clients
	if h.wsHub != nil {
		h.wsHub.BroadcastRoomOrder(req.Orders)
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{"status": "success"})
}

// RoomConfigResponse represents the room configuration response
type RoomConfigResponse struct {
	MinUsers        int `json:"min_users"`
	MaxUsers        int `json:"max_users"`
	DefaultMaxUsers int `json:"default_max_users"`
}

// AppConfigResponse represents the general application configuration response
type AppConfigResponse struct {
	Room RoomConfigResponse `json:"room"`
	// TextChannels reports whether text channels can be created (Meilisearch configured).
	TextChannels bool `json:"text_channels"`
}

// GetConfig handles GET /api/config
func (h *RoomHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	cfg := AppConfigResponse{
		Room: RoomConfigResponse{
			MinUsers:        config.RoomConfig.MinUsers,
			MaxUsers:        config.RoomConfig.MaxUsers,
			DefaultMaxUsers: config.RoomConfig.DefaultMaxUsers,
		},
		TextChannels: h.textChat != nil,
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, cfg)
}
