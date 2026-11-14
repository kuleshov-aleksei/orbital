package handlers

import (
	"encoding/json"
	"log"
	"net/http"
)

// PushDeviceStore stores push tokens (repository.PushDeviceRepository).
type PushDeviceStore interface {
	Upsert(token, userID, platform string) error
	DeleteForUser(userID, token string) error
}

// PushHandler registers mobile devices for push notifications.
type PushHandler struct {
	devices PushDeviceStore
}

func NewPushHandler(devices PushDeviceStore) *PushHandler {
	return &PushHandler{devices: devices}
}

// maxPushTokenLen bounds FCM registration tokens (~160-250 chars today).
const maxPushTokenLen = 4096

type pushDeviceRequest struct {
	Token    string `json:"token"`
	Platform string `json:"platform"`
}

func decodePushDevice(w http.ResponseWriter, r *http.Request) (pushDeviceRequest, bool) {
	var req pushDeviceRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return req, false
	}
	if req.Token == "" || len(req.Token) > maxPushTokenLen {
		http.Error(w, "token is required", http.StatusBadRequest)
		return req, false
	}
	return req, true
}

// RegisterDevice handles POST /api/push/devices {token, platform}.
func (h *PushHandler) RegisterDevice(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	req, ok := decodePushDevice(w, r)
	if !ok {
		return
	}
	if req.Platform != "android" {
		http.Error(w, "platform must be android", http.StatusBadRequest)
		return
	}
	if err := h.devices.Upsert(req.Token, userID, req.Platform); err != nil {
		log.Printf("[Push] Failed to register device of %s: %v", userID, err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// UnregisterDevice handles DELETE /api/push/devices {token} (logout).
func (h *PushHandler) UnregisterDevice(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	req, ok := decodePushDevice(w, r)
	if !ok {
		return
	}
	if err := h.devices.DeleteForUser(userID, req.Token); err != nil {
		log.Printf("[Push] Failed to unregister device of %s: %v", userID, err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
