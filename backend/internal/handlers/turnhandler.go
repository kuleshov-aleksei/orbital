package handlers

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
)

// TURNHandler handles TURN server configuration requests
type TURNHandler struct {
	config *config.TURNConfig
}

// NewTURNHandler creates a new TURN handler with the provided configuration
func NewTURNHandler(cfg *config.Config) *TURNHandler {
	return &TURNHandler{
		config: cfg.GetTURNConfig(),
	}
}

// ICEServer represents a single ICE server configuration
type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// TURNConfigResponse represents the response for TURN configuration
type TURNConfigResponse struct {
	ICEServers []ICEServer `json:"ice_servers"`
	TTL        int         `json:"ttl"`
}

// GetTURNConfig handles requests for TURN server configuration
func (h *TURNHandler) GetTURNConfig(w http.ResponseWriter, r *http.Request) {
	// Get user ID from query parameter or generate one
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "anonymous"
	}

	// Generate time-limited credentials
	username, credential := h.generateCredentials(userID)

	// Build ICE servers array
	iceServers := []ICEServer{}

	// Add STUN servers (no auth required)
	for _, stunURL := range h.config.GetSTUNServers() {
		iceServers = append(iceServers, ICEServer{
			URLs: []string{stunURL},
		})
	}

	// Add TURN server (with auth)
	iceServers = append(iceServers, ICEServer{
		URLs:       []string{h.config.TURNURL},
		Username:   username,
		Credential: credential,
	})

	// Add TURNS (TLS) server if configured
	if h.config.TURNTLSURL != "" {
		iceServers = append(iceServers, ICEServer{
			URLs:       []string{h.config.TURNTLSURL},
			Username:   username,
			Credential: credential,
		})
	}

	response := TURNConfigResponse{
		ICEServers: iceServers,
		TTL:        h.config.CredentialLifetime,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(response)
}

// generateCredentials generates time-limited TURN credentials using HMAC-SHA1
// Format: username = "timestamp:user_id", credential = base64(hmac-sha1(shared_secret, username))
func (h *TURNHandler) generateCredentials(userID string) (username, credential string) {
	// Calculate expiry timestamp (current time + lifetime)
	expiryTimestamp := time.Now().Unix() + int64(h.config.CredentialLifetime)

	// Create username: "timestamp:user_id"
	username = fmt.Sprintf("%d:%s", expiryTimestamp, userID)

	// Generate HMAC-SHA1
	mac := hmac.New(sha1.New, []byte(h.config.SharedSecret))
	mac.Write([]byte(username))
	hash := mac.Sum(nil)

	// Base64 encode
	credential = base64.StdEncoding.EncodeToString(hash)

	return username, credential
}

// ValidateTURNCredentials validates if the provided credentials are still valid
// This can be used by the backend to verify credentials if needed
func (h *TURNHandler) ValidateTURNCredentials(username, credential string) bool {
	// Parse username to extract timestamp
	parts := make([]string, 0)
	for i, c := range username {
		if c == ':' {
			parts = append(parts, username[:i])
			parts = append(parts, username[i+1:])
			break
		}
	}

	if len(parts) != 2 {
		return false
	}

	timestamp, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return false
	}

	// Check if credentials have expired
	if time.Now().Unix() > timestamp {
		return false
	}

	// Regenerate credential and compare
	mac := hmac.New(sha1.New, []byte(h.config.SharedSecret))
	mac.Write([]byte(username))
	expectedHash := mac.Sum(nil)
	expectedCredential := base64.StdEncoding.EncodeToString(expectedHash)

	return credential == expectedCredential
}
