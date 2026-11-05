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
	req = req.WithContext(context.WithValue(req.Context(), userContextKey, &models.JWTClaims{
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

func TestOAuthStateIsSingleUseAndProviderBound(t *testing.T) {
	_, authService, _ := newTestAuthHandler(t)

	state, verifier, err := authService.GenerateState(models.AuthProviderDiscord, false)
	if err != nil {
		t.Fatalf("GenerateState: %v", err)
	}
	if verifier == "" {
		t.Fatal("expected non-empty PKCE verifier")
	}

	provider, electron, storedVerifier, err := authService.ConsumeState(state)
	if err != nil {
		t.Fatalf("ConsumeState: %v", err)
	}
	if provider != models.AuthProviderDiscord || electron || storedVerifier != verifier {
		t.Fatalf("unexpected state payload: provider=%q electron=%v verifier_match=%v", provider, electron, storedVerifier == verifier)
	}

	if _, _, _, err := authService.ConsumeState(state); err == nil {
		t.Fatal("state was accepted twice")
	}
}

func TestOAuthCallbackRejectsStateCookieMismatch(t *testing.T) {
	handler, _, _ := newTestAuthHandler(t)

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/auth/discord/callback?state=attacker-state&code=attacker-code",
		nil,
	)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "victim-state"})
	rec := httptest.NewRecorder()

	handler.handleCallback(rec, req, models.AuthProviderDiscord)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestOAuthCallbackRejectsUnknownState(t *testing.T) {
	handler, _, _ := newTestAuthHandler(t)

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/auth/discord/callback?state=unknown-state&code=whatever",
		nil,
	)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "unknown-state"})
	rec := httptest.NewRecorder()

	handler.handleCallback(rec, req, models.AuthProviderDiscord)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestAuthMiddlewareRejectsRevokedToken(t *testing.T) {
	handler, authService, user := newTestAuthHandler(t)

	token, _, err := authService.GenerateJWT(user)
	if err != nil {
		t.Fatalf("GenerateJWT: %v", err)
	}

	call := func() int {
		req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})).ServeHTTP(rec, req)
		return rec.Code
	}

	if code := call(); code != http.StatusOK {
		t.Fatalf("valid token status = %d, want %d", code, http.StatusOK)
	}

	if err := authService.RevokeTokens(user.ID); err != nil {
		t.Fatalf("RevokeTokens: %v", err)
	}

	if code := call(); code != http.StatusUnauthorized {
		t.Fatalf("revoked token status = %d, want %d", code, http.StatusUnauthorized)
	}
}

func TestAuthMiddlewareUsesFreshDatabaseRole(t *testing.T) {
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
		ID:               "admin-1",
		Nickname:         "Admin",
		OriginalNickname: "Admin",
		CreatedAt:        time.Now(),
		LastSeen:         time.Now(),
		AuthProvider:     models.AuthProviderPassword,
		IsGuest:          false,
		Role:             models.RoleAdmin,
	}
	if err := userRepo.Create(user); err != nil {
		t.Fatalf("Create user: %v", err)
	}

	authService := service.NewAuthService(&config.AuthConfig{JWTSecret: "test-secret"}, userRepo)
	handler := NewAuthHandler(authService, nil, "", "")
	token, _, err := authService.GenerateJWT(user)
	if err != nil {
		t.Fatalf("GenerateJWT: %v", err)
	}

	if err := userRepo.UpdateRole(user.ID, models.RoleUser); err != nil {
		t.Fatalf("UpdateRole: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.AuthMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, _ := r.Context().Value(userContextKey).(*models.JWTClaims)
		if claims == nil || claims.Role != models.RoleUser {
			t.Fatalf("role = %v, want fresh role %q", claims, models.RoleUser)
		}
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}
