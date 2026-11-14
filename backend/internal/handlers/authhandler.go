package handlers

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// AuthHandler handles authentication-related HTTP requests
type AuthHandler struct {
	authService         *service.AuthService
	roleService         *service.RoleService
	externalURL         string
	electronRedirectURL string
}

// NewAuthHandler creates a new auth handler
func NewAuthHandler(authService *service.AuthService, roleService *service.RoleService, externalURL string, electronRedirectURL string) *AuthHandler {
	return &AuthHandler{
		authService:         authService,
		roleService:         roleService,
		externalURL:         externalURL,
		electronRedirectURL: electronRedirectURL,
	}
}

// DiscordLogin initiates Discord OAuth flow
func (h *AuthHandler) DiscordLogin(w http.ResponseWriter, r *http.Request) {
	h.initiateOAuth(w, r, models.AuthProviderDiscord)
}

// GoogleLogin initiates Google OAuth flow
func (h *AuthHandler) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	h.initiateOAuth(w, r, models.AuthProviderGoogle)
}

// GetOAuthUrl returns the OAuth URL for external browser flows (Electron)
func (h *AuthHandler) GetOAuthUrl(w http.ResponseWriter, r *http.Request) {
	providerStr := strings.TrimPrefix(r.URL.Path, "/api/auth/")
	providerStr = strings.TrimSuffix(providerStr, "/url")
	provider := models.AuthProvider(providerStr)

	if provider != models.AuthProviderDiscord && provider != models.AuthProviderGoogle {
		http.Error(w, "Invalid provider", http.StatusBadRequest)
		return
	}

	if !h.authService.IsProviderConfigured(provider) {
		http.Error(w, "OAuth provider not configured", http.StatusServiceUnavailable)
		return
	}

	query := r.URL.Query()
	client, ok := service.ParseOAuthClient(query.Get("client"))
	if !ok {
		http.Error(w, "Invalid client", http.StatusBadRequest)
		return
	}
	// Legacy flag sent by released desktop builds.
	if client == service.OAuthClientWeb && query.Get("electron") == "true" {
		client = service.OAuthClientElectron
	}
	log.Printf("[Auth] GetOAuthUrl - provider: %s, client: %s", provider, client)

	// The Android app proves it started the flow with a PKCE-style verifier
	// when it redeems the deep-link code (see ExchangeAppCode).
	appChallenge := ""
	if client.IsAndroid() {
		appChallenge = query.Get("code_challenge")
		if !service.ValidAppChallenge(appChallenge) {
			http.Error(w, "Missing or invalid code_challenge", http.StatusBadRequest)
			return
		}
	}

	// Desktop and Android use the app redirect URI (Android may override it).
	if client.UsesAppRedirect() && !h.authService.IsAppOAuthConfigured(provider, client) {
		http.Error(w, "App OAuth not configured for this provider", http.StatusServiceUnavailable)
		return
	}

	state, verifier, err := h.authService.GenerateState(provider, client, appChallenge)
	if err != nil {
		http.Error(w, "Failed to generate state", http.StatusInternalServerError)
		return
	}
	if !client.UsesAppRedirect() {
		h.setOAuthStateCookie(w, r, state)
	}

	var authURL string
	if client.UsesAppRedirect() {
		authURL, err = h.authService.GetAppOAuthURL(provider, client, state, verifier)
	} else {
		authURL, err = h.authService.GetOAuthURL(provider, state, verifier)
	}

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[Auth] Generated OAuth URL: %s", authURL)

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{
		"url":   authURL,
		"state": state,
	})
}

