package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

// UsersHandler handles user-related HTTP requests
type UsersHandler struct {
	userRepo *repository.UserRepository
}

// NewUsersHandler creates a new users handler
func NewUsersHandler(userRepo *repository.UserRepository) *UsersHandler {
	return &UsersHandler{
		userRepo: userRepo,
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
	publicUsers := make([]*models.PublicUser, 0, len(users))
	for _, user := range users {
		publicUsers = append(publicUsers, &models.PublicUser{
			ID:        user.ID,
			Nickname:  user.Nickname,
			AvatarURL: user.AvatarURL,
			Role:      user.Role,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(publicUsers)
}
