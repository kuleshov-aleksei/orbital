package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/kuleshov-aleksei/orbital/internal/config"
	"github.com/kuleshov-aleksei/orbital/internal/models"
	"github.com/kuleshov-aleksei/orbital/internal/repository"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/oauth2"
)

// googleOAuthEndpoint uses Google's current OAuth 2.0 endpoint. The legacy
// /o/oauth2/auth endpoint is still reachable, but Google's current guidance
// (and newer client types) expect the v2 authorization endpoint.
var googleOAuthEndpoint = oauth2.Endpoint{
	AuthURL:   "https://accounts.google.com/o/oauth2/v2/auth",
	TokenURL:  "https://oauth2.googleapis.com/token",
	AuthStyle: oauth2.AuthStyleInParams,
}

const oauthStateTTL = 5 * time.Minute

type oauthStateEntry struct {
	Provider     models.AuthProvider
	Electron     bool
	CodeVerifier string
	ExpiresAt    time.Time
}

// AuthService handles OAuth authentication and JWT management
type AuthService struct {
	config               *config.AuthConfig
	userRepo             *repository.UserRepository
	oauthConfigs         map[models.AuthProvider]*oauth2.Config
	electronOAuthConfigs map[models.AuthProvider]*oauth2.Config

	stateMu sync.Mutex
	states  map[string]oauthStateEntry
}

// NewAuthService creates a new auth service
func NewAuthService(cfg *config.AuthConfig, userRepo *repository.UserRepository) *AuthService {
	service := &AuthService{
		config:               cfg,
		userRepo:             userRepo,
		oauthConfigs:         make(map[models.AuthProvider]*oauth2.Config),
		electronOAuthConfigs: make(map[models.AuthProvider]*oauth2.Config),
		states:               make(map[string]oauthStateEntry),
	}

	// Debug logging for OAuth configuration
	log.Printf("[Auth] Initializing auth service")

	// Configure Discord OAuth
	discordClientIDConfigured := cfg.Discord.ClientID != ""
	discordClientSecretConfigured := cfg.Discord.ClientSecret != ""
	if discordClientIDConfigured && discordClientSecretConfigured {
		service.oauthConfigs[models.AuthProviderDiscord] = &oauth2.Config{
			ClientID:     cfg.Discord.ClientID,
			ClientSecret: cfg.Discord.ClientSecret,
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://discord.com/oauth2/authorize",
				TokenURL: "https://discord.com/api/oauth2/token",
			},
			RedirectURL: cfg.Discord.RedirectURL,
			Scopes:      []string{"identify", "email"},
		}
		// Log partial client ID for debugging (first 4 and last 4 chars)
		clientID := cfg.Discord.ClientID
		maskedID := clientID
		if len(clientID) > 8 {
			maskedID = clientID[:4] + "****" + clientID[len(clientID)-4:]
		}
		log.Printf("[Auth] Discord OAuth configured successfully (client ID: %s, redirect: %s)", maskedID, cfg.Discord.RedirectURL)
	} else {
		log.Printf("[Auth] Discord OAuth NOT configured - client_id present: %v, client_secret present: %v", discordClientIDConfigured, discordClientSecretConfigured)
	}

	// Configure Google OAuth
	googleClientIDConfigured := cfg.Google.ClientID != ""
	googleClientSecretConfigured := cfg.Google.ClientSecret != ""
	if googleClientIDConfigured && googleClientSecretConfigured {
		service.oauthConfigs[models.AuthProviderGoogle] = &oauth2.Config{
			ClientID:     cfg.Google.ClientID,
			ClientSecret: cfg.Google.ClientSecret,
			Endpoint:     googleOAuthEndpoint,
			RedirectURL:  cfg.Google.RedirectURL,
			Scopes:       []string{"openid", "profile", "email"},
		}
		// Log partial client ID for debugging (first 4 and last 4 chars)
		clientID := cfg.Google.ClientID
		maskedID := clientID
		if len(clientID) > 8 {
			maskedID = clientID[:4] + "****" + clientID[len(clientID)-4:]
		}
		log.Printf("[Auth] Google OAuth configured successfully (client ID: %s, redirect: %s)", maskedID, cfg.Google.RedirectURL)
	} else {
		log.Printf("[Auth] Google OAuth NOT configured - client_id present: %v, client_secret present: %v", googleClientIDConfigured, googleClientSecretConfigured)
	}

	// Configure Electron-specific OAuth with custom redirect URLs
	if discordClientIDConfigured && discordClientSecretConfigured && cfg.DiscordElectronRedirectURL != "" {
		service.electronOAuthConfigs[models.AuthProviderDiscord] = &oauth2.Config{
			ClientID:     cfg.Discord.ClientID,
			ClientSecret: cfg.Discord.ClientSecret,
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://discord.com/oauth2/authorize",
				TokenURL: "https://discord.com/api/oauth2/token",
			},
			RedirectURL: cfg.DiscordElectronRedirectURL,
			Scopes:      []string{"identify", "email"},
		}
		log.Printf("[Auth] Discord OAuth (Electron) configured with redirect: %s", cfg.DiscordElectronRedirectURL)
	}

	if googleClientIDConfigured && googleClientSecretConfigured && cfg.GoogleElectronRedirectURL != "" {
		service.electronOAuthConfigs[models.AuthProviderGoogle] = &oauth2.Config{
			ClientID:     cfg.Google.ClientID,
			ClientSecret: cfg.Google.ClientSecret,
			Endpoint:     googleOAuthEndpoint,
			RedirectURL:  cfg.GoogleElectronRedirectURL,
			Scopes:       []string{"openid", "profile", "email"},
		}
		log.Printf("[Auth] Google OAuth (Electron) configured with redirect: %s", cfg.GoogleElectronRedirectURL)
	}

	return service
}

