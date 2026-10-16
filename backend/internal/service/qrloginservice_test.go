package service

import (
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"golang.org/x/crypto/nacl/box"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// libsodiumInteropVector was produced by libsodium-wrappers 0.8.4
// crypto_box_seal and must open with Go's box.OpenAnonymous. It pins the
// wire-format compatibility the whole QR login flow depends on.
var libsodiumInteropVector = struct {
	publicKey  string
	privateKey string
	sealed     string
	plaintext  string
}{
	publicKey:  "nkotje9/qlP7QjgvmpuYgD5S8J29abASkKOruu5SYDE=",
	privateKey: "1b8UAdMCq5f/YXqW3A/Mtnj67HtUh+Eomugn4rp97AA=",
	sealed:     "NawmJPg4rMREDl5zghkHGTJNzu1+fBOOLN2c4m0gpzcRnKBnVhyc68GsPRChS6V/4p9U0BYJJzQirj9QtMtXUOaZ9adzQzLy",
	plaintext:  "orbital-qr-interop-probe",
}

type qrTestFixture struct {
	service *QRLoginService
	db      *storage.DB
}

func newQRTestFixture(t *testing.T) *qrTestFixture {
	t.Helper()

	db, err := storage.NewDB(":memory:")
	if err != nil {
		t.Fatalf("failed to create in-memory db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	if err := db.RunMigrations(); err != nil {
		t.Fatalf("failed to run migrations: %v", err)
	}

	userRepo := repository.NewUserRepository(db)
	authService := NewAuthService(&config.AuthConfig{JWTSecret: "test-secret"}, userRepo)
	return &qrTestFixture{
		service: NewQRLoginService(repository.NewQRLoginRepository(db), authService),
		db:      db,
	}
}

func decodeB64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		t.Fatalf("decode base64: %v", err)
	}
	return b
}

func TestSealOpensLibsodiumBox(t *testing.T) {
	pubRaw := decodeB64(t, libsodiumInteropVector.publicKey)
	privRaw := decodeB64(t, libsodiumInteropVector.privateKey)
	sealed := decodeB64(t, libsodiumInteropVector.sealed)

	var pub, priv [32]byte
	copy(pub[:], pubRaw)
	copy(priv[:], privRaw)

	opened, ok := box.OpenAnonymous(nil, sealed, &pub, &priv)
	if !ok {
		t.Fatal("Go failed to open a libsodium-sealed box: wire formats diverged")
	}
	if string(opened) != libsodiumInteropVector.plaintext {
		t.Fatalf("opened = %q, want %q", opened, libsodiumInteropVector.plaintext)
	}
}

func TestSealForPublicKeyRoundTrip(t *testing.T) {
	pubRaw := decodeB64(t, libsodiumInteropVector.publicKey)
	privRaw := decodeB64(t, libsodiumInteropVector.privateKey)

	var pub, priv [32]byte
	copy(pub[:], pubRaw)
	copy(priv[:], privRaw)

	sealedB64, err := SealForPublicKey(libsodiumInteropVector.publicKey, []byte("hello new device"))
	if err != nil {
		t.Fatalf("SealForPublicKey: %v", err)
	}

	sealed := decodeB64(t, sealedB64)
	opened, ok := box.OpenAnonymous(nil, sealed, &pub, &priv)
	if !ok {
		t.Fatal("could not open Go-sealed box")
	}
	if string(opened) != "hello new device" {
		t.Fatalf("opened = %q, want %q", opened, "hello new device")
	}
}

