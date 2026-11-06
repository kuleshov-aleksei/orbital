package handlers

import (
	"encoding/json"
	"errors"
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

	emoji := strings.TrimSpace(req.CustomStatusEmoji)
	if err := validateStatusEmoji(emoji); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.userRepo.UpdateCustomStatus(claims.UserID, customStatus, emoji); err != nil {
		http.Error(w, "Failed to update custom status", http.StatusInternalServerError)
		return
	}

	result := models.CustomStatusResponse{
		UserID:            claims.UserID,
		CustomStatus:      customStatus,
		CustomStatusEmoji: emoji,
	}
	if h.hub != nil {
		h.hub.BroadcastCustomStatusChange(result)
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, result)
}

// Emoji references are stored as opaque strings so new kinds can be added later:
//   - unicode emoji: the emoji itself, e.g. "🎮" or "👍🏽"
//   - custom emoji:  "custom:<id>" (reserved; rejected until custom emojis exist)
const (
	customEmojiPrefix    = "custom:"
	maxStatusEmojiBytes  = 32 // fits long ZWJ sequences (families, flags with tags)
	maxStatusEmojiRunes  = 12
	combiningKeycapRune  = '\u20E3'
	regionalIndicatorMin = '\U0001F1E6'
	regionalIndicatorMax = '\U0001F1FF'
)

var errUnsupportedEmoji = errors.New("unsupported status emoji")

// validateStatusEmoji accepts an empty string (no emoji) or a single unicode emoji.
// It is deliberately loose: it rejects plain text/whitespace, not every non-emoji symbol.
func validateStatusEmoji(emoji string) error {
	if emoji == "" {
		return nil
	}
	if strings.HasPrefix(emoji, customEmojiPrefix) {
		// Extension point: look the id up in a custom emoji repository here.
		return errors.New("custom emojis are not supported yet")
	}
	if len(emoji) > maxStatusEmojiBytes || utf8.RuneCountInString(emoji) > maxStatusEmojiRunes {
		return errUnsupportedEmoji
	}
	hasSymbol := false
	for _, r := range emoji {
		if unicode.IsSpace(r) || unicode.IsControl(r) || unicode.IsLetter(r) {
			return errUnsupportedEmoji
		}
		if unicode.Is(unicode.So, r) || r == combiningKeycapRune ||
			(r >= regionalIndicatorMin && r <= regionalIndicatorMax) {
			hasSymbol = true
		}
	}
	if !hasSymbol {
		return errUnsupportedEmoji
	}
	return nil
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