// GenerateState creates a random, single-use OAuth state bound to a provider
// and flow. The state is stored server-side so a callback can only complete a
// flow that this server actually initiated.
func (s *AuthService) GenerateState(provider models.AuthProvider, electron bool) (string, string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	state := base64.RawURLEncoding.EncodeToString(b)
	verifier := oauth2.GenerateVerifier()

	now := time.Now()
	s.stateMu.Lock()
	s.pruneStatesLocked(now)
	s.states[state] = oauthStateEntry{
		Provider:     provider,
		Electron:     electron,
		CodeVerifier: verifier,
		ExpiresAt:    now.Add(oauthStateTTL),
	}
	s.stateMu.Unlock()

	return state, verifier, nil
}

// ConsumeState validates and burns an OAuth state. It never leaves a state
// reusable, even when the callback later fails.
func (s *AuthService) ConsumeState(state string) (models.AuthProvider, bool, string, error) {
	if state == "" {
		return "", false, "", fmt.Errorf("missing oauth state")
	}

	now := time.Now()
	s.stateMu.Lock()
	entry, ok := s.states[state]
	delete(s.states, state)
	s.pruneStatesLocked(now)
	s.stateMu.Unlock()

	if !ok || now.After(entry.ExpiresAt) {
		return "", false, "", fmt.Errorf("invalid or expired oauth state")
	}
	return entry.Provider, entry.Electron, entry.CodeVerifier, nil
}

func (s *AuthService) pruneStatesLocked(now time.Time) {
	for state, entry := range s.states {
		if now.After(entry.ExpiresAt) {
			delete(s.states, state)
		}
	}
}

// GetOAuthURL returns the OAuth authorization URL for a provider
func (s *AuthService) GetOAuthURL(provider models.AuthProvider, state, codeVerifier string) (string, error) {
	config, ok := s.oauthConfigs[provider]
	if !ok {
		return "", fmt.Errorf("OAuth not configured for provider: %s", provider)
	}

	log.Printf("[Auth] GetOAuthURL - redirect_uri: %s", config.RedirectURL)
	return config.AuthCodeURL(state, oauth2.AccessTypeOnline, oauth2.S256ChallengeOption(codeVerifier)), nil
}

