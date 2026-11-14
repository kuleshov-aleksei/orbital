package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	return newTestAuthHandlerWithConfig(t, &config.AuthConfig{JWTSecret: "test-secret"})
}

func newTestAuthHandlerWithConfig(t *testing.T, cfg *config.AuthConfig) (*AuthHandler, *service.AuthService, *models.User) {
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

	authService := service.NewAuthService(cfg, userRepo)
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

	state, verifier, err := authService.GenerateState(models.AuthProviderDiscord, service.OAuthClientWeb, "")
	if err != nil {
		t.Fatalf("GenerateState: %v", err)
	}
	if verifier == "" {
		t.Fatal("expected non-empty PKCE verifier")
	}

	got, err := authService.ConsumeState(state)
	if err != nil {
		t.Fatalf("ConsumeState: %v", err)
	}
	if got.Provider != models.AuthProviderDiscord || got.Client != service.OAuthClientWeb || got.CodeVerifier != verifier {
		t.Fatalf("unexpected state payload: provider=%q client=%q verifier_match=%v", got.Provider, got.Client, got.CodeVerifier == verifier)
	}

	if _, err := authService.ConsumeState(state); err == nil {
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
		ID:               "owner-1",
		Nickname:         "Owner",
		OriginalNickname: "Owner",
		CreatedAt:        time.Now(),
		LastSeen:         time.Now(),
		AuthProvider:     models.AuthProviderPassword,
		IsGuest:          false,
		Role:             models.RoleSuperAdmin,
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

// newOAuthTestHandler is newTestAuthHandler with Discord OAuth (web + app
// redirect URIs) configured.
func newOAuthTestHandler(t *testing.T) (*AuthHandler, *service.AuthService, *models.User) {
	t.Helper()
	return newTestAuthHandlerWithConfig(t, &config.AuthConfig{
		JWTSecret: "test-secret",
		Discord: config.OAuthProviderConfig{
			ClientID:     "discord-client-id",
			ClientSecret: "discord-client-secret",
			RedirectURL:  "https://orbital.example/api/auth/discord/callback",
		},
		DiscordElectronRedirectURL: "https://orbital.example/api/auth/discord/electron/callback",
	})
}

func appTestChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func TestGetOAuthUrlAndroidRequiresChallenge(t *testing.T) {
	handler, _, _ := newOAuthTestHandler(t)

	for _, target := range []string{
		"/api/auth/discord/url?client=android",
		"/api/auth/discord/url?client=android&code_challenge=not-a-challenge",
		"/api/auth/discord/url?client=orbital-evil",
	} {
		rec := httptest.NewRecorder()
		handler.GetOAuthUrl(rec, httptest.NewRequest(http.MethodGet, target, nil))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want %d", target, rec.Code, http.StatusBadRequest)
		}
	}
}

func TestGetOAuthUrlAndroidUsesAppRedirect(t *testing.T) {
	handler, authService, _ := newOAuthTestHandler(t)
	challenge := appTestChallenge("verifier")

	rec := httptest.NewRecorder()
	handler.GetOAuthUrl(rec, httptest.NewRequest(http.MethodGet,
		"/api/auth/discord/url?client=android&code_challenge="+challenge, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(rec.Result().Cookies()) != 0 {
		t.Error("app flow must not set the web state cookie")
	}

	var resp struct {
		URL   string `json:"url"`
		State string `json:"state"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	authURL, err := url.Parse(resp.URL)
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	if got := authURL.Query().Get("redirect_uri"); got != "https://orbital.example/api/auth/discord/electron/callback" {
		t.Errorf("redirect_uri = %q, want the app redirect URI", got)
	}

	got, err := authService.ConsumeState(resp.State)
	if err != nil {
		t.Fatalf("ConsumeState: %v", err)
	}
	if got.Client != service.OAuthClientAndroid || got.AppChallenge != challenge {
		t.Fatalf("state = %+v, want android client with the app challenge", got)
	}
}

func TestWebCallbackRejectsAndroidState(t *testing.T) {
	handler, authService, _ := newOAuthTestHandler(t)
	state, _, err := authService.GenerateState(models.AuthProviderDiscord, service.OAuthClientAndroid, appTestChallenge("v"))
	if err != nil {
		t.Fatalf("GenerateState: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/discord/callback?code=c&state="+state, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: state})
	rec := httptest.NewRecorder()
	handler.handleCallback(rec, req, models.AuthProviderDiscord)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestAppCallbackRejectsWebState(t *testing.T) {
	handler, authService, _ := newOAuthTestHandler(t)
	state, _, err := authService.GenerateState(models.AuthProviderDiscord, service.OAuthClientWeb, "")
	if err != nil {
		t.Fatalf("GenerateState: %v", err)
	}

	rec := httptest.NewRecorder()
	handler.handleElectronCallback(rec, httptest.NewRequest(http.MethodGet,
		"/api/auth/discord/electron/callback?code=c&state="+state, nil), models.AuthProviderDiscord)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func postExchange(handler *AuthHandler, code, state, verifier string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"code": code, "state": state, "code_verifier": verifier})
	rec := httptest.NewRecorder()
	handler.ExchangeAppCode(rec, httptest.NewRequest(http.MethodPost, "/api/auth/exchange", bytes.NewReader(body)))
	return rec
}

func TestExchangeAppCodeIssuesSessionOnce(t *testing.T) {
	handler, authService, user := newTestAuthHandler(t)
	verifier := "app-verifier-0123456789"
	code, err := authService.IssueAppLoginCode(user.ID, "state-1", appTestChallenge(verifier))
	if err != nil {
		t.Fatalf("IssueAppLoginCode: %v", err)
	}

	rec := postExchange(handler, code, "state-1", verifier)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	var resp models.AuthResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	claims, err := authService.ValidateJWT(resp.Token)
	if err != nil || claims.UserID != user.ID {
		t.Fatalf("token for %q (err %v), want %q", claims.UserID, err, user.ID)
	}

	if rec := postExchange(handler, code, "state-1", verifier); rec.Code != http.StatusUnauthorized {
		t.Fatalf("second exchange status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestExchangeAppCodeRejectsWrongVerifier(t *testing.T) {
	handler, authService, user := newTestAuthHandler(t)
	code, err := authService.IssueAppLoginCode(user.ID, "state-1", appTestChallenge("real-verifier"))
	if err != nil {
		t.Fatalf("IssueAppLoginCode: %v", err)
	}

	if rec := postExchange(handler, code, "state-1", "stolen-code-no-verifier"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestGetOAuthUrlAndroidPrefersAndroidRedirect(t *testing.T) {
	handler, authService, _ := newTestAuthHandlerWithConfig(t, &config.AuthConfig{
		JWTSecret: "test-secret",
		Discord: config.OAuthProviderConfig{
			ClientID:     "discord-client-id",
			ClientSecret: "discord-client-secret",
			RedirectURL:  "http://localhost:3000/api/auth/discord/callback",
		},
		DiscordElectronRedirectURL: "http://localhost:3000/api/auth/discord/electron/callback",
		DiscordAndroidRedirectURL:  "http://100.111.0.8:8080/api/auth/discord/electron/callback",
	})

	redirectFor := func(target string) string {
		t.Helper()
		rec := httptest.NewRecorder()
		handler.GetOAuthUrl(rec, httptest.NewRequest(http.MethodGet, target, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d (body: %s)", target, rec.Code, rec.Body.String())
		}
		var resp struct {
			URL   string `json:"url"`
			State string `json:"state"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		_, _ = authService.ConsumeState(resp.State)
		u, err := url.Parse(resp.URL)
		if err != nil {
			t.Fatalf("parse url: %v", err)
		}
		return u.Query().Get("redirect_uri")
	}

	challenge := appTestChallenge("v")
	if got := redirectFor("/api/auth/discord/url?client=android&code_challenge=" + challenge); got != "http://100.111.0.8:8080/api/auth/discord/electron/callback" {
		t.Errorf("android redirect_uri = %q, want the Android one", got)
	}
	if got := redirectFor("/api/auth/discord/url?client=android-dev&code_challenge=" + challenge); got != "http://100.111.0.8:8080/api/auth/discord/electron/callback" {
		t.Errorf("android-dev redirect_uri = %q, want the Android one", got)
	}
	if got := redirectFor("/api/auth/discord/url?client=electron"); got != "http://localhost:3000/api/auth/discord/electron/callback" {
		t.Errorf("electron redirect_uri = %q, want the Electron one", got)
	}
}