// initiateOAuth generates state and redirects to OAuth provider
func (h *AuthHandler) initiateOAuth(w http.ResponseWriter, r *http.Request, provider models.AuthProvider) {
	// Check if provider is configured
	if !h.authService.IsProviderConfigured(provider) {
		http.Error(w, "OAuth provider not configured", http.StatusServiceUnavailable)
		return
	}

	// Generate state for CSRF protection
	state, verifier, err := h.authService.GenerateState(provider, service.OAuthClientWeb, "")
	if err != nil {
		http.Error(w, "Failed to generate state", http.StatusInternalServerError)
		return
	}

	h.setOAuthStateCookie(w, r, state)

	// Get OAuth URL
	authURL, err := h.authService.GetOAuthURL(provider, state, verifier)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Redirect to provider
	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

// DiscordCallback handles Discord OAuth callback
func (h *AuthHandler) DiscordCallback(w http.ResponseWriter, r *http.Request) {
	h.handleCallback(w, r, models.AuthProviderDiscord)
}

// GoogleCallback handles Google OAuth callback
func (h *AuthHandler) GoogleCallback(w http.ResponseWriter, r *http.Request) {
	h.handleCallback(w, r, models.AuthProviderGoogle)
}

// DiscordElectronCallback handles Discord OAuth callback for Electron
func (h *AuthHandler) DiscordElectronCallback(w http.ResponseWriter, r *http.Request) {
	h.handleElectronCallback(w, r, models.AuthProviderDiscord)
}

// GoogleElectronCallback handles Google OAuth callback for Electron
func (h *AuthHandler) GoogleElectronCallback(w http.ResponseWriter, r *http.Request) {
	h.handleElectronCallback(w, r, models.AuthProviderGoogle)
}

// handleCallback processes OAuth callback
func (h *AuthHandler) handleCallback(w http.ResponseWriter, r *http.Request, provider models.AuthProvider) {
	// A web callback must prove it belongs to the browser that started the
	// flow: the state in the URL must match the HttpOnly state cookie and the
	// server-side one-time state record. This blocks login CSRF, where an
	// attacker would otherwise hand a victim a callback URL for the attacker's
	// account.
	queryState := r.URL.Query().Get("state")
	stateCookie, cookieErr := r.Cookie("oauth_state")
	h.clearOAuthStateCookie(w, r)

	if queryState == "" || cookieErr != nil || stateCookie.Value == "" {
		http.Error(w, "Missing state parameter", http.StatusBadRequest)
		return
	}
	if subtle.ConstantTimeCompare([]byte(queryState), []byte(stateCookie.Value)) != 1 {
		http.Error(w, "Invalid state parameter", http.StatusBadRequest)
		return
	}

	oauthState, err := h.authService.ConsumeState(queryState)
	if err != nil || oauthState.Provider != provider || oauthState.Client != service.OAuthClientWeb {
		http.Error(w, "Invalid state parameter", http.StatusBadRequest)
		return
	}

	// Get authorization code
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "Missing authorization code", http.StatusBadRequest)
		return
	}

	user, ok := h.completeOAuthLogin(w, r, provider, code, oauthState)
	if !ok {
		return
	}

	// Generate JWT token
	token, expiry, err := h.authService.GenerateJWT(user)
	if err != nil {
		http.Error(w, "Failed to generate token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Redirect to the configured frontend only. Post-login redirects are never
	// taken from user-supplied query parameters.
	params := url.Values{}
	params.Set("token", token)
	params.Set("expires", expiry.Format(time.RFC3339))
	redirectURL := strings.TrimSuffix(h.externalURL, "/") + "/auth/callback/?" + params.Encode()
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

// completeOAuthLogin exchanges the provider code, creates or updates the user
// and returns the fresh user. On failure it has already written the response.
func (h *AuthHandler) completeOAuthLogin(w http.ResponseWriter, r *http.Request, provider models.AuthProvider, code string, oauthState service.OAuthState) (*models.User, bool) {
	log.Printf("[Auth] Exchanging code for provider: %s (%s)", provider, oauthState.Client)
	oauthInfo, err := h.authService.ExchangeCode(r.Context(), provider, code, oauthState.Client, oauthState.CodeVerifier)
	if err != nil {
		log.Printf("[Auth] ExchangeCode error: %v", err)
		http.Error(w, "Failed to exchange code: "+err.Error(), http.StatusInternalServerError)
		return nil, false
	}

	user, err := h.authService.CreateOrUpdateUser(oauthInfo)
	if err != nil {
		http.Error(w, "Failed to create user: "+err.Error(), http.StatusInternalServerError)
		return nil, false
	}

	// Check if this user should be made super_admin (first non-guest user)
	if err := h.roleService.AssignSuperAdminIfFirst(user.ID); err != nil {
		// Log error but don't fail the login; the user keeps the default role.
		log.Printf("Failed to assign super admin if first: %v", err)
	}

	// Refresh user data in case role was changed
	user, err = h.authService.GetUserByID(user.ID)
	if err != nil || user == nil {
		http.Error(w, "Failed to get user", http.StatusInternalServerError)
		return nil, false
	}
	return user, true
}

// handleElectronCallback processes the OAuth callback on the app redirect URI
// shared by the desktop app (loopback redirect with the JWT) and the Android
// app (deep link with a one-time code).
func (h *AuthHandler) handleElectronCallback(w http.ResponseWriter, r *http.Request, provider models.AuthProvider) {
	log.Printf("[Auth] App callback received for provider: %s", provider)

	queryState := r.URL.Query().Get("state")
	if queryState == "" {
		http.Error(w, "Missing state parameter", http.StatusBadRequest)
		return
	}

	oauthState, err := h.authService.ConsumeState(queryState)
	if err != nil || oauthState.Provider != provider || !oauthState.Client.UsesAppRedirect() {
		http.Error(w, "Invalid state parameter", http.StatusBadRequest)
		return
	}

	// Get authorization code
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "Missing authorization code", http.StatusBadRequest)
		return
	}

	user, ok := h.completeOAuthLogin(w, r, provider, code, oauthState)
	if !ok {
		return
	}

	if oauthState.Client.IsAndroid() {
		// Deep link back into the app with a one-time code, never the JWT:
		// any app can register the URL scheme. The app redeems the code with
		// its verifier at POST /api/auth/exchange.
		loginCode, err := h.authService.IssueAppLoginCode(user.ID, queryState, oauthState.AppChallenge)
		if err != nil {
			http.Error(w, "Failed to issue login code", http.StatusInternalServerError)
			return
		}
		params := url.Values{}
		params.Set("code", loginCode)
		params.Set("state", queryState)
		http.Redirect(w, r, oauthState.Client.AppCallbackURL()+"?"+params.Encode(), http.StatusFound)
		return
	}

	// Generate JWT token
	token, expiry, err := h.authService.GenerateJWT(user)
	if err != nil {
		http.Error(w, "Failed to generate token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Redirect to Electron's local OAuth callback server. The state is echoed
	// back so the desktop app can verify it matches the flow it started.
	// This address must match OAUTH_CALLBACK_PORT in electron/main/features/oauth.ts.
	params := url.Values{}
	params.Set("token", token)
	params.Set("expires", expiry.Format(time.RFC3339))
	params.Set("state", queryState)
	redirectURL := "http://127.0.0.1:27271/callback?" + params.Encode()
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

// appCodeExchangeRequest redeems a deep-link login code (Android app).
type appCodeExchangeRequest struct {
	Code         string `json:"code"`
	State        string `json:"state"`
	CodeVerifier string `json:"code_verifier"`
}

// ExchangeAppCode trades the one-time code from the Android OAuth deep link
// for a session. The code is bound to the flow's state and to the app's PKCE
// verifier, so an intercepted deep link cannot be redeemed by another app.
func (h *AuthHandler) ExchangeAppCode(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var req appCodeExchangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	userID, err := h.authService.RedeemAppLoginCode(req.Code, req.State, req.CodeVerifier)
	if err != nil {
		http.Error(w, "Invalid or expired login code", http.StatusUnauthorized)
		return
	}

	user, err := h.authService.GetUserByID(userID)
	if err != nil || user == nil {
		http.Error(w, "User not found", http.StatusUnauthorized)
		return
	}

	token, expiry, err := h.authService.GenerateJWT(user)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, models.AuthResponse{
		Token:     token,
		User:      *user,
		ExpiresAt: expiry,
	})
}

// GuestLogin creates a new guest user
func (h *AuthHandler) GuestLogin(w http.ResponseWriter, r *http.Request) {
	user, err := h.authService.CreateGuestUser()
	if err != nil {
		http.Error(w, "Failed to create guest user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Generate JWT token
	token, expiry, err := h.authService.GenerateJWT(user)
	if err != nil {
		http.Error(w, "Failed to generate token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Return auth response
	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, models.AuthResponse{
		Token:     token,
		User:      *user,
		ExpiresAt: expiry,
	})
}

// GetCurrentUser returns the current authenticated user
func (h *AuthHandler) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get fresh user data from database
	user, err := h.authService.GetUserByID(claims.UserID)
	if err != nil || user == nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, user)
}

// RefreshToken slides an authenticated session forward by issuing a new JWT
// with a fresh expiry. The current token must still be valid (AuthMiddleware
// rejects expired tokens), so clients must refresh before expiry.
func (h *AuthHandler) RefreshToken(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Re-fetch fresh user data so role/nickname/avatar changes are reflected
	// in the new token instead of being carried over from stale claims.
	user, err := h.authService.GetUserByID(claims.UserID)
	if err != nil || user == nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	token, expiry, err := h.authService.GenerateJWT(user)
	if err != nil {
		http.Error(w, "Failed to generate token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, models.AuthResponse{
		Token:     token,
		User:      *user,
		ExpiresAt: expiry,
	})
}

// Logout revokes every JWT issued for the current user and clears the client
// token. Logout requires a valid session so an attacker cannot revoke other
// users' sessions.
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value(userContextKey).(*models.JWTClaims)
	if !ok || claims == nil || claims.UserID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.authService.RevokeTokens(claims.UserID); err != nil {
		http.Error(w, "Failed to revoke session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{
		"status":  "ok",
		"message": "Logged out successfully",
	})
}

// AuthMiddleware creates a middleware for protected routes
func (h *AuthHandler) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Get token from Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Missing authorization header", http.StatusUnauthorized)
			return
		}

		// Extract Bearer token
		var token string
		if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			token = authHeader[7:]
		} else {
			http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
			return
		}

		// Validate token
		claims, err := h.authService.ValidateJWT(token)
		if err != nil {
			http.Error(w, "Invalid or expired token", http.StatusUnauthorized)
			return
		}

		// Always reload the user so deletion, demotion, and logout take effect
		// immediately instead of waiting for a 60-day token to expire.
		user, err := h.authService.GetUserByID(claims.UserID)
		if err != nil || user == nil {
			http.Error(w, "Invalid or expired token", http.StatusUnauthorized)
			return
		}
		if claims.TokenVersion != user.TokenVersion {
			http.Error(w, "Session has been revoked", http.StatusUnauthorized)
			return
		}

		// Add fresh claims to request context (never trust stale token roles).
		ctx := r.Context()
		ctx = context.WithValue(ctx, userContextKey, service.ClaimsFromUser(user))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireSuperAdmin creates a middleware that requires super_admin role