// GetElectronOAuthURL returns the OAuth URL for Electron with custom redirect
func (s *AuthService) GetElectronOAuthURL(provider models.AuthProvider, state, codeVerifier string) (string, error) {
	config, ok := s.electronOAuthConfigs[provider]
	if !ok {
		return "", fmt.Errorf("electron OAuth not configured for provider: %s", provider)
	}

	log.Printf("[Auth] GetElectronOAuthURL - redirect_uri: %s", config.RedirectURL)
	return config.AuthCodeURL(state, oauth2.AccessTypeOnline, oauth2.S256ChallengeOption(codeVerifier)), nil
}

// ExchangeCode exchanges an OAuth code for an access token and user info
// Use electronConfig parameter to specify which config to use
func (s *AuthService) ExchangeCode(ctx context.Context, provider models.AuthProvider, code string, useElectronConfig bool, codeVerifier string) (*models.OAuthUserInfo, error) {
	var config *oauth2.Config
	var ok bool

	if useElectronConfig {
		config, ok = s.electronOAuthConfigs[provider]
		if !ok {
			return nil, fmt.Errorf("electron OAuth not configured for provider: %s", provider)
		}
	} else {
		config, ok = s.oauthConfigs[provider]
		if !ok {
			return nil, fmt.Errorf("OAuth not configured for provider: %s", provider)
		}
	}

	// Exchange code for token (include the PKCE verifier when present)
	opts := []oauth2.AuthCodeOption{}
	if codeVerifier != "" {
		opts = append(opts, oauth2.VerifierOption(codeVerifier))
	}
	token, err := config.Exchange(ctx, code, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to exchange code: %w", err)
	}

	// Fetch user info based on provider
	switch provider {
	case models.AuthProviderDiscord:
		return s.fetchDiscordUserInfo(token.AccessToken)
	case models.AuthProviderGoogle:
		return s.fetchGoogleUserInfo(token.AccessToken)
	default:
		return nil, fmt.Errorf("unsupported provider: %s", provider)
	}
}

// fetchDiscordUserInfo fetches user info from Discord API
func (s *AuthService) fetchDiscordUserInfo(accessToken string) (*models.OAuthUserInfo, error) {
	req, err := http.NewRequest("GET", "https://discord.com/api/users/@me", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("discord API error: %s", string(body))
	}

	var discordUser struct {
		ID            string `json:"id"`
		Username      string `json:"username"`
		Discriminator string `json:"discriminator"`
		Email         string `json:"email"`
		Avatar        string `json:"avatar"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&discordUser); err != nil {
		return nil, err
	}

	// Construct nickname from username + discriminator (if present)
	nickname := discordUser.Username
	if discordUser.Discriminator != "" && discordUser.Discriminator != "0" {
		nickname = fmt.Sprintf("%s#%s", discordUser.Username, discordUser.Discriminator)
	}

	// Construct avatar URL
	avatarURL := ""
	if discordUser.Avatar != "" {
		avatarURL = fmt.Sprintf("https://cdn.discordapp.com/avatars/%s/%s.png", discordUser.ID, discordUser.Avatar)
	}

	return &models.OAuthUserInfo{
		ID:        discordUser.ID,
		Nickname:  nickname,
		Email:     discordUser.Email,
		AvatarURL: avatarURL,
		Provider:  models.AuthProviderDiscord,
	}, nil
}

// fetchGoogleUserInfo fetches user info from Google API
func (s *AuthService) fetchGoogleUserInfo(accessToken string) (*models.OAuthUserInfo, error) {
	req, err := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("google API error: %s", string(body))
	}

	var googleUser struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Email   string `json:"email"`
		Picture string `json:"picture"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&googleUser); err != nil {
		return nil, err
	}

	return &models.OAuthUserInfo{
		ID:        googleUser.ID,
		Nickname:  googleUser.Name,
		Email:     googleUser.Email,
		AvatarURL: googleUser.Picture,
		Provider:  models.AuthProviderGoogle,
	}, nil
}

