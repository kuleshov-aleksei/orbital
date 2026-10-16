package service

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/nacl/box"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
)

var (
	// ErrQRChallengeNotFound is returned when the challenge id is unknown
	ErrQRChallengeNotFound = errors.New("qr challenge not found")
	// ErrQRChallengeExpired is returned when the challenge ran past its TTL
	ErrQRChallengeExpired = errors.New("qr challenge expired")
	// ErrQRChallengeAlreadyUsed is returned when the challenge was already
	// approved or consumed by someone else
	ErrQRChallengeAlreadyUsed = errors.New("qr challenge already used")
	// ErrQRChallengePending is returned when polling a challenge that has not
	// been approved yet (not a failure, just "keep waiting")
	ErrQRChallengePending = errors.New("qr challenge not approved yet")
	// ErrQRPublicKeyMismatch is returned when the approving device presents a
	// different public key than the one the new device registered
	ErrQRPublicKeyMismatch = errors.New("qr public key mismatch")
	// ErrQRGuestNotAllowed is returned when a guest account tries to approve
	ErrQRGuestNotAllowed = errors.New("guests cannot approve qr login")
	// ErrQRInvalidPublicKey is returned when the public key is not a valid
	// base64-encoded 32-byte X25519 key
	ErrQRInvalidPublicKey = errors.New("invalid qr public key")
)

// QRLoginChallengeTTL bounds how long a displayed QR code stays valid
const QRLoginChallengeTTL = 2 * time.Minute

// QRLoginCleanupGrace keeps expired rows briefly so polling clients still get
// a deterministic "expired" answer instead of "not found"
const QRLoginCleanupGrace = 10 * time.Minute

const (
	qrChallengeIDBytes  = 32
	qrMaxDeviceNameLen  = 120
	qrMaxDeviceInfoLen  = 8192
	qrMaxChallengeIDLen = 128
)

// QRLoginService orchestrates single-use QR device-linking handshakes
type QRLoginService struct {
	repo *repository.QRLoginRepository
	auth *AuthService
}

// NewQRLoginService creates a new QR login service
func NewQRLoginService(repo *repository.QRLoginRepository, auth *AuthService) *QRLoginService {
	return &QRLoginService{repo: repo, auth: auth}
}

// CreateChallenge registers a new pending challenge for the given ephemeral
// public key. The returned challenge id is public and safe to embed in a QR
// code; only the holder of the matching private key can use the result.
func (s *QRLoginService) CreateChallenge(publicKeyB64, deviceName, deviceInfo string) (*models.QRLoginChallenge, error) {
	pub, err := parseQRLoginPublicKey(publicKeyB64)
	if err != nil {
		return nil, err
	}

	id, err := randomChallengeID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate challenge id: %w", err)
	}

	now := time.Now().UTC()
	ch := &models.QRLoginChallenge{
		ID:         id,
		PublicKey:  base64.StdEncoding.EncodeToString(pub[:]),
		DeviceName: truncateQRString(strings.TrimSpace(deviceName), qrMaxDeviceNameLen),
		DeviceInfo: truncateQRString(deviceInfo, qrMaxDeviceInfoLen),
		Status:     models.QRLoginChallengePending,
		CreatedAt:  now,
		ExpiresAt:  now.Add(QRLoginChallengeTTL),
	}

	if err := s.repo.Create(ch); err != nil {
		return nil, fmt.Errorf("failed to store qr challenge: %w", err)
	}

	return ch, nil
}

// GetChallenge returns a challenge for the scanning device. The sealed
// payload is never exposed here; it is only delivered via ClaimChallenge.
func (s *QRLoginService) GetChallenge(id string) (*models.QRLoginChallenge, error) {
	ch, err := s.lookupUsable(id)
	if err != nil {
		return nil, err
	}

	// Hide fields the scanner must never see
	ch.SealedPayload = ""
	return ch, nil
}

// ApproveChallenge seals a fresh session token for the approving user to the
// challenge's public key and marks the challenge approved. The plaintext is
// wiped before returning; the server never persists it.
func (s *QRLoginService) ApproveChallenge(id, publicKeyB64 string, user *models.User) error {
	if user == nil {
		return fmt.Errorf("approving user is required")
	}
	if user.IsGuest {
		return ErrQRGuestNotAllowed
	}

	pub, err := parseQRLoginPublicKey(publicKeyB64)
	if err != nil {
		return err
	}

	ch, err := s.repo.GetByID(id)
	if err != nil {
		return fmt.Errorf("failed to load qr challenge: %w", err)
	}
	if ch == nil {
		return ErrQRChallengeNotFound
	}
	if time.Now().UTC().After(ch.ExpiresAt) {
		_ = s.repo.MarkExpired(id)
		return ErrQRChallengeExpired
	}
	if ch.Status != models.QRLoginChallengePending {
		return ErrQRChallengeAlreadyUsed
	}
	if ch.PublicKey != base64.StdEncoding.EncodeToString(pub[:]) {
		return ErrQRPublicKeyMismatch
	}

	token, expiry, err := s.auth.GenerateJWT(user)
	if err != nil {
		return fmt.Errorf("failed to generate token: %w", err)
	}

	plaintext, err := json.Marshal(models.AuthResponse{
		Token:     token,
		User:      *user,
		ExpiresAt: expiry,
	})
	if err != nil {
		return fmt.Errorf("failed to encode auth response: %w", err)
	}

	sealed, err := SealForPublicKey(ch.PublicKey, plaintext)
	wipeBytes(plaintext)
	if err != nil {
		return err
	}

	ok, err := s.repo.Approve(id, ch.PublicKey, user.ID, sealed, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("failed to approve qr challenge: %w", err)
	}
	if !ok {
		// Lost a race with another approve/consume: single-use invariant holds
		return ErrQRChallengeAlreadyUsed
	}

	return nil
}

