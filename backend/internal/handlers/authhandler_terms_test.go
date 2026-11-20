package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"github.com/kuleshov-aleksei/orbital/internal/service"
	"github.com/kuleshov-aleksei/orbital/internal/storage"
)

// newTermsTestHandler builds an AuthHandler with a RoleService (Register
// needs it) on a fresh database.
func newTermsTestHandler(t *testing.T) (*AuthHandler, *repository.UserRepository) {
	t.Helper()
	db, err := storage.NewDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := db.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	userRepo := repository.NewUserRepository(db)
	authService := service.NewAuthService(&config.AuthConfig{JWTSecret: "test-secret"}, userRepo)
	return NewAuthHandler(authService, service.NewRoleService(userRepo), "", ""), userRepo
}

func decodeLoginUser(t *testing.T, rec *httptest.ResponseRecorder) models.User {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var resp models.LoginResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return resp.User
}

func postRegister(handler *AuthHandler, acceptedTerms bool, email, nickname string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(models.RegisterRequest{
		Email:         email,
		Nickname:      nickname,
		Password:      "s3cret-pass!",
		AcceptedTerms: acceptedTerms,
	})
	rec := httptest.NewRecorder()
	handler.Register(rec, httptest.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewReader(body)))
	return rec
}

func TestRegisterRecordsTermsAcceptance(t *testing.T) {
	handler, userRepo := newTermsTestHandler(t)
	before := time.Now().Add(-time.Second)

	user := decodeLoginUser(t, postRegister(handler, true, "alice@example.com", "alice"))
	if user.AcceptedTermsAt == nil || user.AcceptedTermsAt.Before(before) {
		t.Fatalf("response accepted_terms_at = %v, want a time after %v", user.AcceptedTermsAt, before)
	}

	stored, err := userRepo.GetByID(user.ID)
	if err != nil || stored == nil {
		t.Fatalf("GetByID: %v", err)
	}
	if stored.AcceptedTermsAt == nil {
		t.Fatal("stored accepted_terms_at is NULL, want the acceptance time")
	}
}

func TestRegisterWithoutAcceptanceLeavesNull(t *testing.T) {
	handler, _ := newTermsTestHandler(t)

	// Older clients don't send the flag; the account is created and the
	// client asks for acceptance after sign-in.
	user := decodeLoginUser(t, postRegister(handler, false, "bob@example.com", "bob"))
	if user.AcceptedTermsAt != nil {
		t.Fatalf("accepted_terms_at = %v, want nil", user.AcceptedTermsAt)
	}
}

func TestGuestLoginTermsAcceptance(t *testing.T) {
	handler, _ := newTermsTestHandler(t)

	rec := httptest.NewRecorder()
	handler.GuestLogin(rec, httptest.NewRequest(http.MethodPost, "/api/auth/guest",
		bytes.NewReader([]byte(`{"accepted_terms":true}`))))
	if user := decodeLoginUser(t, rec); user.AcceptedTermsAt == nil {
		t.Fatal("guest with accepted_terms: accepted_terms_at is nil")
	}

	// No body at all (older clients) still creates the guest.
	rec = httptest.NewRecorder()
	handler.GuestLogin(rec, httptest.NewRequest(http.MethodPost, "/api/auth/guest", nil))
	if user := decodeLoginUser(t, rec); user.AcceptedTermsAt != nil {
		t.Fatalf("guest without body: accepted_terms_at = %v, want nil", user.AcceptedTermsAt)
	}
}

func TestAcceptTermsEndpoint(t *testing.T) {
	handler, userRepo := newTermsTestHandler(t)

	existing := &models.User{
		ID:               "qkUrdzLDoqslx8EEy2cM7Q==",
		Nickname:         "carol",
		OriginalNickname: "carol",
		CreatedAt:        time.Now(),
		LastSeen:         time.Now(),
		AuthProvider:     models.AuthProviderDiscord,
		Role:             models.RoleUser,
	}
	if err := userRepo.Create(existing); err != nil {
		t.Fatalf("Create: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/accept-terms", nil)
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &models.JWTClaims{
		UserID: existing.ID,
		Role:   existing.Role,
	}))
	rec := httptest.NewRecorder()
	handler.AcceptTerms(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var user models.User
	if err := json.NewDecoder(rec.Body).Decode(&user); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if user.AcceptedTermsAt == nil {
		t.Fatal("accepted_terms_at is nil after accept-terms")
	}
}

func TestAcceptTermsRequiresAuth(t *testing.T) {
	handler, _ := newTermsTestHandler(t)

	rec := httptest.NewRecorder()
	handler.AcceptTerms(rec, httptest.NewRequest(http.MethodPost, "/api/auth/accept-terms", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