// CreateOrUpdateUser creates or updates a user from OAuth info
func (s *AuthService) CreateOrUpdateUser(oauthInfo *models.OAuthUserInfo) (*models.User, error) {
	// Try to find existing user by provider ID
	existingUser, err := s.userRepo.GetByProviderID(string(oauthInfo.Provider), oauthInfo.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to check existing user: %w", err)
	}

	now := time.Now()

	if existingUser != nil {
		// Update existing user - preserve custom nickname, only update display nickname
		existingUser.Email = oauthInfo.Email
		// Only update avatar if user doesn't have a custom avatar
		if existingUser.AvatarURL == "" || !strings.HasPrefix(existingUser.AvatarURL, "/api/avatars/") {
			existingUser.AvatarURL = oauthInfo.AvatarURL
		}
		existingUser.LastSeen = now

		if err := s.userRepo.Update(existingUser); err != nil {
			return nil, fmt.Errorf("failed to update user: %w", err)
		}
		return existingUser, nil
	}

	// Create new user - set original_nickname (immutable) from OAuth, nickname can be changed
	user := &models.User{
		ID:               generateUserID(),
		Nickname:         oauthInfo.Nickname,
		OriginalNickname: oauthInfo.Nickname,
		Status:           "online",
		CreatedAt:        now,
		LastSeen:         now,
		AuthProvider:     oauthInfo.Provider,
		ProviderID:       oauthInfo.ID,
		Email:            oauthInfo.Email,
		AvatarURL:        oauthInfo.AvatarURL,
		IsGuest:          false,
		Role:             models.RoleUser,
	}

	if err := s.userRepo.Create(user); err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	return user, nil
}

// CreateGuestUser creates a new guest user
func (s *AuthService) CreateGuestUser() (*models.User, error) {
	now := time.Now()
	userID := generateUserID()
	guestNickname := generateGuestNickname(userID)

	user := &models.User{
		ID:               userID,
		Nickname:         guestNickname,
		OriginalNickname: guestNickname,
		Status:           "online",
		CreatedAt:        now,
		LastSeen:         now,
		AuthProvider:     models.AuthProviderGuest,
		IsGuest:          true,
		Role:             models.RoleGuest,
	}

	if err := s.userRepo.Create(user); err != nil {
		return nil, fmt.Errorf("failed to create guest user: %w", err)
	}

	return user, nil
}

// GenerateJWT creates a JWT token for a user
func (s *AuthService) GenerateJWT(user *models.User) (string, time.Time, error) {
	return s.GenerateJWTWithExpiry(user, 60*24*time.Hour) // Default 60 days
}

// GenerateJWTWithExpiry creates a JWT token for a user with custom expiry
func (s *AuthService) GenerateJWTWithExpiry(user *models.User, expiry time.Duration) (string, time.Time, error) {
	expiryTime := time.Now().Add(expiry)

	claims := jwt.MapClaims{
		"user_id":       user.ID,
		"nickname":      user.Nickname,
		"auth_provider": string(user.AuthProvider),
		"email":         user.Email,
		"avatar_url":    user.AvatarURL,
		"is_guest":      user.IsGuest,
		"role":          user.Role,
		"token_version": user.TokenVersion,
		"exp":           expiryTime.Unix(),
		"iat":           time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(s.config.JWTSecret))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, expiryTime, nil
}

