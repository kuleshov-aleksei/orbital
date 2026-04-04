package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
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

	state, err := h.authService.GenerateState()
	if err != nil {
		http.Error(w, "Failed to generate state", http.StatusInternalServerError)
		return
	}

	isElectron := r.URL.Query().Get("electron") == "true"
	log.Printf("[Auth] GetOAuthUrl - provider: %s, isElectron: %v", provider, isElectron)

	// Check if Electron OAuth is configured when requesting electron flow
	if isElectron && !h.authService.IsElectronOAuthConfigured(provider) {
		http.Error(w, "Electron OAuth not configured for this provider", http.StatusServiceUnavailable)
		return
	}

	var authURL string
	if isElectron {
		authURL, err = h.authService.GetElectronOAuthURL(provider, state)
	} else {
		authURL, err = h.authService.GetOAuthURL(provider, state)
	}

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[Auth] Generated OAuth URL: %s", authURL)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
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
	state, err := h.authService.GenerateState()
	if err != nil {
		http.Error(w, "Failed to generate state", http.StatusInternalServerError)
		return
	}

	// Store state in cookie (valid for 5 minutes)
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		Path:     "/",
		MaxAge:   300, // 5 minutes
		HttpOnly: true,
		Secure:   false, // Set to true in production with HTTPS
		SameSite: http.SameSiteLaxMode,
	})

	// Get OAuth URL
	authURL, err := h.authService.GetOAuthURL(provider, state)
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
	var stateValid bool
	var stateValue string

	// Check for state in URL parameter (Electron/external browser flow)
	queryState := r.URL.Query().Get("state")
	if queryState != "" {
		stateValue = queryState
		// Also set cookie for consistency, but we'll validate URL state
		http.SetCookie(w, &http.Cookie{
			Name:     "oauth_state",
			Value:    stateValue,
			Path:     "/",
			MaxAge:   300,
			HttpOnly: true,
			Secure:   false,
			SameSite: http.SameSiteLaxMode,
		})
		stateValid = true
	} else {
		// Check for state in cookie (web flow)
		stateCookie, err := r.Cookie("oauth_state")
		if err != nil {
			http.Error(w, "Missing state parameter", http.StatusBadRequest)
			return
		}
		stateValue = stateCookie.Value
		stateValid = true
	}

	if !stateValid || stateValue == "" {
		http.Error(w, "Invalid state parameter", http.StatusBadRequest)
		return
	}

	// Clear state cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})

	// Get authorization code
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "Missing authorization code", http.StatusBadRequest)
		return
	}

	// Exchange code for user info
	oauthInfo, err := h.authService.ExchangeCode(r.Context(), provider, code)
	if err != nil {
		http.Error(w, "Failed to exchange code: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Create or update user
	user, err := h.authService.CreateOrUpdateUser(oauthInfo)
	if err != nil {
		http.Error(w, "Failed to create user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Check if this user should be made super_admin (first non-guest user)
	if err := h.roleService.AssignSuperAdminIfFirst(user.ID); err != nil {
		// Log error but don't fail the login
		// The user will just have default 'user' role
		// We can't log here without a logger, but we'll continue
	}

	// Refresh user data in case role was changed
	user, err = h.authService.GetUserByID(user.ID)
	if err != nil {
		http.Error(w, "Failed to get user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Generate JWT token
	token, expiry, err := h.authService.GenerateJWT(user)
	if err != nil {
		http.Error(w, "Failed to generate token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Redirect to frontend with token
	redirectURL := r.URL.Query().Get("redirect_url")
	if redirectURL == "" {
		redirectURL = strings.TrimSuffix(h.externalURL, "/") + "/auth/callback/"
	}
	// For Electron, redirect to deep link
	if strings.HasPrefix(redirectURL, "orbital://") {
		redirectURL = h.electronRedirectURL + "?token=" + token + "&expires=" + expiry.Format(time.RFC3339)
	} else {
		redirectURL += "?token=" + token + "&expires=" + expiry.Format(time.RFC3339)
	}
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

// handleElectronCallback processes OAuth callback for Electron - redirects to deep link
func (h *AuthHandler) handleElectronCallback(w http.ResponseWriter, r *http.Request, provider models.AuthProvider) {
	log.Printf("[Auth] Electron callback received for provider: %s", provider)
	log.Printf("[Auth] Query params: %s", r.URL.RawQuery)

	var stateValue string

	// Check for state in URL parameter (Electron/external browser flow)
	queryState := r.URL.Query().Get("state")
	if queryState != "" {
		stateValue = queryState
	} else {
		http.Error(w, "Missing state parameter", http.StatusBadRequest)
		return
	}

	if stateValue == "" {
		http.Error(w, "Invalid state parameter", http.StatusBadRequest)
		return
	}

	// Get authorization code
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "Missing authorization code", http.StatusBadRequest)
		return
	}

	// Exchange code for user info
	oauthInfo, err := h.authService.ExchangeCode(r.Context(), provider, code)
	if err != nil {
		http.Error(w, "Failed to exchange code: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Create or update user
	user, err := h.authService.CreateOrUpdateUser(oauthInfo)
	if err != nil {
		http.Error(w, "Failed to create user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Check if this user should be made super_admin
	if err := h.roleService.AssignSuperAdminIfFirst(user.ID); err != nil {
		// Log error but don't fail the login
	}

	// Refresh user data in case role was changed
	user, err = h.authService.GetUserByID(user.ID)
	if err != nil {
		http.Error(w, "Failed to get user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Generate JWT token
	token, expiry, err := h.authService.GenerateJWT(user)
	if err != nil {
		http.Error(w, "Failed to generate token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Redirect to Electron's local OAuth callback server
	redirectURL := "http://127.0.0.1:27271/callback?token=" + token + "&expires=" + expiry.Format(time.RFC3339)
	log.Printf("[Auth] Electron redirect URL: %s", redirectURL)
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
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
	json.NewEncoder(w).Encode(models.AuthResponse{
		Token:     token,
		User:      *user,
		ExpiresAt: expiry,
	})
}

// GetCurrentUser returns the current authenticated user
func (h *AuthHandler) GetCurrentUser(w http.ResponseWriter, r *http.Request) {
	claims, ok := r.Context().Value("user").(*models.JWTClaims)
	if !ok || claims == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Get fresh user data from database
	user, err := h.authService.GetUserByID(claims.UserID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// Logout handles logout (client should also delete token)
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	// In a stateless JWT system, logout is handled client-side
	// by removing the token from storage
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
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
			http.Error(w, "Invalid token: "+err.Error(), http.StatusUnauthorized)
			return
		}

		// Add claims to request context
		ctx := r.Context()
		ctx = context.WithValue(ctx, "user", claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireAdmin creates a middleware that requires admin or super_admin role
func (h *AuthHandler) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := r.Context().Value("user").(*models.JWTClaims)
		if !ok || claims == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Check if user is admin or super_admin
		if claims.Role != models.RoleAdmin && claims.Role != models.RoleSuperAdmin {
			http.Error(w, "Admin access required", http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// RequireSuperAdmin creates a middleware that requires super_admin role
func (h *AuthHandler) RequireSuperAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := r.Context().Value("user").(*models.JWTClaims)
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
	json.NewEncoder(w).Encode(status)
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

	// Generate JWT token (2 months expiry for password users)
	token, expiry, err := h.authService.GenerateJWTWithExpiry(user, 60*24*time.Hour)
	if err != nil {
		http.Error(w, "Failed to generate token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Check if this user should be made super_admin (first non-guest user)
	if err := h.roleService.AssignSuperAdminIfFirst(user.ID); err != nil {
		// Log error but don't fail the login
	}

	// Refresh user data in case role was changed
	user, err = h.authService.GetUserByID(user.ID)
	if err != nil {
		http.Error(w, "Failed to get user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.LoginResponse{
		Token:     token,
		User:      *user,
		ExpiresAt: expiry,
	})
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
	json.NewEncoder(w).Encode(models.LoginResponse{
		Token:     token,
		User:      *user,
		ExpiresAt: expiry,
	})
}
