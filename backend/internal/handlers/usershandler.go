package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

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
	publicUsers := make([]models.PublicUser, 0, len(users))
	for _, user := range users {
		isOnline := false
		if h.hub != nil {
			isOnline = h.hub.IsUserOnline(user.ID)
		}
		publicUsers = append(publicUsers, models.NewPublicUser(user, isOnline))
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, publicUsers)
}

// UpdateSoundPack updates the current user's sound pack preference
// PATCH /api/users/me/sound-pack
func (h *UsersHandler) UpdateSoundPack(w http.ResponseWriter, r *http.Request) {
	// Get user from context (set by auth middleware)
	claims, ok := r.Context().Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	userIDStr := claims.UserID

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
	writeJSON(w, map[string]string{
		"sound_pack": req.SoundPack,
	})
}

// UpdateCustomStatus updates the current user's custom status text
// PATCH /api/users/me/custom-status
func (h *UsersHandler) UpdateCustomStatus(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req models.UpdateCustomStatusRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	customStatus := normalizeCustomStatus(req.CustomStatus)
	if utf8.RuneCountInString(customStatus) > models.MaxCustomStatusLength {
		http.Error(w, "Custom status is too long", http.StatusBadRequest)
		return
	}

	if err := h.userRepo.UpdateCustomStatus(claims.UserID, customStatus); err != nil {
		http.Error(w, "Failed to update custom status", http.StatusInternalServerError)
		return
	}

	if h.hub != nil {
		h.hub.BroadcastCustomStatusChange(claims.UserID, customStatus)
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{
		"custom_status": customStatus,
	})
}

// normalizeCustomStatus collapses the status to a single trimmed line:
// newlines/tabs become spaces and other control characters are dropped.
func normalizeCustomStatus(s string) string {
	cleaned := strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return ' '
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	return strings.TrimSpace(cleaned)
}