// ValidateJWT validates a JWT token and returns the claims
func (s *AuthService) ValidateJWT(tokenString string) (*models.JWTClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(s.config.JWTSecret), nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("invalid claims format")
	}

	// Extract claims
	jwtClaims := &models.JWTClaims{}

	if userID, ok := claims["user_id"].(string); ok {
		jwtClaims.UserID = userID
	}
	if nickname, ok := claims["nickname"].(string); ok {
		jwtClaims.Nickname = nickname
	}
	if provider, ok := claims["auth_provider"].(string); ok {
		jwtClaims.AuthProvider = models.AuthProvider(provider)
	}
	if email, ok := claims["email"].(string); ok {
		jwtClaims.Email = email
	}
	if avatarURL, ok := claims["avatar_url"].(string); ok {
		jwtClaims.AvatarURL = avatarURL
	}
	if isGuest, ok := claims["is_guest"].(bool); ok {
		jwtClaims.IsGuest = isGuest
	}
	if role, ok := claims["role"].(string); ok {
		jwtClaims.Role = role
	}
	if tokenVersion, ok := claims["token_version"].(float64); ok {
		jwtClaims.TokenVersion = int64(tokenVersion)
	}

	return jwtClaims, nil
}

// ClaimsFromUser builds fresh claims from the current database state. Callers
// must use this instead of trusting values embedded in an old token.
func ClaimsFromUser(user *models.User) *models.JWTClaims {
	return &models.JWTClaims{
		UserID:       user.ID,
		Nickname:     user.Nickname,
		AuthProvider: user.AuthProvider,
		Email:        user.Email,
		AvatarURL:    user.AvatarURL,
		IsGuest:      user.IsGuest,
		Role:         user.Role,
		TokenVersion: user.TokenVersion,
	}
}

// RevokeTokens invalidates all JWTs issued for a user by bumping the per-user
// token version checked by AuthMiddleware.
func (s *AuthService) RevokeTokens(userID string) error {
	if s.userRepo == nil {
		return fmt.Errorf("user repository unavailable")
	}
	return s.userRepo.IncrementTokenVersion(userID)
}

// Helper functions
func generateUserID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}

func generateGuestNickname(userID string) string {
	return "Guest-" + userID[:6]
}

// GetUserByID retrieves a user by their ID
func (s *AuthService) GetUserByID(userID string) (*models.User, error) {
	if s.userRepo == nil {
		return nil, fmt.Errorf("user repository unavailable")
	}
	return s.userRepo.GetByID(userID)
}

// IsProviderConfigured checks if an OAuth provider is configured
func (s *AuthService) IsProviderConfigured(provider models.AuthProvider) bool {
	_, ok := s.oauthConfigs[provider]
	return ok
}

// IsElectronOAuthConfigured checks if Electron OAuth is configured for a provider
func (s *AuthService) IsElectronOAuthConfigured(provider models.AuthProvider) bool {
	_, ok := s.electronOAuthConfigs[provider]
	return ok
}

// Password validation constants
const (
	MinPasswordLength = 8
)

// ValidatePassword checks if password meets requirements
func ValidatePassword(password string) error {
	if len(password) < MinPasswordLength {
		return fmt.Errorf("password must be at least %d characters", MinPasswordLength)
	}

	hasNumber := false
	hasSpecial := false

	specialChars := "!@#$%^&*()_+-=[]{}|;:,.<>?"

	for _, char := range password {
		if char >= '0' && char <= '9' {
			hasNumber = true
		}
		for _, sc := range specialChars {
			if char == sc {
				hasSpecial = true
				break
			}
		}
		if hasNumber && hasSpecial {
			break
		}
	}

	if !hasNumber {
		return fmt.Errorf("password must contain at least 1 number")
	}
	if !hasSpecial {
		return fmt.Errorf("password must contain at least 1 special character")
	}
	return nil
}

// HashPassword creates a bcrypt hash of the password
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(hash), nil
}

