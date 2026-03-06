package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/websocket"
)

// UsersHandler handles user-related HTTP requests
type UsersHandler struct {
	userRepo *repository.UserRepository
	hub      *websocket.Hub
}

// NewUsersHandler creates a new users handler
func NewUsersHandler(userRepo *repository.UserRepository, hub *websocket.Hub) *UsersHandler {
	return &UsersHandler{
		userRepo: userRepo,
		hub:      hub,
	}
}

// GetAllUsers returns a list of all users with public information only
// GET /api/users
func (h *UsersHandler) GetAllUsers(w http.ResponseWriter, r *http.Request) {
	// Fetch all users from repository
	users, err := h.userRepo.GetAll()
	if err != nil {
		http.Error(w, "Failed to fetch users", http.StatusInternalServerError)
		return
	}

	// Convert to PublicUser to avoid exposing sensitive data
	// Include online status from WebSocket hub
	publicUsers := make([]*models.PublicUser, 0, len(users))
	for _, user := range users {
		isOnline := false
		if h.hub != nil {
			isOnline = h.hub.IsUserOnline(user.ID)
		}
		soundPack := user.SoundPack
		if soundPack == "" {
			soundPack = "default"
		}
		publicUsers = append(publicUsers, &models.PublicUser{
			ID:        user.ID,
			Nickname:  user.Nickname,
			AvatarURL: user.AvatarURL,
			Role:      user.Role,
			IsOnline:  isOnline,
			SoundPack: soundPack,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(publicUsers)
}

// UpdateSoundPack updates the current user's sound pack preference
// PATCH /api/users/me/sound-pack
func (h *UsersHandler) UpdateSoundPack(w http.ResponseWriter, r *http.Request) {
	// Get user from context (set by auth middleware)
	userID := r.Context().Value("user_id")
	if userID == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	userIDStr, ok := userID.(string)
	if !ok || userIDStr == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse request body
	var req models.UpdateSoundPackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate sound pack
	if req.SoundPack == "" {
		req.SoundPack = "default"
	}

	// Update in database
	if err := h.userRepo.UpdateSoundPack(userIDStr, req.SoundPack); err != nil {
		http.Error(w, "Failed to update sound pack", http.StatusInternalServerError)
		return
	}

	// Broadcast sound pack change to all connected clients via WebSocket
	if h.hub != nil {
		h.hub.BroadcastSoundPackChange(userIDStr, req.SoundPack)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"sound_pack": req.SoundPack,
	})
}
