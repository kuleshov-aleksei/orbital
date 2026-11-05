package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gorilla/mux"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/ratelimit"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// QRLoginHandler serves the single-use QR device-linking endpoints.
// Challenge creation and claiming are unauthenticated by design (the new
// device has no session yet); reading a challenge and approving it require a
// logged-in, non-guest session via AuthMiddleware.
type QRLoginHandler struct {
	qr             *service.QRLoginService
	limiter        *ratelimit.Limiter
	challengeLimit int
	approveLimit   int
}

// NewQRLoginHandler creates a new QR login handler
func NewQRLoginHandler(qr *service.QRLoginService, challengeLimit, approveLimit int) *QRLoginHandler {
	return &QRLoginHandler{
		qr:             qr,
		limiter:        ratelimit.New(),
		challengeLimit: challengeLimit,
		approveLimit:   approveLimit,
	}
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
	if allowed, retryAfter := h.limiter.Allow("qr-challenge:"+ratelimit.ClientIP(r), h.challengeLimit, time.Minute); !allowed {
		ratelimit.WriteTooManyRequests(w, retryAfter)
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
	if allowed, retryAfter := h.limiter.Allow("qr-approve:"+ratelimit.ClientIP(r), h.approveLimit, time.Minute); !allowed {
		ratelimit.WriteTooManyRequests(w, retryAfter)
		return
	}

	claims, ok := r.Context().Value(userContextKey).(*models.JWTClaims)
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
			// Poll responses must never be cached: a cached 202 would mask the
			// later 200 that carries the sealed payload.
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusAccepted)
			writeJSON(w, models.ClaimQRChallengeResponse{
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
	writeJSON(w, v)
}
