package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// LiveKitHandler handles LiveKit-related HTTP requests
type LiveKitHandler struct {
	livekitService *service.LiveKitService
}

// NewLiveKitHandler creates a new LiveKit handler
func NewLiveKitHandler(livekitService *service.LiveKitService) *LiveKitHandler {
	return &LiveKitHandler{
		livekitService: livekitService,
	}
}

// TokenRequest represents a request to generate a LiveKit token
type TokenRequest struct {
	RoomID string `json:"room_id"`
}

// TokenResponse represents the response containing the LiveKit token
type TokenResponse struct {
	Token   string `json:"token"`
	RoomURL string `json:"room_url"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error string `json:"error"`
}

// GenerateToken handles POST /api/livekit/token
// Generates a LiveKit access token for the authenticated user to join a room
func (h *LiveKitHandler) GenerateToken(w http.ResponseWriter, r *http.Request) {
	// Check if LiveKit service is available
	if h.livekitService == nil || !h.livekitService.IsHealthy() {
		h.sendError(w, "LiveKit service is not available", http.StatusServiceUnavailable)
		return
	}

	// Get user claims from context (set by AuthMiddleware)
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		h.sendError(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Parse request body
	var req TokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate room_id
	if req.RoomID == "" {
		h.sendError(w, "room_id is required", http.StatusBadRequest)
		return
	}

	// Generate token using JWT claims
	token, err := h.livekitService.GenerateTokenFromJWTClaims(claims, req.RoomID)
	if err != nil {
		log.Printf("[LiveKitHandler] Failed to generate token: %v", err)
		h.sendError(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	// Get LiveKit WebSocket URL from config
	roomURL := h.livekitService.GetConfig().URL

	// Send successful response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(TokenResponse{
		Token:   token,
		RoomURL: roomURL,
	})

	log.Printf("[LiveKitHandler] Token generated for user %s to join room %s", claims.UserID, req.RoomID)
}

// HealthCheck handles GET /api/livekit/health
// Returns the health status of the LiveKit service
func (h *LiveKitHandler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	isHealthy := h.livekitService != nil && h.livekitService.IsHealthy()

	w.Header().Set("Content-Type", "application/json")
	if isHealthy {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "healthy",
			"service": "livekit",
		})
	} else {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "unhealthy",
			"service": "livekit",
		})
	}
}

// sendError sends an error response
func (h *LiveKitHandler) sendError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(ErrorResponse{Error: message})
}
