package handlers

import (
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

func newTestAuthHandler(t *testing.T) (*AuthHandler, *service.AuthService, *models.User) {
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
	if err := userRepo.Create(user); err != nil {
		t.Fatalf("Create user: %v", err)
	}

	authService := service.NewAuthService(&config.AuthConfig{JWTSecret: "test-secret"}, userRepo)
	return NewAuthHandler(authService, nil, "", ""), authService, user
}

func TestRefreshTokenSlidesExpiry(t *testing.T) {
	handler, authService, user := newTestAuthHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req = req.WithContext(context.WithValue(req.Context(), "user", &models.JWTClaims{
		UserID: user.ID,
		Role:   user.Role,
	}))
	rec := httptest.NewRecorder()

	handler.RefreshToken(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp models.AuthResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if resp.Token == "" {
		t.Fatal("expected non-empty token")
	}
	if resp.User.ID != user.ID {
		t.Errorf("user id = %q, want %q", resp.User.ID, user.ID)
	}
	if !resp.ExpiresAt.After(time.Now()) {
		t.Errorf("expires_at = %v, want in the future", resp.ExpiresAt)
	}

	claims, err := authService.ValidateJWT(resp.Token)
	if err != nil {
		t.Fatalf("refreshed token did not validate: %v", err)
	}
	if claims.UserID != user.ID {
		t.Errorf("claims user id = %q, want %q", claims.UserID, user.ID)
	}
}

func TestRefreshTokenRequiresAuth(t *testing.T) {
	handler, _, _ := newTestAuthHandler(t)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	rec := httptest.NewRecorder()

	handler.RefreshToken(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
