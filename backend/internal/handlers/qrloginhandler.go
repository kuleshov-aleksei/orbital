package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// QRLoginHandler serves the single-use QR device-linking endpoints.
// Challenge creation and claiming are unauthenticated by design (the new
// device has no session yet); reading a challenge and approving it require a
// logged-in, non-guest session via AuthMiddleware.
type QRLoginHandler struct {
	qr      *service.QRLoginService
	limiter *qrRateLimiter
}

// NewQRLoginHandler creates a new QR login handler
func NewQRLoginHandler(qr *service.QRLoginService) *QRLoginHandler {
	return &QRLoginHandler{qr: qr, limiter: newQRRateLimiter()}
}

// qrChallengeView is the scanner-safe projection of a challenge: the sealed
// payload is never exposed here, only via the claim endpoint. The public key
// is included so the scanning device can verify it matches the QR code.
type qrChallengeView struct {
	ChallengeID string    `json:"challenge_id"`
	PublicKey   string    `json:"public_key"`
	DeviceName  string    `json:"device_name"`
	DeviceInfo  string    `json:"device_info"`
	Status      string    `json:"status"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// CreateChallenge registers a pending challenge for the new device
func (h *QRLoginHandler) CreateChallenge(w http.ResponseWriter, r *http.Request) {
	if !h.limiter.allow(qrClientIP(r), 10, time.Minute) {
		http.Error(w, "Too many requests", http.StatusTooManyRequests)
		return
	}

	var req models.CreateQRChallengeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	ch, err := h.qr.CreateChallenge(req.PublicKey, req.DeviceName, req.DeviceInfo)
	if err != nil {
		if errors.Is(err, service.ErrQRInvalidPublicKey) {
			http.Error(w, "Invalid public key", http.StatusBadRequest)
			return
		}
		http.Error(w, "Failed to create challenge", http.StatusInternalServerError)
		return
	}

	writeQRJSON(w, http.StatusOK, models.CreateQRChallengeResponse{
		ChallengeID: ch.ID,
		ExpiresAt:   ch.ExpiresAt,
	})
}

// GetChallenge returns challenge metadata for the scanning device
func (h *QRLoginHandler) GetChallenge(w http.ResponseWriter, r *http.Request) {
	ch, err := h.qr.GetChallenge(mux.Vars(r)["id"])
	if err != nil {
		writeQRError(w, err)
		return
	}

	writeQRJSON(w, http.StatusOK, qrChallengeView{
		ChallengeID: ch.ID,
		PublicKey:   ch.PublicKey,
		DeviceName:  ch.DeviceName,
		DeviceInfo:  ch.DeviceInfo,
		Status:      ch.Status,
		ExpiresAt:   ch.ExpiresAt,
	})
}

// ApproveChallenge seals a fresh session token to the challenge key.
// Guests are rejected: device linking is for real accounts only.
func (h *QRLoginHandler) ApproveChallenge(w http.ResponseWriter, r *http.Request) {
	if !h.limiter.allow(qrClientIP(r), 30, time.Minute) {
		http.Error(w, "Too many requests", http.StatusTooManyRequests)
		return
	}

	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req models.ApproveQRChallengeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	user, err := h.qr.ApproveUserLookup(claims.UserID)
	if err != nil || user == nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	if err := h.qr.ApproveChallenge(req.ChallengeID, req.PublicKey, user); err != nil {
		writeQRError(w, err)
		return
	}

	writeQRJSON(w, http.StatusOK, map[string]string{"status": models.QRLoginChallengeApproved})
}

// ClaimChallenge is polled by the new device. Pending challenges answer 202
// (keep polling); an approved one is atomically consumed and answered once.
func (h *QRLoginHandler) ClaimChallenge(w http.ResponseWriter, r *http.Request) {
	var req models.ClaimQRChallengeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	status, sealed, err := h.qr.ClaimChallenge(req.ChallengeID)
	if err != nil {
		if errors.Is(err, service.ErrQRChallengePending) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusAccepted)
			json.NewEncoder(w).Encode(models.ClaimQRChallengeResponse{
				Status: models.QRLoginChallengePending,
			})
			return
		}
		writeQRError(w, err)
		return
	}

	writeQRJSON(w, http.StatusOK, models.ClaimQRChallengeResponse{
		Status:        status,
		SealedPayload: sealed,
	})
}

// writeQRError maps service errors to HTTP statuses
func writeQRError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrQRChallengeNotFound):
		http.Error(w, "Challenge not found", http.StatusNotFound)
	case errors.Is(err, service.ErrQRChallengeExpired):
		http.Error(w, "Challenge expired", http.StatusGone)
	case errors.Is(err, service.ErrQRChallengeAlreadyUsed):
		http.Error(w, "Challenge already used", http.StatusConflict)
	case errors.Is(err, service.ErrQRGuestNotAllowed):
		http.Error(w, "Guests cannot approve device linking", http.StatusForbidden)
	case errors.Is(err, service.ErrQRInvalidPublicKey):
		http.Error(w, "Invalid public key", http.StatusBadRequest)
	case errors.Is(err, service.ErrQRPublicKeyMismatch):
		http.Error(w, "Public key does not match challenge", http.StatusBadRequest)
	default:
		http.Error(w, "Internal server error", http.StatusInternalServerError)
	}
}

// writeQRJSON encodes a response with no-store semantics: nothing here may
// end up in an intermediary cache
func writeQRJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// qrClientIP prefers the first X-Forwarded-For entry (nginx) and falls back
// to the direct peer address
func qrClientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if first, _, _ := strings.Cut(fwd, ","); strings.TrimSpace(first) != "" {
			return strings.TrimSpace(first)
		}
	}
	return r.RemoteAddr
}

// qrRateLimiter is a small in-memory fixed-window limiter keyed by client IP
type qrRateLimiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

func newQRRateLimiter() *qrRateLimiter {
	return &qrRateLimiter{hits: make(map[string][]time.Time)}
}

// allow reports whether a request fits within max events per window
func (l *qrRateLimiter) allow(key string, max int, window time.Duration) bool {
	now := time.Now()
	cutoff := now.Add(-window)

	l.mu.Lock()
	defer l.mu.Unlock()

	recent := l.hits[key][:0]
	for _, ts := range l.hits[key] {
		if ts.After(cutoff) {
			recent = append(recent, ts)
		}
	}

	if len(recent) >= max {
		l.hits[key] = recent
		return false
	}

	l.hits[key] = append(recent, now)

	// Bound memory: drop the keyspace shard when it grows without bound
	if len(l.hits) > 10000 {
		l.hits = make(map[string][]time.Time)
	}

	return true
}