// CheckPasswordHash compares a password with a hash
func CheckPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// Register creates a new user with email, nickname, and password
func (s *AuthService) Register(email, nickname, password string) (*models.User, error) {
	// Validate email format
	if email == "" {
		return nil, fmt.Errorf("email is required")
	}
	if !isValidEmail(email) {
		return nil, fmt.Errorf("invalid email format")
	}

	// Validate nickname
	if nickname == "" {
		return nil, fmt.Errorf("nickname is required")
	}
	if len(nickname) < 2 || len(nickname) > 32 {
		return nil, fmt.Errorf("nickname must be between 2 and 32 characters")
	}

	// Validate password
	if err := ValidatePassword(password); err != nil {
		return nil, err
	}

	// Check if email already exists for password auth users
	emailExists, err := s.userRepo.EmailExists(email)
	if err != nil {
		return nil, fmt.Errorf("failed to check email: %w", err)
	}
	if emailExists {
		return nil, fmt.Errorf("email already registered")
	}

	// Check if original_nickname already exists (for password/guest users)
	nicknameExists, err := s.userRepo.OriginalNicknameExists(nickname)
	if err != nil {
		return nil, fmt.Errorf("failed to check nickname: %w", err)
	}
	if nicknameExists {
		return nil, fmt.Errorf("nickname already taken")
	}

	// Hash password
	hashedPassword, err := HashPassword(password)
	if err != nil {
		return nil, err
	}

	// Create user
	now := time.Now()
	user := &models.User{
		ID:               generateUserID(),
		Nickname:         nickname,
		OriginalNickname: nickname,
		Status:           "online",
		CreatedAt:        now,
		LastSeen:         now,
		AuthProvider:     models.AuthProviderPassword,
		Email:            email,
		PasswordHash:     hashedPassword,
		IsGuest:          false,
		Role:             models.RoleUser,
	}

	if err := s.userRepo.Create(user); err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// Clear password hash before returning
	user.PasswordHash = ""

	return user, nil
}

// LoginPassword authenticates a user with email or nickname and password
func (s *AuthService) LoginPassword(login, password string) (*models.User, error) {
	if login == "" {
		return nil, fmt.Errorf("email or nickname is required")
	}
	if password == "" {
		return nil, fmt.Errorf("password is required")
	}

	passwordProvider := models.AuthProviderPassword

	// Try to find user by email first, then by nickname
	var user *models.User
	var err error

	// Check if login looks like email
	if strings.Contains(login, "@") {
		user, err = s.userRepo.GetByEmail(login, &passwordProvider)
	} else {
		// Try original_nickname (immutable login key)
		user, err = s.userRepo.GetByOriginalNickname(login, &passwordProvider)
		// If not found by original_nickname, also check email
		if err != nil {
			return nil, err
		}
		if user == nil {
			// Also try email lookup as fallback
			// Double check in case if nickname got inside email field
			user, err = s.userRepo.GetByEmail(login, &passwordProvider)
			if err != nil {
				return nil, err
			}
		}
	}

	if err != nil {
		return nil, fmt.Errorf("failed to find user: %w", err)
	}
	if user == nil {
		return nil, fmt.Errorf("invalid credentials")
	}

	// Verify password
	if !CheckPasswordHash(password, user.PasswordHash) {
		return nil, fmt.Errorf("invalid credentials")
	}

	// Update last seen
	user.LastSeen = time.Now()
	err = s.userRepo.UpdateLastSeen(user.ID, user.LastSeen)
	if err != nil {
		// Log but don't fail
		log.Printf("Failed to update last seen: %v", err)
	}

	// Clear password hash before returning
	user.PasswordHash = ""

	return user, nil
}

// IsPasswordEnabled always returns true since we support password auth
func (s *AuthService) IsPasswordEnabled() bool {
	return true
}

// Helper function to validate email format
func isValidEmail(email string) bool {
	_, err := mail.ParseAddress(email)
	return err == nil
}