// ClaimChallenge is polled by the new device. A pending challenge reports
// ErrQRChallengePending (keep polling); an approved one is atomically
// consumed and its sealed payload returned exactly once.
func (s *QRLoginService) ClaimChallenge(id string) (status string, sealedPayload string, err error) {
	ch, err := s.repo.GetByID(id)
	if err != nil {
		return "", "", fmt.Errorf("failed to load qr challenge: %w", err)
	}
	if ch == nil {
		return "", "", ErrQRChallengeNotFound
	}

	now := time.Now().UTC()
	if now.After(ch.ExpiresAt) {
		_ = s.repo.MarkExpired(id)
		return "", "", ErrQRChallengeExpired
	}

	switch ch.Status {
	case models.QRLoginChallengePending:
		return models.QRLoginChallengePending, "", ErrQRChallengePending
	case models.QRLoginChallengeApproved:
		ok, err := s.repo.Consume(id, now)
		if err != nil {
			return "", "", fmt.Errorf("failed to consume qr challenge: %w", err)
		}
		if !ok {
			return "", "", ErrQRChallengeAlreadyUsed
		}
		return models.QRLoginChallengeApproved, ch.SealedPayload, nil
	default:
		return "", "", ErrQRChallengeAlreadyUsed
	}
}

// ApproveUserLookup fetches fresh user data for an approving session so the
// sealed token reflects current nickname/role/avatar instead of stale claims
func (s *QRLoginService) ApproveUserLookup(userID string) (*models.User, error) {
	return s.auth.GetUserByID(userID)
}

// CleanupExpired deletes challenges that expired longer than the grace period
// ago and returns the number of deleted rows
func (s *QRLoginService) CleanupExpired() (int64, error) {
	return s.repo.DeleteExpired(time.Now().UTC().Add(-QRLoginCleanupGrace))
}

// StartCleanupLoop periodically deletes expired challenges until the process
// exits. Callers should run it in a goroutine.
func (s *QRLoginService) StartCleanupLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for range ticker.C {
		if n, err := s.CleanupExpired(); err != nil {
			fmt.Printf("[QRLogin] cleanup failed: %v\n", err)
		} else if n > 0 {
			fmt.Printf("[QRLogin] cleaned up %d expired challenges\n", n)
		}
	}
}

// SealForPublicKey seals plaintext for the given base64-encoded X25519 public
// key using an anonymous sealed box (libsodium crypto_box_seal compatible)
func SealForPublicKey(publicKeyB64 string, plaintext []byte) (string, error) {
	pub, err := parseQRLoginPublicKey(publicKeyB64)
	if err != nil {
		return "", err
	}

	sealed, err := box.SealAnonymous(nil, plaintext, pub, rand.Reader)
	if err != nil {
		return "", fmt.Errorf("failed to seal payload: %w", err)
	}

	return base64.StdEncoding.EncodeToString(sealed), nil
}

// parseQRLoginPublicKey decodes a base64 (standard or URL-safe) 32-byte
// X25519 public key
func parseQRLoginPublicKey(publicKeyB64 string) (*[32]byte, error) {
	raw := strings.TrimSpace(publicKeyB64)
	if raw == "" {
		return nil, ErrQRInvalidPublicKey
	}

	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		decoded, err = base64.RawURLEncoding.DecodeString(raw)
		if err != nil {
			decoded, err = base64.URLEncoding.DecodeString(raw)
			if err != nil {
				return nil, ErrQRInvalidPublicKey
			}
		}
	}

	if len(decoded) != 32 {
		return nil, ErrQRInvalidPublicKey
	}

	var pub [32]byte
	copy(pub[:], decoded)
	return &pub, nil
}

// lookupUsable loads a challenge that a scanning device may still act on
func (s *QRLoginService) lookupUsable(id string) (*models.QRLoginChallenge, error) {
	if len(id) == 0 || len(id) > qrMaxChallengeIDLen {
		return nil, ErrQRChallengeNotFound
	}

	ch, err := s.repo.GetByID(id)
	if err != nil {
		return nil, fmt.Errorf("failed to load qr challenge: %w", err)
	}
	if ch == nil {
		return nil, ErrQRChallengeNotFound
	}

	if time.Now().UTC().After(ch.ExpiresAt) {
		_ = s.repo.MarkExpired(id)
		return nil, ErrQRChallengeExpired
	}
	if ch.Status == models.QRLoginChallengeConsumed || ch.Status == models.QRLoginChallengeExpired {
		return nil, ErrQRChallengeAlreadyUsed
	}

	return ch, nil
}

// randomChallengeID returns a 256-bit unguessable challenge id
func randomChallengeID() (string, error) {
	b := make([]byte, qrChallengeIDBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// truncateQRString caps attacker-controlled metadata lengths
func truncateQRString(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

// wipeBytes zeroes a buffer holding secrets (best effort)
func wipeBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
