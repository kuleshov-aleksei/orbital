package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/orbital/internal/models"
	"github.com/orbital/internal/service"
	"github.com/orbital/internal/websocket"
)

// RoomHandler handles room-related HTTP requests
type RoomHandler struct {
	roomService *service.RoomService
	wsHub       *websocket.Hub
}

// NewRoomHandler creates a new RoomHandler
func NewRoomHandler(roomService *service.RoomService, wsHub *websocket.Hub) *RoomHandler {
	return &RoomHandler{
		roomService: roomService,
		wsHub:       wsHub,
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

	if req.MaxUsers < 2 || req.MaxUsers > 10 {
		req.MaxUsers = 10
	}

	if req.Category == "" {
		req.Category = "General"
	}

	room, err := h.roomService.CreateRoom(req.Name, req.Category, req.MaxUsers)
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
	rooms := h.roomService.GetRooms()

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

	user, err := h.roomService.JoinRoom(roomID, req.UserID, req.Nickname)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
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

	h.roomService.LeaveRoom(roomID, req.UserID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// generateUserID generates a unique user ID
func generateUserID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}
