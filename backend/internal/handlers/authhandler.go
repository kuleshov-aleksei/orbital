package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/service"
)

// AuthHandler handles authentication-related HTTP requests
type AuthHandler struct {
	authService *service.AuthService
	externalURL string
}

// NewAuthHandler creates a new auth handler
func NewAuthHandler(authService *service.AuthService, externalURL string) *AuthHandler {
	return &AuthHandler{
		authService: authService,
		externalURL: externalURL,
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

// handleCallback processes OAuth callback
func (h *AuthHandler) handleCallback(w http.ResponseWriter, r *http.Request, provider models.AuthProvider) {
	// Verify state parameter
	stateCookie, err := r.Cookie("oauth_state")
	if err != nil {
		http.Error(w, "Missing state cookie", http.StatusBadRequest)
		return
	}

	queryState := r.URL.Query().Get("state")
	if queryState == "" || queryState != stateCookie.Value {
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

	// Generate JWT token
	token, expiry, err := h.authService.GenerateJWT(user)
	if err != nil {
		http.Error(w, "Failed to generate token: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Redirect to frontend with token (derive frontend URL from request origin or referer)
	frontendURL := strings.TrimSuffix(h.getFrontendURL(r), "/")
	redirectURL := frontendURL + "/auth/callback/?token=" + token + "&expires=" + expiry.Format(time.RFC3339)
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

// GetAuthStatus returns authentication status and available providers
func (h *AuthHandler) GetAuthStatus(w http.ResponseWriter, r *http.Request) {
	status := map[string]interface{}{
		"discord_enabled": h.authService.IsProviderConfigured(models.AuthProviderDiscord),
		"google_enabled":  h.authService.IsProviderConfigured(models.AuthProviderGoogle),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// getFrontendURL derives the frontend URL from the request
// It checks Origin header first, then Referer, then falls back to configured external URL
func (h *AuthHandler) getFrontendURL(r *http.Request) string {
	// Try to get from Origin header (most reliable for CORS requests)
	if origin := r.Header.Get("Origin"); origin != "" {
		return origin
	}

	// Try to get from Referer header
	if referer := r.Header.Get("Referer"); referer != "" {
		return referer
	}

	// Fallback to configured external URL
	return h.externalURL
}
