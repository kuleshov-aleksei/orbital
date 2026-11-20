package handlers

import (
	"net/http"

	"github.com/kuleshov-aleksei/orbital/internal/config"
)

// GIFSearchHandler serves the client configuration of third-party GIF search
// (docs/specs/CHAT_SYSTEM.md §7.17). The search itself runs in the browser:
// the providers forbid proxying their API, and their media must be loaded
// from the end-user client, so the server only hands out the client key.
type GIFSearchHandler struct {
	cfg config.ChatConfig
}

func NewGIFSearchHandler(cfg config.ChatConfig) *GIFSearchHandler {
	return &GIFSearchHandler{cfg: cfg}
}

// GIFSearchConfig is the body of GET /api/chat/gif-config.
type GIFSearchConfig struct {
	Provider string `json:"provider"`
	APIKey   string `json:"api_key"`
	Rating   string `json:"rating"`
}

// Get handles GET /api/chat/gif-config (authenticated). It answers 404 when
// GIF search is not configured, so the client can hide the picker.
func (h *GIFSearchHandler) Get(w http.ResponseWriter, _ *http.Request) {
	if !h.cfg.GIFSearchEnabled() {
		sendJSONError(w, "GIF search is disabled", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, GIFSearchConfig{
		Provider: h.cfg.GIFProvider,
		APIKey:   h.cfg.GIFAPIKey,
		Rating:   h.cfg.GIFRating,
	})
}
