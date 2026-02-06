package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/orbital/internal/config"
	"github.com/orbital/internal/models"
	"github.com/orbital/internal/service"
	"github.com/orbital/internal/websocket"
)

// RoomHandler handles room-related HTTP requests
type RoomHandler struct {
	roomService     *service.RoomService
	categoryService *service.CategoryService
	wsHub           *websocket.Hub
}

// NewRoomHandler creates a new RoomHandler
func NewRoomHandler(roomService *service.RoomService, categoryService *service.CategoryService, wsHub *websocket.Hub) *RoomHandler {
	return &RoomHandler{
		roomService:     roomService,
		categoryService: categoryService,
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

	if req.MaxUsers < config.RoomConfig.MinUsers || req.MaxUsers > config.RoomConfig.MaxUsers {
		req.MaxUsers = config.RoomConfig.DefaultMaxUsers
	}

	if req.Category == "" {
		req.Category = "general"
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

	room, err := h.roomService.CreateRoom(req.Name, categoryID, req.MaxUsers)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Broadcast room creation to all connected clients
	if h.wsHub != nil {
		roomCreatedMessage := map[string]interface{}{
			"type": "room_created",
			"data": room,
		}
		h.wsHub.BroadcastToAll(roomCreatedMessage)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(room)
}

// GetRooms handles GET /api/rooms
func (h *RoomHandler) GetRooms(w http.ResponseWriter, r *http.Request) {
	// Check if preview is requested
	includePreview := r.URL.Query().Get("preview") == "true"

	var rooms interface{}
	if includePreview {
		rooms = h.roomService.GetRoomsWithPreview()
	} else {
		rooms = h.roomService.GetRooms()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rooms)
}

// GetRoom handles GET /api/rooms/{id}
func (h *RoomHandler) GetRoom(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

	room, exists := h.roomService.GetRoom(roomID)
	if !exists {
		http.Error(w, "Room not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(room)
}

// GetRoomUsers handles GET /api/rooms/{id}/users
func (h *RoomHandler) GetRoomUsers(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

	users := h.roomService.GetRoomUsers(roomID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

// JoinRoom handles POST /api/rooms/{id}/join
func (h *RoomHandler) JoinRoom(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

	var req models.JoinRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if req.UserID == "" {
		req.UserID = generateUserID()
	}
	if req.Nickname == "" {
		req.Nickname = "User-" + req.UserID[:8]
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
		h.wsHub.BroadcastToAll(roomUserJoinedMessage)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// LeaveRoom handles POST /api/rooms/{id}/leave
func (h *RoomHandler) LeaveRoom(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	leftUser := h.roomService.LeaveRoom(roomID, req.UserID)

	// Broadcast room user left event to all clients
	if h.wsHub != nil && leftUser != nil {
		roomUserLeftMessage := map[string]interface{}{
			"type": "room_user_left",
			"data": map[string]interface{}{
				"room_id": roomID,
				"user":    leftUser,
			},
		}
		h.wsHub.BroadcastToAll(roomUserLeftMessage)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// UpdateRoom handles PUT /api/rooms/{id}
func (h *RoomHandler) UpdateRoom(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

	var req models.UpdateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if req.Name != "" && len(req.Name) > 100 {
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
	}

	room, err := h.roomService.UpdateRoom(roomID, req.Name, req.MaxUsers, categoryID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Broadcast room update to all connected clients
	if h.wsHub != nil {
		roomUpdatedMessage := map[string]interface{}{
			"type": "room_updated",
			"data": map[string]interface{}{
				"room_id":      roomID,
				"room":         room,
				"old_category": currentRoom.Category,
			},
		}
		h.wsHub.BroadcastToAll(roomUpdatedMessage)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(room)
}

// DeleteRoom handles DELETE /api/rooms/{id}
func (h *RoomHandler) DeleteRoom(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	roomID := vars["id"]

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
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
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
		roomOrderUpdatedMessage := map[string]interface{}{
			"type": "room_order_updated",
			"data": map[string]interface{}{
				"orders": req.Orders,
			},
		}
		h.wsHub.BroadcastToAll(roomOrderUpdatedMessage)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// generateUserID generates a unique user ID
func generateUserID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}