func (h *AuthHandler) RequireSuperAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := r.Context().Value(userContextKey).(*models.JWTClaims)
		if !ok || claims == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Check if user is super_admin
		if claims.Role != models.RoleSuperAdmin {
			http.Error(w, "Super admin access required", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// GetAuthStatus returns authentication status and available providers
func (h *AuthHandler) GetAuthStatus(w http.ResponseWriter, r *http.Request) {
	status := map[string]interface{}{
		"discord_enabled":  h.authService.IsProviderConfigured(models.AuthProviderDiscord),
		"google_enabled":   h.authService.IsProviderConfigured(models.AuthProviderGoogle),
		"password_enabled": h.authService.IsPasswordEnabled(),
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, status)
}

// Register handles user registration with email, nickname, and password
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req models.RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.Email == "" {
		http.Error(w, "Email is required", http.StatusBadRequest)
		return
	}
	if req.Nickname == "" {
		http.Error(w, "Nickname is required", http.StatusBadRequest)
		return
	}
	if req.Password == "" {
		http.Error(w, "Password is required", http.StatusBadRequest)
		return
	}

	user, err := h.authService.Register(req.Email, req.Nickname, req.Password)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Check if this user should be made super_admin (first non-guest user)
	if err := h.roleService.AssignSuperAdminIfFirst(user.ID); err != nil {
		// Log error but don't fail the login; the user keeps the default role.
		log.Printf("Failed to assign super admin if first: %v", err)
	}

	// Refresh user data in case role was changed
	user, err = h.authService.GetUserByID(user.ID)
	if err != nil || user == nil {
		http.Error(w, "Failed to get user", http.StatusInternalServerError)
		return
	}

	// Generate JWT after the bootstrap role assignment so the first
	// super_admin receives a token with the correct role.
	token, expiry, err := h.authService.GenerateJWTWithExpiry(user, 60*24*time.Hour)
	if err != nil {
		http.Error(w, "Failed to generate token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, models.LoginResponse{
		Token:     token,
		User:      *user,
		ExpiresAt: expiry,
	})
}

func (h *AuthHandler) setOAuthStateCookie(w http.ResponseWriter, r *http.Request, state string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		Path:     "/",
		MaxAge:   300,
		HttpOnly: true,
		Secure:   isSecureRequest(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *AuthHandler) clearOAuthStateCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isSecureRequest(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func isSecureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// LoginPassword handles user login with email or nickname and password
func (h *AuthHandler) LoginPassword(w http.ResponseWriter, r *http.Request) {
	var req models.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.Login == "" {
		http.Error(w, "Email or nickname is required", http.StatusBadRequest)
		return
	}
	if req.Password == "" {
		http.Error(w, "Password is required", http.StatusBadRequest)
		return
	}

	user, err := h.authService.LoginPassword(req.Login, req.Password)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	// Generate JWT token (2 months expiry for password users)
	token, expiry, err := h.authService.GenerateJWTWithExpiry(user, 60*24*time.Hour)
	if err != nil {
		http.Error(w, "Failed to generate token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, models.LoginResponse{
		Token:     token,
		User:      *user,
		ExpiresAt: expiry,
	})
}