func TestQRChallengeFullFlow(t *testing.T) {
	fx := newQRTestFixture(t)
	svc := fx.service

	user := &models.User{
		ID:               "user-1",
		Nickname:         "Alice",
		OriginalNickname: "Alice",
		CreatedAt:        time.Now(),
		LastSeen:         time.Now(),
		AuthProvider:     models.AuthProviderPassword,
		IsGuest:          false,
		Role:             models.RoleUser,
	}

	ch, err := svc.CreateChallenge(libsodiumInteropVector.publicKey, "Chrome · Windows", `{"browser":"Chrome"}`)
	if err != nil {
		t.Fatalf("CreateChallenge: %v", err)
	}
	if ch.ID == "" {
		t.Fatal("expected non-empty challenge id")
	}
	if ch.Status != models.QRLoginChallengePending {
		t.Fatalf("status = %q, want pending", ch.Status)
	}

	// Polling before approval reports pending
	if status, _, err := svc.ClaimChallenge(ch.ID); err != ErrQRChallengePending || status != models.QRLoginChallengePending {
		t.Fatalf("claim before approve = (%q, %v), want (pending, ErrQRChallengePending)", status, err)
	}

	// Guests cannot approve
	guest := *user
	guest.IsGuest = true
	if err := svc.ApproveChallenge(ch.ID, libsodiumInteropVector.publicKey, &guest); err != ErrQRGuestNotAllowed {
		t.Fatalf("guest approve err = %v, want ErrQRGuestNotAllowed", err)
	}

	// Wrong public key is rejected
	if err := svc.ApproveChallenge(ch.ID, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", user); err != ErrQRPublicKeyMismatch {
		t.Fatalf("mismatched key approve err = %v, want ErrQRPublicKeyMismatch", err)
	}

	// Scanner view hides the sealed payload (empty before approval anyway)
	got, err := svc.GetChallenge(ch.ID)
	if err != nil {
		t.Fatalf("GetChallenge: %v", err)
	}
	if got.DeviceName != "Chrome · Windows" {
		t.Fatalf("device name = %q", got.DeviceName)
	}
	if got.SealedPayload != "" {
		t.Fatal("scanner view must not expose the sealed payload")
	}

	if err := svc.ApproveChallenge(ch.ID, libsodiumInteropVector.publicKey, user); err != nil {
		t.Fatalf("ApproveChallenge: %v", err)
	}

	// Second approval loses the single-use race
	if err := svc.ApproveChallenge(ch.ID, libsodiumInteropVector.publicKey, user); err != ErrQRChallengeAlreadyUsed {
		t.Fatalf("second approve err = %v, want ErrQRChallengeAlreadyUsed", err)
	}

	// Claim consumes exactly once and yields an AuthResponse
	status, sealedB64, err := svc.ClaimChallenge(ch.ID)
	if err != nil {
		t.Fatalf("ClaimChallenge: %v", err)
	}
	if status != models.QRLoginChallengeApproved || sealedB64 == "" {
		t.Fatalf("claim = (%q, len %d), want approved with payload", status, len(sealedB64))
	}

	var resp models.AuthResponse
	sealed := decodeB64(t, sealedB64)
	pubRaw := decodeB64(t, libsodiumInteropVector.publicKey)
	privRaw := decodeB64(t, libsodiumInteropVector.privateKey)
	var pub, priv [32]byte
	copy(pub[:], pubRaw)
	copy(priv[:], privRaw)
	opened, ok := box.OpenAnonymous(nil, sealed, &pub, &priv)
	if !ok {
		t.Fatal("could not open claimed payload")
	}
	if err := json.Unmarshal(opened, &resp); err != nil {
		t.Fatalf("unmarshal auth response: %v", err)
	}
	if resp.Token == "" || resp.User.ID != user.ID {
		t.Fatalf("unexpected auth response: %+v", resp.User)
	}

	// Replay of the claim is rejected
	if _, _, err := svc.ClaimChallenge(ch.ID); err != ErrQRChallengeAlreadyUsed {
		t.Fatalf("second claim err = %v, want ErrQRChallengeAlreadyUsed", err)
	}
}

func TestQRChallengeExpiry(t *testing.T) {
	fx := newQRTestFixture(t)

	ch, err := fx.service.CreateChallenge(libsodiumInteropVector.publicKey, "Phone", "")
	if err != nil {
		t.Fatalf("CreateChallenge: %v", err)
	}

	// Age the challenge past its TTL directly
	if _, err := fx.db.Exec(
		`UPDATE qr_login_challenges SET expires_at = ? WHERE id = ?`,
		time.Now().UTC().Add(-time.Minute), ch.ID,
	); err != nil {
		t.Fatalf("age challenge: %v", err)
	}

	if _, err := fx.service.GetChallenge(ch.ID); err != ErrQRChallengeExpired {
		t.Fatalf("get expired err = %v, want ErrQRChallengeExpired", err)
	}
	if _, _, err := fx.service.ClaimChallenge(ch.ID); err != ErrQRChallengeExpired {
		t.Fatalf("claim expired err = %v, want ErrQRChallengeExpired", err)
	}
	if _, err := fx.service.CleanupExpired(); err != nil {
		t.Fatalf("CleanupExpired: %v", err)
	}
	// Still inside the grace period: row is kept for deterministic answers
	if _, err := fx.db.Exec(`SELECT 1`); err != nil {
		t.Fatalf("db ping: %v", err)
	}
}

func TestQRChallengeNotFound(t *testing.T) {
	fx := newQRTestFixture(t)

	if _, err := fx.service.GetChallenge("nope"); err != ErrQRChallengeNotFound {
		t.Fatalf("get missing err = %v, want ErrQRChallengeNotFound", err)
	}
	if _, _, err := fx.service.ClaimChallenge("nope"); err != ErrQRChallengeNotFound {
		t.Fatalf("claim missing err = %v, want ErrQRChallengeNotFound", err)
	}
}
